import { organizationsRepository } from '../../organizations/repository/organizations.repository'
import { plMonthlySnapshotRepository } from '../../sync/repository/plMonthlySnapshot.repository'
import { invoiceRepository } from '../../sync/repository/invoice.repository'
import { sumConfiguredAccountIds } from './plParser'
import { monthRangeUtc } from './revenueRollForward.service'

const QUICKBOOKS = 'quickbooks'

export interface CACTrendPoint {
  /** "YYYY-MM" of the window's first month — equal to `periodEnd` when the org's duration is 1. */
  periodStart: string
  /** "YYYY-MM" of the window's last month. */
  periodEnd: string
  expense: number
  newCustomers: number
  /** null when the window had 0 new customers — never a divide-by-zero guess. */
  cac: number | null
}

export interface CACTrendResult {
  /** False when the org hasn't picked CAC accounts AND a duration in Settings yet — `points` is then empty. */
  hasConfiguredSettings: boolean
  points: CACTrendPoint[]
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

/**
 * Customer Acquisition Cost — org picks which QuickBooks P&L expense
 * accounts count as acquisition spend AND a window size in months
 * (`Organization.settings.cacExpenseAccountIds` / `cacDurationMonths`,
 * Settings-configured, never a request-time toggle like G&A's granularity).
 * Spend and new-customer counts are summed over **non-overlapping**
 * consecutive windows of that size — e.g. a 2-month duration buckets
 * Jan+Feb as one window, then Mar+Apr as the next, never a sliding
 * month-over-month average. Windows are chunked from the most recent
 * synced month backward (same algorithm `gaExpenseTrend.service.ts`'s
 * yearly view uses for its 12-month chunks) since the synced window itself
 * isn't calendar-aligned to January; an incomplete leading (oldest)
 * remainder shorter than the duration is dropped rather than shown as a
 * misleadingly small bucket.
 *
 * Both data sources are already pre-synced storage — zero live QuickBooks
 * calls at dashboard-request time:
 * - Spend: `PLMonthlySnapshot` (same monthly storage G&A's monthly/yearly
 *   views read), summed over the configured account ids.
 * - New customers: `invoiceRepository.getNewCustomerCountsByMonth` (the
 *   same primitive `newCustomersTrend.service.ts` uses), with no `itemId`
 *   filter — CAC counts customers new to the business across every
 *   product, not customers new to one specific product.
 */
export async function getCACTrend(orgId: string): Promise<CACTrendResult> {
  const org = await organizationsRepository.findById(orgId)
  const cacExpenseAccountIds = org?.settings?.cacExpenseAccountIds ?? []
  const cacDurationMonths = org?.settings?.cacDurationMonths
  if (cacExpenseAccountIds.length === 0 || !cacDurationMonths) {
    return { hasConfiguredSettings: false, points: [] }
  }

  const snapshots = await plMonthlySnapshotRepository.findAllForOrg(orgId, QUICKBOOKS)
  if (snapshots.length === 0) {
    return { hasConfiguredSettings: true, points: [] }
  }

  const { start } = monthRangeUtc(snapshots[0].month)
  const { end } = monthRangeUtc(snapshots[snapshots.length - 1].month)
  const newCustomerRows = await invoiceRepository.getNewCustomerCountsByMonth(orgId, QUICKBOOKS, start, end)
  const newCustomersByMonth = new Map(newCustomerRows.map((row) => [row.month, row.count]))

  const accountIds = new Set(cacExpenseAccountIds)

  const chunks: (typeof snapshots)[] = []
  let endIndex = snapshots.length
  while (endIndex - cacDurationMonths >= 0) {
    chunks.unshift(snapshots.slice(endIndex - cacDurationMonths, endIndex))
    endIndex -= cacDurationMonths
  }

  const points = chunks.map((chunk) => {
    let expense = 0
    let newCustomers = 0
    for (const snapshot of chunk) {
      expense += sumConfiguredAccountIds(snapshot, accountIds, 'Total')
      newCustomers += newCustomersByMonth.get(snapshot.month) ?? 0
    }
    const cac = newCustomers > 0 ? round2(expense / newCustomers) : null
    return { periodStart: chunk[0].month, periodEnd: chunk[chunk.length - 1].month, expense: round2(expense), newCustomers, cac }
  })

  return { hasConfiguredSettings: true, points }
}
