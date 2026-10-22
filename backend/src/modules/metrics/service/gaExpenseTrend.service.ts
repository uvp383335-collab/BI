import { organizationsRepository } from '../../organizations/repository/organizations.repository'
import { plMonthlySnapshotRepository } from '../../sync/repository/plMonthlySnapshot.repository'
import { getStoredProfitAndLoss } from './plReport.service'
import { sumColumn, sumConfiguredAccountIds } from './plParser'
import { latestClosedMonth, latestClosedQuarterStart, shiftMonth } from './revenueRollForward.service'

const QUICKBOOKS = 'quickbooks'

// Matches sync.service.ts's TRAILING_QUARTERS — PLSnapshot is never synced further back than this.
const TRAILING_QUARTERS = 6
// Same ~18-month window `recurringRevenueTrend.service.ts`'s monthly view uses.
const TRAILING_MONTHS_FOR_MONTHLY_VIEW = 18
// Matches sync.service.ts's TRAILING_MONTHS_FOR_GA / 12 — at most 3 trailing 12-month chunks.
const TRAILING_YEARS = 3

export type GAndAExpenseTrendGranularity = 'monthly' | 'quarterly' | 'yearly'

export interface GAndAExpenseTrendPoint {
  /** "YYYY-MM" (the month itself for 'monthly', the quarter's first month for 'quarterly') or "YYYY" for 'yearly'. */
  period: string
  revenue: number
  gaExpense: number
  /** null when revenue was 0 for this period — never a divide-by-zero guess. */
  gaPct: number | null
}

export interface GAndAExpenseTrendResult {
  /** False when the org hasn't picked any G&A accounts in Settings yet — `points` is then empty rather than a misleading all-zero trend. */
  hasConfiguredAccounts: boolean
  points: GAndAExpenseTrendPoint[]
}

function round1(n: number): number {
  return Math.round(n * 10) / 10
}

function toPoint(period: string, revenue: number, gaExpense: number): GAndAExpenseTrendPoint {
  const gaPct = revenue > 0 ? (gaExpense / revenue) * 100 : null
  return { period, revenue: round1(revenue), gaExpense: round1(gaExpense), gaPct: gaPct !== null ? round1(gaPct) : null }
}

/** Trailing 6 quarters via `PLSnapshot` — same stored source VC-04/10/13 read, never a live QuickBooks call. */
async function getQuarterlyTrend(orgId: string, accountIds: Set<string>): Promise<GAndAExpenseTrendPoint[]> {
  const latestQuarterStart = latestClosedQuarterStart(latestClosedMonth())
  const quarterStarts = Array.from({ length: TRAILING_QUARTERS }, (_, i) => shiftMonth(latestQuarterStart, -3 * (TRAILING_QUARTERS - 1 - i)))
  const snapshots = await Promise.all(quarterStarts.map((quarterStart) => getStoredProfitAndLoss(orgId, QUICKBOOKS, quarterStart)))

  const points: GAndAExpenseTrendPoint[] = []
  quarterStarts.forEach((quarterStart, i) => {
    const pl = snapshots[i]
    if (!pl) return // not synced yet -- skip rather than fabricate a zero point
    const revenue = sumColumn(pl.income, 'Total')
    const gaExpense = sumConfiguredAccountIds(pl, accountIds, 'Total')
    points.push(toPoint(quarterStart, revenue, gaExpense))
  })
  return points
}

/** Trailing 18 of the up-to-36 stored `PLMonthlySnapshot` months. */
async function getMonthlyTrend(orgId: string, accountIds: Set<string>): Promise<GAndAExpenseTrendPoint[]> {
  const snapshots = await plMonthlySnapshotRepository.findAllForOrg(orgId, QUICKBOOKS)
  return snapshots.slice(-TRAILING_MONTHS_FOR_MONTHLY_VIEW).map((snapshot) => {
    const revenue = sumColumn(snapshot.income, 'Total')
    const gaExpense = sumConfiguredAccountIds(snapshot, accountIds, 'Total')
    return toPoint(snapshot.month, revenue, gaExpense)
  })
}

/**
 * Groups the stored monthly snapshots into trailing 12-month chunks (not
 * calendar-year-aligned — the 36-month sync window is anchored to "now",
 * not to January) and sums each chunk. A trailing remainder shorter than 12
 * months is dropped rather than shown as a misleadingly-small "year".
 * Labeled by the chunk's last month's year, since each chunk is "the 12
 * months ending in that year."
 */
async function getYearlyTrend(orgId: string, accountIds: Set<string>): Promise<GAndAExpenseTrendPoint[]> {
  const snapshots = await plMonthlySnapshotRepository.findAllForOrg(orgId, QUICKBOOKS)

  const chunks: (typeof snapshots)[] = []
  let end = snapshots.length
  while (end - 12 >= 0) {
    chunks.unshift(snapshots.slice(end - 12, end))
    end -= 12
  }

  return chunks.slice(-TRAILING_YEARS).map((chunk) => {
    let revenue = 0
    let gaExpense = 0
    for (const snapshot of chunk) {
      revenue += sumColumn(snapshot.income, 'Total')
      gaExpense += sumConfiguredAccountIds(snapshot, accountIds, 'Total')
    }
    const label = chunk[chunk.length - 1].month.slice(0, 4)
    return toPoint(label, revenue, gaExpense)
  })
}

/**
 * G&A % of Revenue — org picks exactly which QuickBooks P&L Expense/Other-
 * Expense accounts count as G&A in Settings (`Organization.settings.gaExpenseAccountIds`,
 * never guessed from account names), the metric sums those accounts ÷ total
 * revenue. All three granularities read pre-synced storage only
 * (`PLSnapshot` for quarterly, `PLMonthlySnapshot` for monthly/yearly) — zero
 * live QuickBooks calls at dashboard-request time.
 */
export async function getGAndAExpenseTrend(orgId: string, granularity: GAndAExpenseTrendGranularity = 'quarterly'): Promise<GAndAExpenseTrendResult> {
  const org = await organizationsRepository.findById(orgId)
  const gaExpenseAccountIds = org?.settings?.gaExpenseAccountIds ?? []
  if (gaExpenseAccountIds.length === 0) {
    return { hasConfiguredAccounts: false, points: [] }
  }

  const accountIds = new Set(gaExpenseAccountIds)
  const points =
    granularity === 'monthly'
      ? await getMonthlyTrend(orgId, accountIds)
      : granularity === 'yearly'
        ? await getYearlyTrend(orgId, accountIds)
        : await getQuarterlyTrend(orgId, accountIds)

  return { hasConfiguredAccounts: true, points }
}
