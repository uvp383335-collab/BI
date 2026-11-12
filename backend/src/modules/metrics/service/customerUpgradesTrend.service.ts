import { invoiceRepository } from '../../sync/repository/invoice.repository'
import { productRepository } from '../../sync/repository/product.repository'
import { quickBooksCustomerRepository } from '../../sync/repository/quickBooksCustomer.repository'
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
export interface CustomerUpgradesDetailEntry {
  customerRecordId: string
  priorRevenue: number
  currentRevenue: number
  /** currentRevenue - priorRevenue — negative for downgrade/churn. */
  delta: number
  bucket: 'upgrade' | 'downgrade' | 'churn'
}

/**
 * Same classification `summarizePeriodChange` below exposes as counts/amounts,
 * but keeping the per-customer rows behind them (`entries`) instead of only
 * the aggregate — the raw material for the dashboard's "export to Excel"
 * verification buttons on the upgrades/downgrades/churn cards.
 * `summarizePeriodChange` is a thin wrapper around this that strips
 * `entries` back off, so the aggregate cards and the detail export always
 * agree on the exact same classification.
 */
function summarizePeriodChangeWithEntries(
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
  entries: CustomerUpgradesDetailEntry[]
} {
  let upgradeCount = 0
  let upgradeAmount = 0
  let downgradeCount = 0
  let downgradeAmount = 0
  let churnCount = 0
  let churnAmount = 0
  let startingRevenue = 0
  const entries: CustomerUpgradesDetailEntry[] = []
  for (const [customerRecordId, periods] of revenueByCustomer) {
    const prev = periods.get(priorPeriod) ?? 0
    const curr = periods.get(period) ?? 0
    if (prev <= 0) continue // only existing customers (revenue last period) count toward starting revenue or any of the three buckets
    startingRevenue += prev
    if (curr > prev) {
      upgradeCount++
      upgradeAmount += curr - prev
      entries.push({ customerRecordId, priorRevenue: prev, currentRevenue: curr, delta: curr - prev, bucket: 'upgrade' })
    } else if (curr === 0) {
      churnCount++
      churnAmount += prev
      entries.push({ customerRecordId, priorRevenue: prev, currentRevenue: curr, delta: -prev, bucket: 'churn' })
    } else if (curr < prev) {
      downgradeCount++
      downgradeAmount += prev - curr
      entries.push({ customerRecordId, priorRevenue: prev, currentRevenue: curr, delta: curr - prev, bucket: 'downgrade' })
    }
  }
  const grrPct = startingRevenue > 0 ? ((startingRevenue - downgradeAmount - churnAmount) / startingRevenue) * 100 : null
  const nrrPct = startingRevenue > 0 ? ((startingRevenue - downgradeAmount - churnAmount + upgradeAmount) / startingRevenue) * 100 : null
  return { upgradeCount, upgradeAmount, downgradeCount, downgradeAmount, churnCount, churnAmount, startingRevenue, grrPct, nrrPct, entries }
}

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
  const { entries, ...rest } = summarizePeriodChangeWithEntries(revenueByCustomer, period, priorPeriod)
  return rest
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

export interface CustomerRetentionAdjustedPoint {
  /** "YYYY-MM" for 'monthly', "YYYY" for 'annually'. */
  period: string
  upgradeAmount: number
  downgradeAmount: number
  churnAmount: number
  /** Sum of every existing (not-yet-written-off) customer's prior-period revenue — the GRR/NRR denominator. */
  startingRevenue: number
  grrPct: number | null
  nrrPct: number | null
  /** How many customers would have counted as churned again this period, but were excluded because they'd already churned once earlier in this trend's window — see summarizePeriodChangeAdjusted. */
  suppressedChurnCount: number
  /** The $ this adjustment held back from churnAmount above — the gap between this card's churnAmount and the unadjusted "Customer retention" card's churnAmount for the same period. */
  suppressedChurnAmount: number
}

export interface CustomerRetentionAdjustedTrendResult {
  hasData: boolean
  points: CustomerRetentionAdjustedPoint[]
}

/**
 * Same classification as summarizePeriodChange, but once a customer has
 * registered one churn anywhere within this trend's window, they're
 * permanently excluded from every later period's startingRevenue/upgrade/
 * downgrade/churn accounting — not re-counted as a loss again just because
 * their billing is irregular (invoiced some months, skipped others) and
 * they happen to go quiet again, and not given retroactive "retained"
 * credit for the gap either (they're simply dropped from the comparison
 * going forward, the same as if they'd never had revenue at all). Addresses
 * a real distortion found in production data: several customers invoice on
 * a non-monthly cadence (e.g. every ~5 months) despite the product being
 * categorized monthly-recurring here — under a strict month-over-month
 * comparison every month they're not invoiced reads as a full churn, and
 * because a customer can only ever be "new" once (a reactivation can never
 * register as an upgrade — see invoiceRepository.getNewCustomerCountsByMonth),
 * their comebacks never credit anything back, so the same still-active
 * relationship can drag GRR/NRR down repeatedly with no offsetting signal.
 * `churnedOnce` is shared and mutated across the whole chronological period
 * loop (see getMonthlyTrendAdjusted/getAnnualTrendAdjusted), so a churn
 * recorded in an earlier period suppresses every later one for that same
 * customer.
 */
function summarizePeriodChangeAdjusted(
  revenueByCustomer: Map<string, Map<string, number>>,
  period: string,
  priorPeriod: string,
  churnedOnce: Set<string>
): {
  upgradeAmount: number
  downgradeAmount: number
  churnAmount: number
  startingRevenue: number
  grrPct: number | null
  nrrPct: number | null
  suppressedChurnCount: number
  suppressedChurnAmount: number
} {
  let upgradeAmount = 0
  let downgradeAmount = 0
  let churnAmount = 0
  let startingRevenue = 0
  let suppressedChurnCount = 0
  let suppressedChurnAmount = 0

  for (const [customerRecordId, periods] of revenueByCustomer) {
    const prev = periods.get(priorPeriod) ?? 0
    const curr = periods.get(period) ?? 0
    if (churnedOnce.has(customerRecordId)) {
      if (prev > 0 && curr === 0) {
        suppressedChurnCount++
        suppressedChurnAmount += prev
      }
      continue
    }
    if (prev <= 0) continue // only existing customers (revenue last period) count toward starting revenue or any of the three buckets
    startingRevenue += prev
    if (curr > prev) {
      upgradeAmount += curr - prev
    } else if (curr === 0) {
      churnAmount += prev
      churnedOnce.add(customerRecordId)
    } else if (curr < prev) {
      downgradeAmount += prev - curr
    }
  }

  const grrPct = startingRevenue > 0 ? ((startingRevenue - downgradeAmount - churnAmount) / startingRevenue) * 100 : null
  const nrrPct = startingRevenue > 0 ? ((startingRevenue - downgradeAmount - churnAmount + upgradeAmount) / startingRevenue) * 100 : null
  return { upgradeAmount, downgradeAmount, churnAmount, startingRevenue, grrPct, nrrPct, suppressedChurnCount, suppressedChurnAmount }
}

/** Adjusted counterpart to getMonthlyTrend — same months/comparison, but a customer's churn only ever counts once across the whole trailing window (see summarizePeriodChangeAdjusted). `churnedOnce` is created fresh per call and threaded through every month in chronological order. */
async function getMonthlyTrendAdjusted(orgId: string, itemId: string | undefined, requiredFrequency: ProductBillingFrequency): Promise<CustomerRetentionAdjustedPoint[]> {
  const latestMonth = latestClosedMonth()
  const months = Array.from({ length: TRAILING_MONTHS }, (_, i) => shiftMonth(latestMonth, -(TRAILING_MONTHS - 1 - i)))
  const { start } = monthRangeUtc(shiftMonth(months[0], -1))
  const { end } = monthRangeUtc(months[months.length - 1])

  const rows = await getRevenueRows(orgId, start, end, itemId, requiredFrequency)
  const revenueByCustomer = groupByCustomerAndMonth(rows)
  const churnedOnce = new Set<string>()

  return months.map((month) => ({ period: month, ...summarizePeriodChangeAdjusted(revenueByCustomer, month, shiftMonth(month, -1), churnedOnce) }))
}

/** Adjusted counterpart to getAnnualTrend — same years/comparison, same once-only churn rule as getMonthlyTrendAdjusted. */
async function getAnnualTrendAdjusted(orgId: string, itemId: string | undefined, requiredFrequency: ProductBillingFrequency): Promise<CustomerRetentionAdjustedPoint[]> {
  const latestYear = Number(latestClosedMonth().slice(0, 4))
  const years = Array.from({ length: TRAILING_YEARS }, (_, i) => String(latestYear - (TRAILING_YEARS - 1 - i)))
  const from = new Date(Date.UTC(Number(years[0]) - 1, 0, 1))
  const to = new Date(Date.UTC(latestYear, 11, 31, 23, 59, 59, 999))

  const rows = await getRevenueRows(orgId, from, to, itemId, requiredFrequency)
  const revenueByCustomerYear = new Map<string, Map<string, number>>()
  for (const row of rows) {
    const year = row.month.slice(0, 4)
    if (!revenueByCustomerYear.has(row.customerRecordId)) revenueByCustomerYear.set(row.customerRecordId, new Map())
    const yearTotals = revenueByCustomerYear.get(row.customerRecordId)!
    yearTotals.set(year, (yearTotals.get(year) ?? 0) + row.revenue)
  }
  const churnedOnce = new Set<string>()

  return years.map((year) => ({ period: year, ...summarizePeriodChangeAdjusted(revenueByCustomerYear, year, String(Number(year) - 1), churnedOnce) }))
}

/**
 * "Customer retention (GRR/NRR) — Adjusted," rendered directly below the
 * unadjusted "Customer retention" card for side-by-side comparison. Same
 * GRR/NRR math and eligibility rules as getCustomerUpgradesTrend above, but
 * a customer's revenue dropping to $0 only ever counts as a churn once
 * across this trend's trailing window instead of every time it happens —
 * see summarizePeriodChangeAdjusted for why that distinction matters.
 * Deliberately a separate card, not a replacement: whether a repeat churn
 * from an irregularly-billed customer should count again is a judgment
 * call, not a strictly more "correct" number, so both views stay available.
 */
export async function getCustomerRetentionTrendAdjusted(
  orgId: string,
  itemId: string | undefined,
  granularity: CustomerUpgradesTrendGranularity
): Promise<CustomerRetentionAdjustedTrendResult> {
  const requiredFrequency = granularity === 'monthly' ? 'monthly' : 'yearly'
  const categorized = await productRepository.findCategorizedForOrg(orgId, QUICKBOOKS)

  if (itemId) {
    const product = categorized.find((p) => p.providerRecordId === itemId)
    if (!product || product.category !== 'recurring' || product.billingFrequency !== requiredFrequency) {
      return { hasData: false, points: [] }
    }
  } else if (!categorized.some((p) => p.category === 'recurring' && p.billingFrequency === requiredFrequency)) {
    return { hasData: false, points: [] }
  }

  const points = granularity === 'monthly' ? await getMonthlyTrendAdjusted(orgId, itemId, requiredFrequency) : await getAnnualTrendAdjusted(orgId, itemId, requiredFrequency)
  return { hasData: true, points }
}

export interface CustomerRetentionAdjustedDetailEntry {
  customerRecordId: string
  priorRevenue: number
  currentRevenue: number
  /** currentRevenue - priorRevenue — negative for downgrade/churn/suppressed-churn. */
  delta: number
  /** 'suppressed-churn' is a customer who dropped to $0 again but was excluded from churnAmount because they'd already churned once earlier in this window — see summarizePeriodChangeAdjusted. */
  bucket: 'upgrade' | 'downgrade' | 'churn' | 'suppressed-churn'
}

/** summarizePeriodChangeAdjusted, plus the per-customer rows behind it (`entries`) — the raw material for the Adjusted retention card's "export to Excel" verification button. Mirrors summarizePeriodChangeWithEntries' relationship to summarizePeriodChange. */
function summarizePeriodChangeAdjustedWithEntries(
  revenueByCustomer: Map<string, Map<string, number>>,
  period: string,
  priorPeriod: string,
  churnedOnce: Set<string>
): {
  upgradeAmount: number
  downgradeAmount: number
  churnAmount: number
  startingRevenue: number
  grrPct: number | null
  nrrPct: number | null
  suppressedChurnCount: number
  suppressedChurnAmount: number
  entries: CustomerRetentionAdjustedDetailEntry[]
} {
  let upgradeAmount = 0
  let downgradeAmount = 0
  let churnAmount = 0
  let startingRevenue = 0
  let suppressedChurnCount = 0
  let suppressedChurnAmount = 0
  const entries: CustomerRetentionAdjustedDetailEntry[] = []

  for (const [customerRecordId, periods] of revenueByCustomer) {
    const prev = periods.get(priorPeriod) ?? 0
    const curr = periods.get(period) ?? 0
    if (churnedOnce.has(customerRecordId)) {
      if (prev > 0 && curr === 0) {
        suppressedChurnCount++
        suppressedChurnAmount += prev
        entries.push({ customerRecordId, priorRevenue: prev, currentRevenue: curr, delta: -prev, bucket: 'suppressed-churn' })
      }
      continue
    }
    if (prev <= 0) continue
    startingRevenue += prev
    if (curr > prev) {
      upgradeAmount += curr - prev
      entries.push({ customerRecordId, priorRevenue: prev, currentRevenue: curr, delta: curr - prev, bucket: 'upgrade' })
    } else if (curr === 0) {
      churnAmount += prev
      churnedOnce.add(customerRecordId)
      entries.push({ customerRecordId, priorRevenue: prev, currentRevenue: curr, delta: -prev, bucket: 'churn' })
    } else if (curr < prev) {
      downgradeAmount += prev - curr
      entries.push({ customerRecordId, priorRevenue: prev, currentRevenue: curr, delta: curr - prev, bucket: 'downgrade' })
    }
  }

  const grrPct = startingRevenue > 0 ? ((startingRevenue - downgradeAmount - churnAmount) / startingRevenue) * 100 : null
  const nrrPct = startingRevenue > 0 ? ((startingRevenue - downgradeAmount - churnAmount + upgradeAmount) / startingRevenue) * 100 : null
  return { upgradeAmount, downgradeAmount, churnAmount, startingRevenue, grrPct, nrrPct, suppressedChurnCount, suppressedChurnAmount, entries }
}

interface AdjustedPeriodWithEntries extends CustomerRetentionAdjustedPoint {
  entries: CustomerRetentionAdjustedDetailEntry[]
}

/** Detail counterpart to getMonthlyTrendAdjusted — same months/comparison/once-only churn rule, via summarizePeriodChangeAdjustedWithEntries instead of the aggregate-only wrapper. */
async function getMonthlyTrendAdjustedDetail(orgId: string, itemId: string | undefined, requiredFrequency: ProductBillingFrequency): Promise<AdjustedPeriodWithEntries[]> {
  const latestMonth = latestClosedMonth()
  const months = Array.from({ length: TRAILING_MONTHS }, (_, i) => shiftMonth(latestMonth, -(TRAILING_MONTHS - 1 - i)))
  const { start } = monthRangeUtc(shiftMonth(months[0], -1))
  const { end } = monthRangeUtc(months[months.length - 1])

  const rows = await getRevenueRows(orgId, start, end, itemId, requiredFrequency)
  const revenueByCustomer = groupByCustomerAndMonth(rows)
  const churnedOnce = new Set<string>()

  return months.map((month) => ({ period: month, ...summarizePeriodChangeAdjustedWithEntries(revenueByCustomer, month, shiftMonth(month, -1), churnedOnce) }))
}

/** Detail counterpart to getAnnualTrendAdjusted — same years/comparison/once-only churn rule as getMonthlyTrendAdjustedDetail. */
async function getAnnualTrendAdjustedDetail(orgId: string, itemId: string | undefined, requiredFrequency: ProductBillingFrequency): Promise<AdjustedPeriodWithEntries[]> {
  const latestYear = Number(latestClosedMonth().slice(0, 4))
  const years = Array.from({ length: TRAILING_YEARS }, (_, i) => String(latestYear - (TRAILING_YEARS - 1 - i)))
  const from = new Date(Date.UTC(Number(years[0]) - 1, 0, 1))
  const to = new Date(Date.UTC(latestYear, 11, 31, 23, 59, 59, 999))

  const rows = await getRevenueRows(orgId, from, to, itemId, requiredFrequency)
  const revenueByCustomerYear = new Map<string, Map<string, number>>()
  for (const row of rows) {
    const year = row.month.slice(0, 4)
    if (!revenueByCustomerYear.has(row.customerRecordId)) revenueByCustomerYear.set(row.customerRecordId, new Map())
    const yearTotals = revenueByCustomerYear.get(row.customerRecordId)!
    yearTotals.set(year, (yearTotals.get(year) ?? 0) + row.revenue)
  }
  const churnedOnce = new Set<string>()

  return years.map((year) => ({ period: year, ...summarizePeriodChangeAdjustedWithEntries(revenueByCustomerYear, year, String(Number(year) - 1), churnedOnce) }))
}

export interface CustomerRetentionAdjustedDetailEntryWithName extends CustomerRetentionAdjustedDetailEntry {
  customerName: string | null
}

export interface CustomerRetentionAdjustedPeriodDetail extends CustomerRetentionAdjustedPoint {
  /** Every existing customer behind this period's upgrade/downgrade/churn/suppressed-churn counts — classified the same way, just kept instead of collapsed. "Flat" customers and already-written-off ones with no $0 drop this period are omitted. */
  entries: CustomerRetentionAdjustedDetailEntryWithName[]
}

export interface CustomerRetentionAdjustedTrendDetailResult {
  hasData: boolean
  periods: CustomerRetentionAdjustedPeriodDetail[]
}

/**
 * Record-level backing data for getCustomerRetentionTrendAdjusted above —
 * every existing customer's prior/current revenue and which bucket they
 * fell into each period, including `suppressed-churn` for customers whose
 * repeat drop-to-zero was excluded from that period's churnAmount, for the
 * Adjusted retention card's "export to Excel" verification button. Lets
 * someone see exactly which customers' churns the adjustment held back,
 * not just the aggregate suppressedChurnCount/suppressedChurnAmount.
 */
export async function getCustomerRetentionTrendAdjustedDetail(
  orgId: string,
  itemId: string | undefined,
  granularity: CustomerUpgradesTrendGranularity
): Promise<CustomerRetentionAdjustedTrendDetailResult> {
  const requiredFrequency = granularity === 'monthly' ? 'monthly' : 'yearly'
  const categorized = await productRepository.findCategorizedForOrg(orgId, QUICKBOOKS)

  if (itemId) {
    const product = categorized.find((p) => p.providerRecordId === itemId)
    if (!product || product.category !== 'recurring' || product.billingFrequency !== requiredFrequency) {
      return { hasData: false, periods: [] }
    }
  } else if (!categorized.some((p) => p.category === 'recurring' && p.billingFrequency === requiredFrequency)) {
    return { hasData: false, periods: [] }
  }

  const [periodsRaw, customers] = await Promise.all([
    granularity === 'monthly' ? getMonthlyTrendAdjustedDetail(orgId, itemId, requiredFrequency) : getAnnualTrendAdjustedDetail(orgId, itemId, requiredFrequency),
    quickBooksCustomerRepository.findAll(orgId, QUICKBOOKS)
  ])
  const nameById = new Map(customers.map((c) => [c.providerRecordId, c.displayName ?? null]))

  const periods: CustomerRetentionAdjustedPeriodDetail[] = periodsRaw.map(({ entries, ...point }) => ({
    ...point,
    entries: entries.map((entry) => ({ ...entry, customerName: nameById.get(entry.customerRecordId) ?? null }))
  }))

  return { hasData: true, periods }
}

interface PeriodWithEntries extends CustomerUpgradesTrendPoint {
  entries: CustomerUpgradesDetailEntry[]
}

/** Detail counterpart to getMonthlyTrend — same months/comparison, via summarizePeriodChangeWithEntries instead of the aggregate-only wrapper. */
async function getMonthlyTrendDetail(orgId: string, itemId: string | undefined, requiredFrequency: ProductBillingFrequency): Promise<PeriodWithEntries[]> {
  const latestMonth = latestClosedMonth()
  const months = Array.from({ length: TRAILING_MONTHS }, (_, i) => shiftMonth(latestMonth, -(TRAILING_MONTHS - 1 - i)))
  const { start } = monthRangeUtc(shiftMonth(months[0], -1))
  const { end } = monthRangeUtc(months[months.length - 1])

  const rows = await getRevenueRows(orgId, start, end, itemId, requiredFrequency)
  const revenueByCustomer = groupByCustomerAndMonth(rows)

  return months.map((month) => ({ period: month, ...summarizePeriodChangeWithEntries(revenueByCustomer, month, shiftMonth(month, -1)) }))
}

/** Detail counterpart to getAnnualTrend — same years/comparison, via summarizePeriodChangeWithEntries instead of the aggregate-only wrapper. */
async function getAnnualTrendDetail(orgId: string, itemId: string | undefined, requiredFrequency: ProductBillingFrequency): Promise<PeriodWithEntries[]> {
  const latestYear = Number(latestClosedMonth().slice(0, 4))
  const years = Array.from({ length: TRAILING_YEARS }, (_, i) => String(latestYear - (TRAILING_YEARS - 1 - i)))
  const from = new Date(Date.UTC(Number(years[0]) - 1, 0, 1))
  const to = new Date(Date.UTC(latestYear, 11, 31, 23, 59, 59, 999))

  const rows = await getRevenueRows(orgId, from, to, itemId, requiredFrequency)
  const revenueByCustomerYear = new Map<string, Map<string, number>>()
  for (const row of rows) {
    const year = row.month.slice(0, 4)
    if (!revenueByCustomerYear.has(row.customerRecordId)) revenueByCustomerYear.set(row.customerRecordId, new Map())
    const yearTotals = revenueByCustomerYear.get(row.customerRecordId)!
    yearTotals.set(year, (yearTotals.get(year) ?? 0) + row.revenue)
  }

  return years.map((year) => ({ period: year, ...summarizePeriodChangeWithEntries(revenueByCustomerYear, year, String(Number(year) - 1)) }))
}

export interface CustomerUpgradesDetailEntryWithName extends CustomerUpgradesDetailEntry {
  customerName: string | null
}

export interface CustomerUpgradesPeriodDetail extends CustomerUpgradesTrendPoint {
  /** Every existing customer behind this period's upgrade/downgrade/churn counts — classified the same way, just kept instead of collapsed. "Flat" customers (current === prior, in none of the three buckets) are omitted, same as the aggregate. */
  entries: CustomerUpgradesDetailEntryWithName[]
}

export interface CustomerUpgradesTrendDetailResult {
  hasData: boolean
  periods: CustomerUpgradesPeriodDetail[]
}

/**
 * Record-level backing data for getCustomerUpgradesTrend above — every
 * existing customer's prior/current revenue and which bucket (upgrade,
 * downgrade, or churn) they fell into each period, for the "export to
 * Excel" verification button shared by the Upgrades/Downgrades/Churn cards.
 * Each card calls this with its own product/granularity selection (same as
 * the aggregate) and the shared export util picks which bucket to show.
 */
export async function getCustomerUpgradesTrendDetail(
  orgId: string,
  itemId: string | undefined,
  granularity: CustomerUpgradesTrendGranularity
): Promise<CustomerUpgradesTrendDetailResult> {
  const requiredFrequency = granularity === 'monthly' ? 'monthly' : 'yearly'
  const categorized = await productRepository.findCategorizedForOrg(orgId, QUICKBOOKS)

  if (itemId) {
    const product = categorized.find((p) => p.providerRecordId === itemId)
    if (!product || product.category !== 'recurring' || product.billingFrequency !== requiredFrequency) {
      return { hasData: false, periods: [] }
    }
  } else if (!categorized.some((p) => p.category === 'recurring' && p.billingFrequency === requiredFrequency)) {
    return { hasData: false, periods: [] }
  }

  const [periodsRaw, customers] = await Promise.all([
    granularity === 'monthly' ? getMonthlyTrendDetail(orgId, itemId, requiredFrequency) : getAnnualTrendDetail(orgId, itemId, requiredFrequency),
    quickBooksCustomerRepository.findAll(orgId, QUICKBOOKS)
  ])
  const nameById = new Map(customers.map((c) => [c.providerRecordId, c.displayName ?? null]))

  const periods: CustomerUpgradesPeriodDetail[] = periodsRaw.map(({ entries, ...point }) => ({
    ...point,
    entries: entries.map((entry) => ({ ...entry, customerName: nameById.get(entry.customerRecordId) ?? null }))
  }))

  return { hasData: true, periods }
}
