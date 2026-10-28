import { invoiceRepository } from '../../sync/repository/invoice.repository'
import { latestClosedMonth, shiftMonth, monthRangeUtc } from './revenueRollForward.service'

const QUICKBOOKS = 'quickbooks'

export interface NewCustomersTrendPoint {
  /** "YYYY-MM" */
  month: string
  /** The "customer wise" view. */
  newCustomerCount: number
  /** Total revenue from each new customer's first invoice (or, with `itemId`, that invoice's matching line items only) — the "amount wise" view. */
  newCustomerAmount: number
}

export interface NewCustomersTrendResult {
  /** False when this org has no synced invoices at all yet — `points` is then empty rather than an all-zero trend that reads as "zero new customers" instead of "nothing synced yet." */
  hasInvoices: boolean
  points: NewCustomersTrendPoint[]
}

/**
 * The dashboard's "new customers" trend — how many customers' very first
 * invoice ever fell in each month, read directly from `Invoice`
 * (`invoiceRepository.getNewCustomerCountsByMonth`). Monthly series from
 * January of `fromYear` (default: the year `latestClosedMonth` falls in)
 * through the latest closed month — same "From year" convention as
 * `computeMetricTrend`'s trend cards in this section.
 *
 * Deliberately separate from VC-03 (New-Logo Revenue Growth): VC-03 tracks
 * *revenue* from new customers between two specific snapshot months (a
 * roll-forward), which is a different question from "how many distinct
 * customers were new this month" — a customer headcount, every month in
 * range, not a revenue-weighted quarter-over-quarter comparison.
 *
 * `itemId` narrows "new" to one product: a customer then counts in the
 * month of their first invoice containing *that product's* line item,
 * which can be an existing customer trying it for the first time, not only
 * a customer brand-new to the business.
 */
export async function getNewCustomersTrend(orgId: string, fromYear?: string, itemId?: string): Promise<NewCustomersTrendResult> {
  const hasInvoices = (await invoiceRepository.count(orgId, QUICKBOOKS)) > 0
  if (!hasInvoices) {
    return { hasInvoices: false, points: [] }
  }

  const endMonth = latestClosedMonth()
  const year = fromYear ?? endMonth.slice(0, 4)
  const months: string[] = []
  for (let month = `${year}-01`; month <= endMonth; month = shiftMonth(month, 1)) {
    months.push(month)
  }

  const { start } = monthRangeUtc(months[0])
  const { end } = monthRangeUtc(months[months.length - 1])
  const rows = await invoiceRepository.getNewCustomerCountsByMonth(orgId, QUICKBOOKS, start, end, itemId)

  const statsByMonth = new Map(months.map((month) => [month, { count: 0, amount: 0 }]))
  for (const row of rows) {
    if (statsByMonth.has(row.month)) statsByMonth.set(row.month, { count: row.count, amount: row.amount })
  }

  return {
    hasInvoices: true,
    points: months.map((month) => {
      const { count, amount } = statsByMonth.get(month)!
      return { month, newCustomerCount: count, newCustomerAmount: amount }
    })
  }
}
