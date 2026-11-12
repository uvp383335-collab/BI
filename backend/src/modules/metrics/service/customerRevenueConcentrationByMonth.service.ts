import { invoiceRepository } from '../../sync/repository/invoice.repository'
import { quickBooksCustomerRepository } from '../../sync/repository/quickBooksCustomer.repository'

const QUICKBOOKS_PROVIDER = 'quickbooks'
const round1 = (n: number): number => Math.round(n * 10) / 10

export type CustomerRevenueConcentrationByMonthGranularity = 'monthly' | 'quarterly' | 'yearly'

// How many calendar months one period spans, per granularity — same grain
// convention as cmMetrics.service.ts's GRANULARITY_MONTHS.
const GRANULARITY_MONTHS: Record<CustomerRevenueConcentrationByMonthGranularity, number> = { monthly: 1, quarterly: 3, yearly: 12 }
// Trailing periods shown: a year of months, two years of quarters, five years
// of years — same defaults as cmMetrics.service.ts's GRANULARITY_DEFAULT_PERIODS.
const TRAILING_PERIODS: Record<CustomerRevenueConcentrationByMonthGranularity, number> = { monthly: 12, quarterly: 8, yearly: 5 }

export interface CustomerRevenueConcentrationMonthPoint {
  periodStart: string
  top10Pct: number
  top10Revenue: number
  totalRevenue: number
}

export interface CustomerRevenueConcentrationByMonthResult {
  points: CustomerRevenueConcentrationMonthPoint[]
}

/** First month ("YYYY-MM") of the calendar-aligned period containing `month` — quarterly periods align to Jan/Apr/Jul/Oct, yearly to Jan, same alignment as cmMetrics.service.ts's periodStartOf. */
function periodStartOf(month: string, periodMonths: number): string {
  if (periodMonths === 1) return month
  const [year, mo] = month.split('-').map(Number)
  const periodFirstMonth = Math.floor((mo - 1) / periodMonths) * periodMonths + 1
  return `${year}-${String(periodFirstMonth).padStart(2, '0')}`
}

/**
 * Dashboard chart below "Customer Concentration": the same top-10-of-total
 * revenue ratio, traced over time at monthly/quarterly/yearly granularity
 * (button group, same convention as "Funnel Conversion Trends" and
 * "Opportunities by Lead Source by Month") instead of collapsed to one
 * all-time figure — each point re-ranks that period's customers
 * independently (the top 10 in Q1 aren't necessarily the top 10 in Q2), so
 * this answers "is concentration trending up or down," which the all-time
 * chart above can't. Same subsidiary roll-up as
 * CM-02/getCustomerRevenueConcentration (QuickBooks `Customer.ParentRef`)
 * and the same optional `itemId` product narrowing. Periods with no
 * invoiced revenue are omitted rather than plotted as a 0%. Trailing
 * window only (12 months / 8 quarters / 5 years) — older periods are
 * dropped after sorting, not included and left for the client to slice.
 * QuickBooks-only.
 */
export async function getCustomerRevenueConcentrationByMonth(
  orgId: string,
  itemId?: string,
  granularity: CustomerRevenueConcentrationByMonthGranularity = 'monthly'
): Promise<CustomerRevenueConcentrationByMonthResult> {
  const [rows, customers] = await Promise.all([
    invoiceRepository.getAllMonthlyRevenueByCustomer(orgId, QUICKBOOKS_PROVIDER, itemId),
    quickBooksCustomerRepository.findAll(orgId, QUICKBOOKS_PROVIDER)
  ])

  const periodMonths = GRANULARITY_MONTHS[granularity]
  const parentById = new Map(customers.map((c) => [c.providerRecordId, c.parentRecordId]))

  function resolveRootId(customerId: string): string {
    const visited = new Set<string>()
    let current = customerId
    for (;;) {
      const parent = parentById.get(current)
      if (!parent || visited.has(current)) return current
      visited.add(current)
      current = parent
    }
  }

  const revenueByPeriodAndRoot = new Map<string, Map<string, number>>()
  for (const row of rows) {
    const rootId = resolveRootId(row.customerRecordId)
    const period = periodStartOf(row.month, periodMonths)
    const revenueByRoot = revenueByPeriodAndRoot.get(period) ?? new Map<string, number>()
    revenueByRoot.set(rootId, (revenueByRoot.get(rootId) ?? 0) + row.revenue)
    revenueByPeriodAndRoot.set(period, revenueByRoot)
  }

  const points = Array.from(revenueByPeriodAndRoot.entries())
    .map(([periodStart, revenueByRoot]) => {
      const sorted = Array.from(revenueByRoot.values()).sort((a, b) => b - a)
      const totalRevenue = sorted.reduce((sum, revenue) => sum + revenue, 0)
      const top10Revenue = sorted.slice(0, 10).reduce((sum, revenue) => sum + revenue, 0)
      return {
        periodStart,
        top10Pct: totalRevenue > 0 ? round1((top10Revenue / totalRevenue) * 100) : 0,
        top10Revenue: round1(top10Revenue),
        totalRevenue: round1(totalRevenue)
      }
    })
    .sort((a, b) => a.periodStart.localeCompare(b.periodStart))

  return { points: points.slice(-TRAILING_PERIODS[granularity]) }
}

export interface CustomerRevenueConcentrationByMonthTopCustomer {
  customerId: string
  customerName: string
  revenue: number
  pctOfTotal: number
}

export interface CustomerRevenueConcentrationByMonthDetailPeriod extends CustomerRevenueConcentrationMonthPoint {
  /** Which customers made up this period's top 10 and how much each contributed — the chart itself only plots the blended top10Revenue/top10Pct, not the per-customer breakdown. */
  topCustomers: CustomerRevenueConcentrationByMonthTopCustomer[]
}

export interface CustomerRevenueConcentrationByMonthDetailLine {
  providerRecordId: string
  /** The actual billed customer — may be a subsidiary of rootCustomerId, not the root itself. */
  customerRecordId: string
  customerName: string
  rootCustomerId: string
  rootCustomerName: string
  periodStart: string
  /** "YYYY-MM-DD" */
  txnDate: string
  amount: number
}

export interface CustomerRevenueConcentrationByMonthDetailResult {
  periods: CustomerRevenueConcentrationByMonthDetailPeriod[]
  /** Every synced invoice (or invoice line, when filtered by product) billed to a period's top 10 customers (or their subsidiaries) — sums to that period's topCustomers[].revenue exactly. Scoped to the displayed trailing window, not all-time. */
  lines: CustomerRevenueConcentrationByMonthDetailLine[]
}

/**
 * Record-level backing data for "Customer Concentration by Month" — which
 * customers made up each displayed period's top 10 (identity the aggregate
 * above discards once it's collapsed to a blended top10Revenue/top10Pct),
 * plus every synced invoice (or invoice line, when `itemId` is given) behind
 * each period's top 10, for the chart's "export to Excel" verification
 * button. Recomputes the same period/ranking logic as
 * getCustomerRevenueConcentrationByMonth (not passed in from the client), then
 * narrows the line-level query to `[earliest displayed period, now]` and just
 * the customer ids that were ever in a displayed period's top 10 — pulling
 * every invoice line for every customer across all time would dwarf the
 * chart this is meant to verify. A line only appears under a given period if
 * its own root customer was actually that period's top 10 (not merely in
 * range), so the lines under one period sum to that period's topCustomers
 * revenue exactly.
 */
export async function getCustomerRevenueConcentrationByMonthDetail(
  orgId: string,
  itemId?: string,
  granularity: CustomerRevenueConcentrationByMonthGranularity = 'monthly'
): Promise<CustomerRevenueConcentrationByMonthDetailResult> {
  const [rows, customers] = await Promise.all([
    invoiceRepository.getAllMonthlyRevenueByCustomer(orgId, QUICKBOOKS_PROVIDER, itemId),
    quickBooksCustomerRepository.findAll(orgId, QUICKBOOKS_PROVIDER)
  ])

  const periodMonths = GRANULARITY_MONTHS[granularity]
  const parentById = new Map(customers.map((c) => [c.providerRecordId, c.parentRecordId]))
  const nameById = new Map(customers.map((c) => [c.providerRecordId, c.displayName ?? c.providerRecordId]))

  function resolveRootId(customerId: string): string {
    const visited = new Set<string>()
    let current = customerId
    for (;;) {
      const parent = parentById.get(current)
      if (!parent || visited.has(current)) return current
      visited.add(current)
      current = parent
    }
  }

  const revenueByPeriodAndRoot = new Map<string, Map<string, number>>()
  for (const row of rows) {
    const rootId = resolveRootId(row.customerRecordId)
    const period = periodStartOf(row.month, periodMonths)
    const revenueByRoot = revenueByPeriodAndRoot.get(period) ?? new Map<string, number>()
    revenueByRoot.set(rootId, (revenueByRoot.get(rootId) ?? 0) + row.revenue)
    revenueByPeriodAndRoot.set(period, revenueByRoot)
  }

  const allPeriods = Array.from(revenueByPeriodAndRoot.entries())
    .map(([periodStart, revenueByRoot]) => {
      const sortedEntries = Array.from(revenueByRoot.entries()).sort((a, b) => b[1] - a[1])
      const totalRevenue = sortedEntries.reduce((sum, [, revenue]) => sum + revenue, 0)
      const top10Entries = sortedEntries.slice(0, 10)
      const top10Revenue = top10Entries.reduce((sum, [, revenue]) => sum + revenue, 0)
      const topCustomers: CustomerRevenueConcentrationByMonthTopCustomer[] = top10Entries.map(([customerId, revenue]) => ({
        customerId,
        customerName: nameById.get(customerId) ?? customerId,
        revenue: round1(revenue),
        pctOfTotal: totalRevenue > 0 ? round1((revenue / totalRevenue) * 100) : 0
      }))
      return {
        periodStart,
        top10Pct: totalRevenue > 0 ? round1((top10Revenue / totalRevenue) * 100) : 0,
        top10Revenue: round1(top10Revenue),
        totalRevenue: round1(totalRevenue),
        topCustomers
      }
    })
    .sort((a, b) => a.periodStart.localeCompare(b.periodStart))

  const periods = allPeriods.slice(-TRAILING_PERIODS[granularity])

  const topRootIdsByPeriod = new Map<string, Set<string>>(periods.map((p) => [p.periodStart, new Set(p.topCustomers.map((c) => c.customerId))]))
  const neededRootIds = new Set<string>()
  for (const rootIds of topRootIdsByPeriod.values()) for (const id of rootIds) neededRootIds.add(id)

  const rootByCustomerId = new Map<string, string>()
  for (const customer of customers) {
    const root = resolveRootId(customer.providerRecordId)
    if (neededRootIds.has(root)) rootByCustomerId.set(customer.providerRecordId, root)
  }
  // The root itself might not be in `customers` as a distinct row if it only ever appears as a parent reference — make sure every needed root maps to itself too.
  for (const rootId of neededRootIds) rootByCustomerId.set(rootId, rootId)

  const lines: CustomerRevenueConcentrationByMonthDetailLine[] = []
  if (periods.length > 0) {
    const customerIdsToQuery = Array.from(rootByCustomerId.keys())
    const from = new Date(`${periods[0].periodStart}-01T00:00:00.000Z`)
    const to = new Date()
    const invoiceLines = await invoiceRepository.getInvoiceLinesForCustomers(orgId, QUICKBOOKS_PROVIDER, customerIdsToQuery, itemId, from, to)

    const rootNameByPeriodAndId = new Map<string, Map<string, string>>(
      periods.map((p) => [p.periodStart, new Map(p.topCustomers.map((c) => [c.customerId, c.customerName]))])
    )

    for (const line of invoiceLines) {
      const rootCustomerId = rootByCustomerId.get(line.customerRecordId)
      if (!rootCustomerId) continue
      const period = periodStartOf(line.txnDate.toISOString().slice(0, 7), periodMonths)
      const topRootIdsThisPeriod = topRootIdsByPeriod.get(period)
      if (!topRootIdsThisPeriod || !topRootIdsThisPeriod.has(rootCustomerId)) continue
      lines.push({
        providerRecordId: line.providerRecordId,
        customerRecordId: line.customerRecordId,
        customerName: nameById.get(line.customerRecordId) ?? line.customerRecordId,
        rootCustomerId,
        rootCustomerName: rootNameByPeriodAndId.get(period)?.get(rootCustomerId) ?? rootCustomerId,
        periodStart: period,
        txnDate: line.txnDate.toISOString().slice(0, 10),
        amount: line.amount
      })
    }

    lines.sort((a, b) => a.periodStart.localeCompare(b.periodStart) || a.rootCustomerName.localeCompare(b.rootCustomerName) || a.txnDate.localeCompare(b.txnDate))
  }

  return { periods, lines }
}
