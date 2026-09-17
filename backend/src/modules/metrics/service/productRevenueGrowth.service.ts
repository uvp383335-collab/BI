import { QuickBooksService, mapWithConcurrency } from '../../integrations/service/quickbooks.service'
import { getQuickBooksAuth } from './plReport.service'
import { parseProfitAndLoss, buildMonthlyRevenueGrowth, MonthlyRevenueGrowthPoint } from './plParser'

// Same set docs/server.js's per-product report filtering uses — QuickBooks'
// Reports API rejects Category/Discount/Payment/Subtotal/Description as an
// item filter (grouping/formatting rows, not sellable products).
const SELLABLE_ITEM_TYPES = new Set(['Service', 'Inventory', 'NonInventory', 'Bundle', 'Group'])

/** Last day of the most recently completed calendar month (excludes the current, still-in-progress month). Mirrors docs/server.js's lastCompletedMonthEndDate. */
function lastCompletedMonthEndDate(): string {
  const now = new Date()
  const firstOfThisMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
  const lastOfPrevMonth = new Date(firstOfThisMonth.getTime() - 24 * 60 * 60 * 1000)
  return lastOfPrevMonth.toISOString().slice(0, 10)
}

export interface ProductRevenueGrowthProduct {
  id: string
  name: string
  months: MonthlyRevenueGrowthPoint[]
}

export interface ProductRevenueGrowthFailure {
  id: string
  name: string
  message: string
}

export interface ProductRevenueGrowthResult {
  products: ProductRevenueGrowthProduct[]
  failedProducts: ProductRevenueGrowthFailure[]
  message?: string
}

export interface ProductRevenueGrowthOptions {
  fromYear?: string
  department?: string
  state?: string
}

/**
 * Live, on-demand month-over-month revenue growth per product/service —
 * "Revenue growth by product" (docs/server.js §5). Deliberately NOT
 * pre-synced like PLSnapshot/PLItemSnapshot: item × department × billing-state
 * is an unbounded, user-chosen combination space, so this calls QuickBooks
 * directly when requested (same as docs/server.js's own "Load Product
 * Revenue Growth" button, which explicitly warns "this runs one report per
 * product and can take a while") rather than trying to pre-sync every
 * combination. Concurrency-capped (mapWithConcurrency, limit 3) and
 * QuickBooksService.getReport's 429 retry/backoff cover the rate-limit risk
 * one report-per-product otherwise carries.
 */
export async function getProductRevenueGrowth(orgId: string, options: ProductRevenueGrowthOptions): Promise<ProductRevenueGrowthResult> {
  const { accessToken, realmId } = await getQuickBooksAuth(orgId)
  const startDate = `${options.fromYear ?? '2018'}-01-01`
  const endDate = lastCompletedMonthEndDate()

  // A billing-address state filter resolves to a set of customer ids, since
  // QuickBooks reports have no native "state" filter — see
  // QuickBooksService.getCustomersWithBillingAddress's doc comment.
  let customerFilter: string | undefined
  if (options.state) {
    const customers = await QuickBooksService.getCustomersWithBillingAddress(accessToken, realmId)
    const matchingIds = customers.filter((customer) => customer.BillAddr?.CountrySubDivisionCode === options.state).map((customer) => customer.Id)

    if (matchingIds.length === 0) {
      return { products: [], failedProducts: [], message: `No customers found with a billing address in ${options.state}.` }
    }
    customerFilter = matchingIds.join(',')
  }

  const itemsPage = await QuickBooksService.getItems(accessToken, realmId, 1, 1000)
  const products = itemsPage.records.filter((item) => item.Type && SELLABLE_ITEM_TYPES.has(item.Type))

  const settled = await mapWithConcurrency(products, 3, async (product) => {
    const report = await QuickBooksService.getProfitAndLossReport(accessToken, realmId, startDate, endDate, 'Month', product.Id, options.department, customerFilter)
    const parsed = parseProfitAndLoss(report)
    return { id: product.Id, name: product.Name || product.Id, months: buildMonthlyRevenueGrowth(parsed) }
  })

  const succeeded: ProductRevenueGrowthProduct[] = []
  const failed: ProductRevenueGrowthFailure[] = []

  settled.forEach((result, index) => {
    if (result.status === 'fulfilled') {
      succeeded.push(result.value)
    } else {
      failed.push({
        id: products[index].Id,
        name: products[index].Name || products[index].Id,
        message: result.reason instanceof Error ? result.reason.message : 'Request failed.'
      })
    }
  })

  return { products: succeeded, failedProducts: failed }
}

export interface QuickBooksDepartmentOption {
  id: string
  name: string
}

/** Location filter dropdown's contents — QuickBooks Online's "Location" tracking is the Department entity. */
export async function getQuickBooksDepartments(orgId: string): Promise<QuickBooksDepartmentOption[]> {
  const { accessToken, realmId } = await getQuickBooksAuth(orgId)
  const departments = await QuickBooksService.getDepartments(accessToken, realmId)
  return departments.map((department) => ({ id: department.Id, name: department.Name || department.Id }))
}

/** Billing-state filter dropdown's contents, derived from customers' billing addresses. */
export async function getQuickBooksCustomerStates(orgId: string): Promise<string[]> {
  const { accessToken, realmId } = await getQuickBooksAuth(orgId)
  const customers = await QuickBooksService.getCustomersWithBillingAddress(accessToken, realmId)
  const states = new Set(customers.map((customer) => customer.BillAddr?.CountrySubDivisionCode).filter((state): state is string => !!state))
  return Array.from(states).sort()
}
