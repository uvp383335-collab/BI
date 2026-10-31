import { QuickBooksService, mapWithConcurrency } from '../../integrations/service/quickbooks.service'
import { getQuickBooksAuth } from './plReport.service'
import { parseProfitAndLoss, buildMonthlyRevenueGrowth, MonthlyRevenueGrowthPoint } from './plParser'
import { invoiceRepository } from '../../sync/repository/invoice.repository'
import { productRepository } from '../../sync/repository/product.repository'

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

/** "YYYY-MM-DD"/"YYYY-MM-DD" -> every calendar month in between, inclusive, as "YYYY-MM" — the canonical join key used to line up QuickBooks' own (locale-formatted, not machine-parseable) P&L report column titles against locally-synced invoice months by position rather than by parsing "ColTitle" strings. */
function monthRangeYYYYMM(startDate: string, endDate: string): string[] {
  const start = new Date(`${startDate}T00:00:00.000Z`)
  const end = new Date(`${endDate}T00:00:00.000Z`)
  const months: string[] = []
  let year = start.getUTCFullYear()
  let month = start.getUTCMonth()
  const endYear = end.getUTCFullYear()
  const endMonth = end.getUTCMonth()
  while (year < endYear || (year === endYear && month <= endMonth)) {
    months.push(`${year}-${String(month + 1).padStart(2, '0')}`)
    month += 1
    if (month > 11) {
      month = 0
      year += 1
    }
  }
  return months
}

const round2 = (n: number): number => Math.round(n * 100) / 100

/** Turns a month -> revenue map into the chart's {month, revenue, revenueGrowthPct} series, filling in $0 for months with no synced revenue. Shared by getInvoiceRevenueGrowthByProduct (all products) and getInvoiceRevenueGrowthByProductDetail (one product) so their growth-% math never drifts apart. */
function buildInvoiceMonthlySeries(canonicalMonths: string[], revenueByMonth: Map<string, number>): MonthlyRevenueGrowthPoint[] {
  let previousRevenue: number | null = null
  return canonicalMonths.map((month) => {
    const revenue = round2(revenueByMonth.get(month) ?? 0)
    const revenueGrowthPct = previousRevenue === null || previousRevenue === 0 ? null : ((revenue - previousRevenue) / Math.abs(previousRevenue)) * 100
    previousRevenue = revenue
    return { month, revenue, revenueGrowthPct }
  })
}

export interface InvoiceRevenueGrowthByProductOptions {
  fromYear?: string
}

export interface InvoiceRevenueGrowthByProductResult {
  products: ProductRevenueGrowthProduct[]
}

/**
 * "Revenue growth by product," computed entirely from this org's own synced
 * QuickBooks `Invoice` line items — the local-data counterpart to
 * getProductRevenueGrowth above, which calls QuickBooks' own live
 * per-product Profit & Loss report instead (one request per product).
 * This never calls QuickBooks: `invoiceRepository.getRevenueByItemAndMonth`
 * groups every synced invoice line by `(itemId, month)` in a single query,
 * so every product's trend comes back together rather than one report at a
 * time. Deliberately a separate card from the live one, not a replacement —
 * QuickBooks' P&L is accrual-basis and can include non-invoice income
 * documents (sales receipts, credit memos, journal entries), so this
 * invoice-only view can read a bit differently; it exists to show what the
 * synced invoice data alone says, as a cross-check against the live figures
 * (the same comparison getProductRevenueGrowthDetail's `syncedInvoiceTotal`
 * column already makes per product, promoted here to its own full trend
 * across every product instead of a side column on one). Only department/
 * fromYear-style filters that synced `Invoice` documents can actually honor
 * are offered — no department or billing-state filter, since neither is
 * captured on the locally-synced invoice/customer records.
 */
export async function getInvoiceRevenueGrowthByProduct(orgId: string, options: InvoiceRevenueGrowthByProductOptions): Promise<InvoiceRevenueGrowthByProductResult> {
  const startDate = `${options.fromYear ?? '2018'}-01-01`
  const endDate = lastCompletedMonthEndDate()
  const canonicalMonths = monthRangeYYYYMM(startDate, endDate)

  const from = new Date(`${startDate}T00:00:00.000Z`)
  const to = new Date(`${endDate}T23:59:59.999Z`)

  const [products, rows] = await Promise.all([
    productRepository.findAllForOrg(orgId, 'quickbooks'),
    invoiceRepository.getRevenueByItemAndMonth(orgId, 'quickbooks', from, to)
  ])

  const revenueByItemMonth = new Map<string, Map<string, number>>()
  const itemIdsWithRevenue = new Set<string>()
  for (const row of rows) {
    itemIdsWithRevenue.add(row.itemId)
    if (!revenueByItemMonth.has(row.itemId)) revenueByItemMonth.set(row.itemId, new Map())
    revenueByItemMonth.get(row.itemId)!.set(row.month, row.revenue)
  }

  // Only products that actually appear on a synced invoice line in range — an unsold
  // product charting as an all-zero flat line the whole window isn't useful here.
  const resultProducts: ProductRevenueGrowthProduct[] = products
    .filter((product) => itemIdsWithRevenue.has(product.providerRecordId))
    .map((product) => {
      const monthRevenue = revenueByItemMonth.get(product.providerRecordId) ?? new Map<string, number>()
      return { id: product.providerRecordId, name: product.name, months: buildInvoiceMonthlySeries(canonicalMonths, monthRevenue) }
    })
    .sort((a, b) => a.name.localeCompare(b.name))

  return { products: resultProducts }
}

export interface InvoiceRevenueGrowthByProductDetailLine {
  providerRecordId: string
  customerRecordId: string
  customerName: string | null
  /** "YYYY-MM-DD" */
  txnDate: string
  lineAmount: number
  invoiceTotalAmount: number
}

export interface InvoiceRevenueGrowthByProductDetailResult {
  productId: string
  productName: string
  months: MonthlyRevenueGrowthPoint[]
  /** Every synced invoice line behind the months above — unlike getProductRevenueGrowthDetail's `lines`, these sum to `months[].revenue` exactly, since both come from the same synced-invoice source (no live QuickBooks figure to reconcile against here). */
  lines: InvoiceRevenueGrowthByProductDetailLine[]
}

/**
 * Record-level backing data for one product's series in the invoice-based
 * "Revenue growth by product (from synced invoices)" card, for its "export
 * to Excel" verification button. Reuses the same invoiceRepository.getInvoiceLinesForItem
 * query getProductRevenueGrowthDetail uses for its reconciliation column —
 * here it's not a reconciliation figure but the one and only source, so
 * `months[].revenue` and the sum of `lines[].lineAmount` always agree
 * exactly (modulo rounding), unlike that other endpoint's live-vs-synced split.
 */
export async function getInvoiceRevenueGrowthByProductDetail(
  orgId: string,
  productId: string,
  productName: string,
  options: InvoiceRevenueGrowthByProductOptions
): Promise<InvoiceRevenueGrowthByProductDetailResult> {
  const startDate = `${options.fromYear ?? '2018'}-01-01`
  const endDate = lastCompletedMonthEndDate()
  const canonicalMonths = monthRangeYYYYMM(startDate, endDate)

  const from = new Date(`${startDate}T00:00:00.000Z`)
  const to = new Date(`${endDate}T23:59:59.999Z`)
  const lines = await invoiceRepository.getInvoiceLinesForItem(orgId, 'quickbooks', from, to, productId)

  const revenueByMonth = new Map<string, number>()
  for (const line of lines) {
    const month = line.txnDate.toISOString().slice(0, 7)
    revenueByMonth.set(month, (revenueByMonth.get(month) ?? 0) + line.lineAmount)
  }

  return {
    productId,
    productName,
    months: buildInvoiceMonthlySeries(canonicalMonths, revenueByMonth),
    lines: lines.map((line) => ({
      providerRecordId: line.providerRecordId,
      customerRecordId: line.customerRecordId,
      customerName: line.customerName,
      txnDate: line.txnDate.toISOString().slice(0, 10),
      lineAmount: line.lineAmount,
      invoiceTotalAmount: line.invoiceTotalAmount
    }))
  }
}

export interface ProductRevenueGrowthDetailLine {
  providerRecordId: string
  customerRecordId: string
  customerName: string | null
  /** "YYYY-MM-DD" */
  txnDate: string
  lineAmount: number
  invoiceTotalAmount: number
}

export interface ProductRevenueGrowthDetailMonth {
  /** "YYYY-MM" — the canonical key syncedInvoiceTotal is grouped by. */
  month: string
  /** QuickBooks' own report column title for this month, e.g. "Jan 2024" — shown alongside `month` since that's what a reader would recognize from QuickBooks' own UI. */
  quickbooksColumnLabel: string
  quickbooksRevenue: number
  quickbooksRevenueGrowthPct: number | null
  /** Sum of locally-synced Invoice.lines[].amount for this product this month — the reconciliation figure to compare against quickbooksRevenue. Will generally NOT match it exactly; see `caveat`. */
  syncedInvoiceTotal: number
}

export interface ProductRevenueGrowthDetailResult {
  productId: string
  productName: string
  months: ProductRevenueGrowthDetailMonth[]
  lines: ProductRevenueGrowthDetailLine[]
  /** Non-null when a requested filter couldn't be honored by the local invoice data, so the reconciliation below it isn't silently wrong. */
  caveat: string | null
}

/**
 * Record-level backing data for one product's "Revenue growth by product"
 * series, for the dashboard's "export to Excel" verification button.
 * `quickbooksRevenue` is re-fetched live (same per-product P&L report
 * getProductRevenueGrowth itself calls) rather than trusted from a stale
 * client-side value, so the export is always checked against a fresh number.
 * `syncedInvoiceTotal`/`lines` come from this org's own locally-synced
 * `Invoice` records, the only invoice-level data this app has — deliberately
 * NOT presented as something that will tie out exactly to `quickbooksRevenue`:
 * that figure is QuickBooks' own accrual-basis P&L income total, which can
 * include non-invoice income documents (sales receipts, credit memos,
 * journal entries) and recognizes revenue by accounting period rather than
 * invoice date. The local sum is still the right tool for "does this
 * product's revenue trace back to real invoices, and are the right ones
 * being counted" — just not a bit-for-bit reconciliation.
 */
export async function getProductRevenueGrowthDetail(
  orgId: string,
  productId: string,
  productName: string,
  options: ProductRevenueGrowthOptions
): Promise<ProductRevenueGrowthDetailResult> {
  const { accessToken, realmId } = await getQuickBooksAuth(orgId)
  const startDate = `${options.fromYear ?? '2018'}-01-01`
  const endDate = lastCompletedMonthEndDate()

  let customerFilter: string | undefined
  let stateCustomerIds: Set<string> | undefined
  if (options.state) {
    const customers = await QuickBooksService.getCustomersWithBillingAddress(accessToken, realmId)
    const matching = customers.filter((customer) => customer.BillAddr?.CountrySubDivisionCode === options.state)
    customerFilter = matching.map((customer) => customer.Id).join(',')
    stateCustomerIds = new Set(matching.map((customer) => customer.Id))
  }

  const report = await QuickBooksService.getProfitAndLossReport(accessToken, realmId, startDate, endDate, 'Month', productId, options.department, customerFilter)
  const parsed = parseProfitAndLoss(report)
  const quickbooksMonths = buildMonthlyRevenueGrowth(parsed)
  const canonicalMonths = monthRangeYYYYMM(startDate, endDate)

  const from = new Date(`${startDate}T00:00:00.000Z`)
  const to = new Date(`${endDate}T23:59:59.999Z`)
  let invoiceLines = await invoiceRepository.getInvoiceLinesForItem(orgId, 'quickbooks', from, to, productId)
  if (stateCustomerIds) invoiceLines = invoiceLines.filter((line) => stateCustomerIds!.has(line.customerRecordId))

  const syncedTotalByMonth = new Map<string, number>()
  for (const line of invoiceLines) {
    const month = line.txnDate.toISOString().slice(0, 7)
    syncedTotalByMonth.set(month, (syncedTotalByMonth.get(month) ?? 0) + line.lineAmount)
  }

  const months: ProductRevenueGrowthDetailMonth[] = quickbooksMonths.map((m, index) => {
    const month = canonicalMonths[index] ?? m.month
    return {
      month,
      quickbooksColumnLabel: m.month,
      quickbooksRevenue: m.revenue,
      quickbooksRevenueGrowthPct: m.revenueGrowthPct,
      syncedInvoiceTotal: round2(syncedTotalByMonth.get(month) ?? 0)
    }
  })

  const caveat = options.department
    ? `A department/location filter ("${options.department}") was applied to the QuickBooks P&L revenue above, but locally synced invoices don't carry a department field — the invoice-line detail below covers ALL departments, not just the filtered one.`
    : null

  return {
    productId,
    productName,
    months,
    lines: invoiceLines.map((line) => ({
      providerRecordId: line.providerRecordId,
      customerRecordId: line.customerRecordId,
      customerName: line.customerName,
      txnDate: line.txnDate.toISOString().slice(0, 10),
      lineAmount: line.lineAmount,
      invoiceTotalAmount: line.invoiceTotalAmount
    })),
    caveat
  }
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
