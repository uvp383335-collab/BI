import { invoiceRepository } from '../../sync/repository/invoice.repository'
import { ProductBillingFrequency } from '../../sync/model/Product.model'
import {
  RollForward,
  RevenueRollForwardTotals,
  classifyRevenueRollForward,
  sumRevenueRollForwardTotals,
  monthRangeUtc,
  shiftMonth,
  quarterStartOf
} from './revenueRollForward.service'

/**
 * VC-01/VC-02's recurring-revenue-only GRR/NRR roll-forward — unlike
 * `computeRollForward` (all revenue, used by VC-01/02's underlying numbers
 * before this feature, and still by VC-03/unit-economics), this one only
 * ever looks at invoice lines billed against a product categorized
 * `recurring` (Settings page), and compares each product's revenue over
 * *its own* billing cycle: a monthly product month-over-month, a quarterly
 * product quarter-over-quarter, a yearly product year-over-year (so a
 * customer's $10k 2024 invoice vs. a $9k 2025 invoice for the same yearly
 * product reads as a downgrade, not noise). The three cohorts are summed
 * into one blended GRR/NRR input via `sumRevenueRollForwardTotals` — see
 * its doc comment for the one known approximation (customer counts aren't
 * deduplicated across cohorts; dollar figures are exact).
 *
 * `non_recurring` and `not_sure`/uncategorized products never enter this
 * roll-forward at all — VC-01/VC-02 are retention metrics for recurring
 * revenue specifically, not a measure of total revenue retention.
 */

/** Rolls up a recurring product's month-grain revenue rows into period buckets matching its own billing cadence, then classifies the prior-vs-current-period delta. */
async function cohortRollForward(
  orgId: string,
  provider: string,
  billingFrequency: ProductBillingFrequency,
  from: Date,
  to: Date,
  priorPeriodKey: string,
  currentPeriodKey: string,
  periodKeyOf: (month: string) => string
): Promise<RevenueRollForwardTotals> {
  const rows = await invoiceRepository.getRecurringRevenueByCustomerAndMonth(orgId, provider, from, to, billingFrequency)

  const startRevenueByCustomer = new Map<string, number>()
  const endRevenueByCustomer = new Map<string, number>()
  for (const row of rows) {
    const periodKey = periodKeyOf(row.month)
    const target = periodKey === priorPeriodKey ? startRevenueByCustomer : periodKey === currentPeriodKey ? endRevenueByCustomer : null
    if (!target) continue
    target.set(row.customerRecordId, (target.get(row.customerRecordId) ?? 0) + row.revenue)
  }

  // Win-back/new-logo still reads the customer's whole invoice history (any product) — "is this a
  // brand-new customer to the business" doesn't need to be scoped to recurring products specifically.
  const customersWithPriorInvoice = await invoiceRepository.findCustomerIdsWithInvoiceBefore(orgId, provider, from)
  return classifyRevenueRollForward(startRevenueByCustomer, endRevenueByCustomer, customersWithPriorInvoice)
}

/** Monthly-billed products, comparing the calendar month before `month` to `month` itself. */
function monthlyCohort(orgId: string, provider: string, month: string): Promise<RevenueRollForwardTotals> {
  const priorMonth = shiftMonth(month, -1)
  const { start } = monthRangeUtc(priorMonth)
  const { end } = monthRangeUtc(month)
  return cohortRollForward(orgId, provider, 'monthly', start, end, priorMonth, month, (m) => m)
}

/**
 * Monthly-billed products, for VC-01/02's "this quarter" figure — a
 * before/after snapshot mirroring `computeQuarterRollForward`'s own
 * semantics (the month right before the quarter vs. the quarter's last
 * month), not a 3-month sum: monthly revenue is a run-rate, so summing three
 * months would triple-count a steady customer and read as "expansion" where
 * there was none.
 */
function monthlyQuarterSnapshotCohort(orgId: string, provider: string, quarterStart: string): Promise<RevenueRollForwardTotals> {
  const priorMonth = shiftMonth(quarterStart, -1)
  const quarterEnd = shiftMonth(quarterStart, 2)
  const { start } = monthRangeUtc(priorMonth)
  const { end } = monthRangeUtc(quarterEnd)
  return cohortRollForward(orgId, provider, 'monthly', start, end, priorMonth, quarterEnd, (m) => m)
}

/** Quarterly-billed products, comparing the quarter containing `monthInQuarter` to the quarter before it. */
function quarterlyCohort(orgId: string, provider: string, monthInQuarter: string): Promise<RevenueRollForwardTotals> {
  const quarterStart = quarterStartOf(monthInQuarter)
  const priorQuarterStart = shiftMonth(quarterStart, -3)
  const { start } = monthRangeUtc(priorQuarterStart)
  const { end } = monthRangeUtc(shiftMonth(quarterStart, 2))
  return cohortRollForward(orgId, provider, 'quarterly', start, end, priorQuarterStart, quarterStart, quarterStartOf)
}

function yearOf(month: string): string {
  return month.slice(0, 4)
}

/** Yearly-billed products, comparing the calendar year containing `month` to the year before it (the ABC-customer-$10k-then-$9k case). */
function yearlyCohort(orgId: string, provider: string, month: string): Promise<RevenueRollForwardTotals> {
  const year = yearOf(month)
  const priorYear = String(Number(year) - 1)
  const start = new Date(Date.UTC(Number(priorYear), 0, 1))
  const end = new Date(Date.UTC(Number(year), 11, 31, 23, 59, 59, 999))
  return cohortRollForward(orgId, provider, 'yearly', start, end, priorYear, year, yearOf)
}

/** VC-01/VC-02's monthly figure: blends monthly billers (month-over-month), quarterly billers (quarter-over-quarter, same quarter `month` falls in), and yearly billers (year-over-year, same year `month` falls in). */
export async function computeRecurringMonthlyRollForward(orgId: string, provider: string, month: string): Promise<RollForward> {
  const [monthly, quarterly, yearly] = await Promise.all([
    monthlyCohort(orgId, provider, month),
    quarterlyCohort(orgId, provider, month),
    yearlyCohort(orgId, provider, month)
  ])
  return { startMonth: shiftMonth(month, -1), endMonth: month, ...sumRevenueRollForwardTotals([monthly, quarterly, yearly]) }
}

/** VC-01/VC-02's quarterly figure: monthly billers rolled up to quarter totals (quarter-over-quarter), plus the same quarterly/yearly cohorts as the monthly figure. */
export async function computeRecurringQuarterRollForward(orgId: string, provider: string, monthInQuarter: string): Promise<RollForward> {
  const quarterStart = quarterStartOf(monthInQuarter)
  const quarterEnd = shiftMonth(quarterStart, 2)
  const [monthly, quarterly, yearly] = await Promise.all([
    monthlyQuarterSnapshotCohort(orgId, provider, quarterStart),
    quarterlyCohort(orgId, provider, monthInQuarter),
    yearlyCohort(orgId, provider, monthInQuarter)
  ])
  return { startMonth: shiftMonth(quarterStart, -1), endMonth: quarterEnd, ...sumRevenueRollForwardTotals([monthly, quarterly, yearly]) }
}
