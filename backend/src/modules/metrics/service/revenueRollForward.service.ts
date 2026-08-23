import { invoiceRepository } from '../../sync/repository/invoice.repository'

/**
 * Shared building block (metrics guide, "Shared building blocks" section):
 * GRR, NRR, new-logo growth, recurring-revenue %, LTV:CAC, and customer
 * concentration all read this one per-customer-per-month revenue
 * roll-forward. QuickBooks invoices carry no explicit "downgrade" or
 * "churn" event, so both are inferred here, once, from month-over-month
 * invoice totals per customer — every metric above reuses this instead of
 * re-deriving it.
 */

export interface RollForward {
  /** "YYYY-MM" of the period's first month (the "starting revenue" snapshot). */
  startMonth: string
  /** "YYYY-MM" of the period's last month (the "ending revenue" snapshot). */
  endMonth: string
  startingRevenue: number
  cancellations: number
  downgrades: number
  expansion: number
  /** True new logos only — $0 in `startMonth` AND no invoice anywhere before `startMonth`. Excludes win-backs (see `winBackRevenue`). */
  newLogoRevenue: number
  newLogoCustomerCount: number
  /** Revenue from a customer who was $0 in `startMonth` but has invoices further back — a returning customer, not a new one (metrics guide gap G-20). Not counted in `newLogoRevenue`/`newLogoCustomerCount`. */
  winBackRevenue: number
  winBackCustomerCount: number
  endingRevenue: number
  customerCount: number
}

/** Adds `delta` calendar months to a "YYYY-MM" string. */
export function shiftMonth(month: string, delta: number): string {
  const [year, mo] = month.split('-').map(Number)
  const d = new Date(Date.UTC(year, mo - 1 + delta, 1))
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

/** The most recent fully-closed calendar month relative to now — the sensible default period for a "calculated monthly" metric. */
export function latestClosedMonth(): string {
  const now = new Date()
  return shiftMonth(`${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`, -1)
}

/** The "YYYY-MM" of the first month of the quarter containing `month`. */
export function quarterStartOf(month: string): string {
  const [year, mo] = month.split('-').map(Number)
  const quarterFirstMonth = Math.floor((mo - 1) / 3) * 3 + 1
  return `${year}-${String(quarterFirstMonth).padStart(2, '0')}`
}

/**
 * The quarter containing `month` — unless that quarter's own last month
 * hasn't closed yet (still in the future relative to `latestClosedMonth()`),
 * in which case falls back one quarter. Every quarter-grain comparison in
 * this app (VC-01/02's "current quarter" flag inputs, VC-03's own value)
 * needs this: without it, asking about an in-progress quarter compares
 * against a month with no invoices yet purely because it hasn't happened —
 * not a sync gap — which reads as a false "100% collapse" instead of an
 * honest "not this quarter's real number yet." "YYYY-MM" strings compare
 * lexicographically the same as chronologically, so plain string `<=` works.
 */
export function latestClosedQuarterStart(month: string): string {
  const quarterStart = quarterStartOf(month)
  const quarterEnd = shiftMonth(quarterStart, 2)
  return quarterEnd <= latestClosedMonth() ? quarterStart : shiftMonth(quarterStart, -3)
}

function monthRangeUtc(month: string): { start: Date; end: Date } {
  const [year, mo] = month.split('-').map(Number)
  return { start: new Date(Date.UTC(year, mo - 1, 1)), end: new Date(Date.UTC(year, mo, 0, 23, 59, 59, 999)) }
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

/** "YYYY-MM-DD" start/end dates for one calendar month — the shape QuickBooks' report API takes. */
export function monthToDateRange(month: string): { startDate: string; endDate: string } {
  const { start, end } = monthRangeUtc(month)
  return { startDate: isoDate(start), endDate: isoDate(end) }
}

/** "YYYY-MM-DD" start/end dates for the quarter containing `monthInQuarter`. */
export function quarterToDateRange(monthInQuarter: string): { startDate: string; endDate: string } {
  const quarterStart = quarterStartOf(monthInQuarter)
  const { startDate } = monthToDateRange(quarterStart)
  const { endDate } = monthToDateRange(shiftMonth(quarterStart, 2))
  return { startDate, endDate }
}

/**
 * Builds the roll-forward between two calendar months (treated as a
 * before/after snapshot — `startMonth`'s per-customer revenue vs
 * `endMonth`'s). For a single-month period, pass `startMonth` as the month
 * before the one being measured and `endMonth` as the month itself. For a
 * quarterly check, pass the month before the quarter and the quarter's last
 * month — this is what "retention this quarter vs. last quarter" compares.
 */
export async function computeRollForward(
  orgId: string,
  provider: string,
  startMonth: string,
  endMonth: string
): Promise<RollForward> {
  const { start } = monthRangeUtc(startMonth)
  const { end } = monthRangeUtc(endMonth)

  const [rows, customersWithPriorInvoice] = await Promise.all([
    invoiceRepository.getMonthlyRevenueByCustomer(orgId, provider, start, end),
    // Anyone with an invoice before `start` is at most a win-back within this
    // window, never a true new logo — checked against the customer's whole
    // history, not just the two months being compared (gap G-20).
    invoiceRepository.findCustomerIdsWithInvoiceBefore(orgId, provider, start)
  ])

  const startRevenueByCustomer = new Map<string, number>()
  const endRevenueByCustomer = new Map<string, number>()
  for (const row of rows) {
    if (row.month === startMonth) startRevenueByCustomer.set(row.customerRecordId, row.revenue)
    else if (row.month === endMonth) endRevenueByCustomer.set(row.customerRecordId, row.revenue)
  }

  let startingRevenue = 0
  let cancellations = 0
  let downgrades = 0
  let expansion = 0
  let newLogoRevenue = 0
  let newLogoCustomerCount = 0
  let winBackRevenue = 0
  let winBackCustomerCount = 0
  let endingRevenue = 0

  const customerIds = new Set([...startRevenueByCustomer.keys(), ...endRevenueByCustomer.keys()])

  for (const customerId of customerIds) {
    const startRev = startRevenueByCustomer.get(customerId) ?? 0
    const endRev = endRevenueByCustomer.get(customerId) ?? 0
    endingRevenue += endRev

    if (startRev > 0) {
      // Only customers already active at the start of the period count toward
      // "starting revenue" — a new-logo customer had nothing to retain (VC-01
      // "Worth knowing").
      startingRevenue += startRev
      if (endRev === 0) cancellations += startRev
      else if (endRev < startRev) downgrades += startRev - endRev
      else if (endRev > startRev) expansion += endRev - startRev
    } else if (endRev > 0) {
      if (customersWithPriorInvoice.has(customerId)) {
        winBackRevenue += endRev
        winBackCustomerCount += 1
      } else {
        newLogoRevenue += endRev
        newLogoCustomerCount += 1
      }
    }
  }

  return {
    startMonth,
    endMonth,
    startingRevenue,
    cancellations,
    downgrades,
    expansion,
    newLogoRevenue,
    newLogoCustomerCount,
    winBackRevenue,
    winBackCustomerCount,
    endingRevenue,
    customerCount: customerIds.size
  }
}

/** The roll-forward for a single calendar month, vs. the month immediately before it. */
export function computeMonthlyRollForward(orgId: string, provider: string, month: string): Promise<RollForward> {
  return computeRollForward(orgId, provider, shiftMonth(month, -1), month)
}

/** The roll-forward for the quarter containing `monthInQuarter`, vs. the month before that quarter — what the quarterly flag check compares. */
export function computeQuarterRollForward(orgId: string, provider: string, monthInQuarter: string): Promise<RollForward> {
  const quarterStart = quarterStartOf(monthInQuarter)
  const quarterEnd = shiftMonth(quarterStart, 2)
  return computeRollForward(orgId, provider, shiftMonth(quarterStart, -1), quarterEnd)
}

/** GRR %, or `null` if there was no starting revenue to retain (honest-numbers rule — never silently 0). */
export function grrFromRollForward(rf: RollForward): number | null {
  if (rf.startingRevenue <= 0) return null
  return ((rf.startingRevenue - rf.cancellations - rf.downgrades) / rf.startingRevenue) * 100
}

/** NRR %, or `null` if there was no starting revenue to retain. */
export function nrrFromRollForward(rf: RollForward): number | null {
  if (rf.startingRevenue <= 0) return null
  return ((rf.startingRevenue - rf.cancellations - rf.downgrades + rf.expansion) / rf.startingRevenue) * 100
}
