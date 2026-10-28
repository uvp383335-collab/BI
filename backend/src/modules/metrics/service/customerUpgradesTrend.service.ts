import { invoiceRepository } from '../../sync/repository/invoice.repository'
import { productRepository } from '../../sync/repository/product.repository'
import { ProductBillingFrequency } from '../../sync/model/Product.model'
import { latestClosedMonth, shiftMonth, monthRangeUtc } from './revenueRollForward.service'

const QUICKBOOKS = 'quickbooks'

// A full year of monthly upgrade bars / 3 years of annual upgrade bars — same "don't show
// an unreadably long or mostly-empty series" judgment call as the other trend charts' windows.
const TRAILING_MONTHS = 12
const TRAILING_YEARS = 3

export type CustomerUpgradesTrendGranularity = 'monthly' | 'annually'

export interface CustomerUpgradesTrendPoint {
  /** "YYYY-MM" for 'monthly', "YYYY" for 'annually'. */
  period: string
  /** How many customers upgraded this period — the "customer wise" view. */
  upgradeCount: number
  /** Total $ increase across every upgrading customer this period (sum of each one's current-minus-prior revenue) — the "amount wise" view. */
  upgradeAmount: number
  /** How many customers downgraded this period — still a customer (revenue > 0), just a lower bill than the prior period. Excludes churn (see below). */
  downgradeCount: number
  /** Total $ decrease across every downgrading customer this period — the downgrades card's "amount wise" view. */
  downgradeAmount: number
  /** How many customers fully cancelled this period (revenue dropped all the way to $0) — the churn card's "customer wise" view. */
  churnCount: number
  /** Total $ lost across every churned customer this period (each one's full prior revenue) — the churn card's "amount wise" view. */
  churnAmount: number
  /** Sum of every existing customer's prior-period revenue (the GRR/NRR denominator) — 0 when no customer had any revenue to retain that period. */
  startingRevenue: number
  /** GRR % — (startingRevenue - downgradeAmount - churnAmount) / startingRevenue — null when startingRevenue is 0 (nothing to retain, never silently 0%). */
  grrPct: number | null
  /** NRR % — GRR plus upgradeAmount back in — can exceed 100%. Null under the same condition as grrPct. */
  nrrPct: number | null
}

export interface CustomerUpgradesTrendResult {
  /** False when the selected product isn't categorized `recurring` with the billing frequency this granularity needs (monthly billing for the 'monthly' view, yearly billing for 'annually') — never guesses at a comparison window a product doesn't actually bill on. */
  hasData: boolean
  points: CustomerUpgradesTrendPoint[]
}

/**
 * A customer upgraded this period if they had revenue in the prior period
 * too (an existing customer, not a first purchase) and this period's
 * revenue is higher; downgraded if it's lower but still above $0 (still a
 * customer, just paying less); churned if it dropped all the way to $0 (no
 * longer a customer for this product at all). Downgrade and churn are
 * mutually exclusive — same convention `classifyRevenueRollForward` uses
 * for GRR/NRR's cancellations-vs-downgrades split. GRR/NRR themselves are
 * then this same product's own retention, using the identical formula as
 * `grrFromRollForward`/`nrrFromRollForward` (revenueRollForward.service.ts)
 * — just scoped to one product's own customers instead of the whole
 * business. Everything is computed together in one pass over the same
 * per-customer revenue map, since it all reads the exact same
 * prior-vs-current comparison.
 */
function summarizePeriodChange(
  revenueByCustomer: Map<string, Map<string, number>>,
  period: string,
  priorPeriod: string
): {
  upgradeCount: number
  upgradeAmount: number
  downgradeCount: number
  downgradeAmount: number
  churnCount: number
  churnAmount: number
  startingRevenue: number
  grrPct: number | null
  nrrPct: number | null
} {
  let upgradeCount = 0
  let upgradeAmount = 0
  let downgradeCount = 0
  let downgradeAmount = 0
  let churnCount = 0
  let churnAmount = 0
  let startingRevenue = 0
  for (const periods of revenueByCustomer.values()) {
    const prev = periods.get(priorPeriod) ?? 0
    const curr = periods.get(period) ?? 0
    if (prev <= 0) continue // only existing customers (revenue last period) count toward starting revenue or any of the three buckets
    startingRevenue += prev
    if (curr > prev) {
      upgradeCount++
      upgradeAmount += curr - prev
    } else if (curr === 0) {
      churnCount++
      churnAmount += prev
    } else if (curr < prev) {
      downgradeCount++
      downgradeAmount += prev - curr
    }
  }
  const grrPct = startingRevenue > 0 ? ((startingRevenue - downgradeAmount - churnAmount) / startingRevenue) * 100 : null
  const nrrPct = startingRevenue > 0 ? ((startingRevenue - downgradeAmount - churnAmount + upgradeAmount) / startingRevenue) * 100 : null
  return { upgradeCount, upgradeAmount, downgradeCount, downgradeAmount, churnCount, churnAmount, startingRevenue, grrPct, nrrPct }
}

function groupByCustomerAndMonth(rows: { customerRecordId: string; month: string; revenue: number }[]): Map<string, Map<string, number>> {
  const byCustomer = new Map<string, Map<string, number>>()
  for (const row of rows) {
    if (!byCustomer.has(row.customerRecordId)) byCustomer.set(row.customerRecordId, new Map())
    byCustomer.get(row.customerRecordId)!.set(row.month, row.revenue)
  }
  return byCustomer
}

/** Fetches per-customer-per-month revenue scoped to one item, or — when `itemId` is omitted ("All products") — blended across every recurring product billed on `requiredFrequency` (the same org-wide aggregation VC-01/VC-02's recurring roll-forward uses). */
function getRevenueRows(orgId: string, from: Date, to: Date, itemId: string | undefined, requiredFrequency: ProductBillingFrequency) {
  return itemId
    ? invoiceRepository.getCustomerRevenueByMonthForItem(orgId, QUICKBOOKS, from, to, itemId)
    : invoiceRepository.getRecurringRevenueByCustomerAndMonth(orgId, QUICKBOOKS, from, to, requiredFrequency)
}

/** Trailing 12 months, each compared to the month right before it. */
async function getMonthlyTrend(orgId: string, itemId: string | undefined, requiredFrequency: ProductBillingFrequency): Promise<CustomerUpgradesTrendPoint[]> {
  const latestMonth = latestClosedMonth()
  const months = Array.from({ length: TRAILING_MONTHS }, (_, i) => shiftMonth(latestMonth, -(TRAILING_MONTHS - 1 - i)))
  const { start } = monthRangeUtc(shiftMonth(months[0], -1)) // one extra month back, as the baseline for the first bar
  const { end } = monthRangeUtc(months[months.length - 1])

  const rows = await getRevenueRows(orgId, start, end, itemId, requiredFrequency)
  const revenueByCustomer = groupByCustomerAndMonth(rows)

  return months.map((month) => ({ period: month, ...summarizePeriodChange(revenueByCustomer, month, shiftMonth(month, -1)) }))
}

/** Trailing 3 years, each compared to the year right before it — rolls the same month-grain rows up to year totals per customer. */
async function getAnnualTrend(orgId: string, itemId: string | undefined, requiredFrequency: ProductBillingFrequency): Promise<CustomerUpgradesTrendPoint[]> {
  const latestYear = Number(latestClosedMonth().slice(0, 4))
  const years = Array.from({ length: TRAILING_YEARS }, (_, i) => String(latestYear - (TRAILING_YEARS - 1 - i)))
  const from = new Date(Date.UTC(Number(years[0]) - 1, 0, 1)) // one extra year back, as the baseline for the first bar
  const to = new Date(Date.UTC(latestYear, 11, 31, 23, 59, 59, 999))

  const rows = await getRevenueRows(orgId, from, to, itemId, requiredFrequency)
  const revenueByCustomerYear = new Map<string, Map<string, number>>()
  for (const row of rows) {
    const year = row.month.slice(0, 4)
    if (!revenueByCustomerYear.has(row.customerRecordId)) revenueByCustomerYear.set(row.customerRecordId, new Map())
    const yearTotals = revenueByCustomerYear.get(row.customerRecordId)!
    yearTotals.set(year, (yearTotals.get(year) ?? 0) + row.revenue)
  }

  return years.map((year) => ({ period: year, ...summarizePeriodChange(revenueByCustomerYear, year, String(Number(year) - 1)) }))
}

/**
 * The dashboard's "customer upgrades"/"customer downgrades"/"customer
 * churn"/"customer retention (GRR/NRR)" trend for one recurring product:
 * how many customers' invoiced revenue for that product went up, went
 * down, or dropped to $0 from one period to the next — the ABC-customer-
 * $100-then-$115 example — plotted every period rather than just the
 * current one, plus that product's own GRR/NRR derived from the same
 * numbers. Everything is computed together in the same pass (see
 * `summarizePeriodChange`); the "Customer upgrades," "Customer
 * downgrades," "Customer churn," and "Customer retention" cards all call
 * this same function and just read whichever part of each point they care
 * about.
 *
 * `itemId` scopes everything to one product; omitting it ("All products")
 * blends every recurring product billed on the required frequency into one
 * series instead — a customer then "upgrades"/"downgrades"/"churns" based
 * on their combined spend across all of those products, same definition
 * VC-01/VC-02's org-wide recurring roll-forward already uses. Either way,
 * only products categorized `recurring` whose `billingFrequency` matches
 * the chosen granularity are ever in scope: 'monthly' needs monthly-billed
 * product(s), 'annually' needs yearly-billed one(s). Quarterly-billed
 * products have no view here (the two granularities offered are monthly
 * and annual only).
 */
export async function getCustomerUpgradesTrend(orgId: string, itemId: string | undefined, granularity: CustomerUpgradesTrendGranularity): Promise<CustomerUpgradesTrendResult> {
  const requiredFrequency = granularity === 'monthly' ? 'monthly' : 'yearly'
  const categorized = await productRepository.findCategorizedForOrg(orgId, QUICKBOOKS)

  if (itemId) {
    const product = categorized.find((p) => p.providerRecordId === itemId)
    if (!product || product.category !== 'recurring' || product.billingFrequency !== requiredFrequency) {
      return { hasData: false, points: [] }
    }
  } else if (!categorized.some((p) => p.category === 'recurring' && p.billingFrequency === requiredFrequency)) {
    // "All products" needs at least one eligible product to blend.
    return { hasData: false, points: [] }
  }

  const points = granularity === 'monthly' ? await getMonthlyTrend(orgId, itemId, requiredFrequency) : await getAnnualTrend(orgId, itemId, requiredFrequency)
  return { hasData: true, points }
}
