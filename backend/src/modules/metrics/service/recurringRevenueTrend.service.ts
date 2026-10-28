import { productRepository } from '../../sync/repository/product.repository'
import { invoiceRepository } from '../../sync/repository/invoice.repository'
import { getProductRecurringSplit } from './productRecurringRevenue.service'
import { latestClosedMonth, latestClosedQuarterStart, shiftMonth, monthRangeUtc } from './revenueRollForward.service'

const QUICKBOOKS = 'quickbooks'

// Matches sync.service.ts's TRAILING_QUARTERS — PLItemSnapshot is never synced
// further back than this, so asking for more would silently return nothing.
const TRAILING_QUARTERS = 6
// Same ~18-month window as the quarterly view, just bucketed by month instead of by quarter.
const TRAILING_MONTHS = TRAILING_QUARTERS * 3

export type RecurringRevenueTrendGranularity = 'monthly' | 'quarterly'

export interface RecurringRevenueTrendPoint {
  /** "YYYY-MM" — the month itself for 'monthly', the quarter's first month for 'quarterly'. */
  period: string
  recurringRevenue: number
  nonRecurringRevenue: number
  /** vs. the previous point in this series — null on the first point or when the prior period's revenue was 0. */
  recurringGrowthPct: number | null
  nonRecurringGrowthPct: number | null
}

export interface RecurringRevenueTrendResult {
  /** False when the org hasn't categorized any product yet — `points` is then empty rather than a misleading all-zero trend (same honest-numbers rule as VC-13). */
  hasCategorizedProducts: boolean
  /** True only for the 'monthly' view, when this org's invoices predate the `lines` field and haven't been backfilled by a forced resync yet — `points` is then empty rather than a near-zero trend made of only the handful of invoices synced since. */
  needsResync: boolean
  points: RecurringRevenueTrendPoint[]
}

function growthPct(current: number, prior: number): number | null {
  return prior > 0 ? ((current - prior) / prior) * 100 : null
}

function withGrowth(periods: string[], revenues: { recurring: number; nonRecurring: number }[]): RecurringRevenueTrendPoint[] {
  return periods.map((period, index) => {
    const { recurring, nonRecurring } = revenues[index]
    const prior = index > 0 ? revenues[index - 1] : null
    return {
      period,
      recurringRevenue: recurring,
      nonRecurringRevenue: nonRecurring,
      recurringGrowthPct: prior ? growthPct(recurring, prior.recurring) : null,
      nonRecurringGrowthPct: prior ? growthPct(nonRecurring, prior.nonRecurring) : null
    }
  })
}

/** Trailing 6 quarters via `getProductRecurringSplit` (PLItemSnapshot) — the same P&L-sourced split VC-13 uses for a single quarter. */
async function getQuarterlyTrend(orgId: string): Promise<RecurringRevenueTrendPoint[]> {
  const latestQuarterStart = latestClosedQuarterStart(latestClosedMonth())
  const quarterStarts = Array.from({ length: TRAILING_QUARTERS }, (_, i) => shiftMonth(latestQuarterStart, -3 * (TRAILING_QUARTERS - 1 - i)))
  const splits = await Promise.all(quarterStarts.map((quarterStart) => getProductRecurringSplit(orgId, QUICKBOOKS, quarterStart)))
  return withGrowth(
    quarterStarts,
    splits.map((split) => ({ recurring: split.recurring, nonRecurring: split.nonRecurring }))
  )
}

/** Trailing 18 months, read directly from invoice line items — PLItemSnapshot has no monthly grain, so there's no pre-synced monthly P&L to read here the way the quarterly view does. */
async function getMonthlyTrend(orgId: string): Promise<RecurringRevenueTrendPoint[]> {
  const latestMonth = latestClosedMonth()
  const months = Array.from({ length: TRAILING_MONTHS }, (_, i) => shiftMonth(latestMonth, -(TRAILING_MONTHS - 1 - i)))
  const { start } = monthRangeUtc(months[0])
  const { end } = monthRangeUtc(months[months.length - 1])
  const rows = await invoiceRepository.getRevenueByCategoryAndMonth(orgId, QUICKBOOKS, start, end)

  const revenueByMonth = new Map<string, { recurring: number; nonRecurring: number }>()
  for (const month of months) revenueByMonth.set(month, { recurring: 0, nonRecurring: 0 })
  for (const row of rows) {
    const bucket = revenueByMonth.get(row.month)
    if (!bucket) continue // outside the requested window — shouldn't happen given the query range, but never trust aggregation output blindly
    if (row.category === 'recurring') bucket.recurring += row.revenue
    else bucket.nonRecurring += row.revenue
  }

  return withGrowth(
    months,
    months.map((month) => revenueByMonth.get(month)!)
  )
}

/**
 * The dashboard's recurring-vs-non-recurring revenue trend chart. Two
 * selectable granularities, both covering the same ~18-month window:
 * - 'quarterly' (default): the trailing 6 quarters via `getProductRecurringSplit`.
 * - 'monthly': the trailing 18 months, read from invoice line items joined
 *   to `Product.category` (see `getMonthlyTrend` above for why).
 * Both are gated on the same "has anything been categorized yet" check —
 * never guesses, never shows a fabricated all-zero trend.
 */
export async function getRecurringRevenueTrend(orgId: string, granularity: RecurringRevenueTrendGranularity = 'quarterly'): Promise<RecurringRevenueTrendResult> {
  const categorized = await productRepository.findCategorizedForOrg(orgId, QUICKBOOKS)
  if (categorized.length === 0) {
    return { hasCategorizedProducts: false, needsResync: false, points: [] }
  }

  if (granularity === 'monthly' && !(await invoiceRepository.hasAnyLineItems(orgId, QUICKBOOKS))) {
    return { hasCategorizedProducts: true, needsResync: true, points: [] }
  }

  const points = granularity === 'monthly' ? await getMonthlyTrend(orgId) : await getQuarterlyTrend(orgId)
  return { hasCategorizedProducts: true, needsResync: false, points }
}
