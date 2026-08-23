import { MetricFlag, MetricResult } from '../metrics.types'
import {
  computeMonthlyRollForward,
  computeQuarterRollForward,
  grrFromRollForward,
  nrrFromRollForward,
  latestClosedMonth,
  latestClosedQuarterStart,
  shiftMonth
} from './revenueRollForward.service'

// Defaults per the metrics guide — "Every threshold in this document is a
// default. Firms can set their own." A per-org override store is a fast
// follow, not required for the MVP's first two metrics.
const GRR_WATCH_BENCHMARK = 90
const NRR_ACT_NOW_THRESHOLD = 90

const round1 = (n: number): number => Math.round(n * 10) / 10

/** QuickBooks is the only provider this metric reads from today — its Invoice sync backs the shared revenue roll-forward. */
const QUICKBOOKS_PROVIDER = 'quickbooks'

/**
 * VC-01 — Gross Revenue Retention Rate. Calculated monthly; the alert check
 * (which needs a quarter-over-quarter comparison) runs on the quarter
 * containing the requested month.
 */
export async function computeVC01(orgId: string, period?: string): Promise<MetricResult> {
  const month = period ?? latestClosedMonth()
  const monthly = await computeMonthlyRollForward(orgId, QUICKBOOKS_PROVIDER, month)
  const monthlyGrr = grrFromRollForward(monthly)

  const quarterStart = latestClosedQuarterStart(month)
  const [currentQuarter, previousQuarter] = await Promise.all([
    computeQuarterRollForward(orgId, QUICKBOOKS_PROVIDER, quarterStart),
    computeQuarterRollForward(orgId, QUICKBOOKS_PROVIDER, shiftMonth(quarterStart, -1))
  ])
  const currentQuarterGrr = grrFromRollForward(currentQuarter)
  const previousQuarterGrr = grrFromRollForward(previousQuarter)

  // Gated on monthlyGrr !== null too (same condition as `computable` below) -- currentQuarterGrr
  // comes from a separate quarterly roll-forward, so it could resolve even when the monthly
  // one that `computable`/`value` depend on can't, which would otherwise let a flag survive
  // onto a response the card renders as "Not computable."
  let flag: MetricFlag | null = null
  if (monthlyGrr !== null && currentQuarterGrr !== null) {
    const belowBenchmark = currentQuarterGrr < GRR_WATCH_BENCHMARK
    const downVsLastQuarter = previousQuarterGrr !== null && currentQuarterGrr < previousQuarterGrr
    if (belowBenchmark && downVsLastQuarter) {
      flag = {
        level: 'act_now',
        reason: `Retention fell to ${currentQuarterGrr.toFixed(1)}% this quarter (from ${previousQuarterGrr!.toFixed(1)}%) and is below the ${GRR_WATCH_BENCHMARK}% benchmark.`
      }
    } else if (belowBenchmark) {
      flag = { level: 'watch', reason: `Retention is ${currentQuarterGrr.toFixed(1)}%, below the ${GRR_WATCH_BENCHMARK}% benchmark.` }
    } else if (downVsLastQuarter) {
      flag = {
        level: 'watch',
        reason: `Retention fell to ${currentQuarterGrr.toFixed(1)}% this quarter, down from ${previousQuarterGrr!.toFixed(1)}% last quarter.`
      }
    }
  }

  return {
    id: 'VC-01',
    period: month,
    computable: monthlyGrr !== null,
    value: monthlyGrr !== null ? round1(monthlyGrr) : null,
    unit: 'percent',
    data: {
      startingRevenue: monthly.startingRevenue,
      cancellations: monthly.cancellations,
      downgrades: monthly.downgrades,
      endingRevenue: monthly.endingRevenue,
      customerCount: monthly.customerCount,
      currentQuarterGrr: currentQuarterGrr !== null ? round1(currentQuarterGrr) : null,
      previousQuarterGrr: previousQuarterGrr !== null ? round1(previousQuarterGrr) : null
    },
    flag,
    asOf: new Date().toISOString()
  }
}

/**
 * VC-02 — Net Revenue Retention Rate. Calculated and checked every month,
 * but the "two quarters running" act-now condition still needs the
 * surrounding quarter's figures.
 */
export async function computeVC02(orgId: string, period?: string): Promise<MetricResult> {
  const month = period ?? latestClosedMonth()
  const monthly = await computeMonthlyRollForward(orgId, QUICKBOOKS_PROVIDER, month)
  const monthlyNrr = nrrFromRollForward(monthly)

  const quarterStart = latestClosedQuarterStart(month)
  const [currentQuarter, previousQuarter] = await Promise.all([
    computeQuarterRollForward(orgId, QUICKBOOKS_PROVIDER, quarterStart),
    computeQuarterRollForward(orgId, QUICKBOOKS_PROVIDER, shiftMonth(quarterStart, -1))
  ])
  const currentQuarterNrr = nrrFromRollForward(currentQuarter)
  const previousQuarterNrr = nrrFromRollForward(previousQuarter)

  let flag: MetricFlag | null = null
  if (monthlyNrr !== null) {
    const singleQuarterBelow90 = currentQuarterNrr !== null && currentQuarterNrr < NRR_ACT_NOW_THRESHOLD
    const twoQuartersBelow100 =
      currentQuarterNrr !== null && currentQuarterNrr < 100 && previousQuarterNrr !== null && previousQuarterNrr < 100

    if (singleQuarterBelow90) {
      flag = { level: 'act_now', reason: `NRR is ${currentQuarterNrr!.toFixed(1)}% this quarter, below the ${NRR_ACT_NOW_THRESHOLD}% threshold.` }
    } else if (twoQuartersBelow100) {
      flag = {
        level: 'act_now',
        reason: `NRR has stayed below 100% for two quarters running (${previousQuarterNrr!.toFixed(1)}%, then ${currentQuarterNrr!.toFixed(1)}%).`
      }
    } else if (monthlyNrr < 100) {
      flag = { level: 'watch', reason: `NRR is ${monthlyNrr.toFixed(1)}% in the latest period, below 100%.` }
    }
  }

  return {
    id: 'VC-02',
    period: month,
    computable: monthlyNrr !== null,
    value: monthlyNrr !== null ? round1(monthlyNrr) : null,
    unit: 'percent',
    data: {
      startingRevenue: monthly.startingRevenue,
      cancellations: monthly.cancellations,
      downgrades: monthly.downgrades,
      expansion: monthly.expansion,
      endingRevenue: monthly.endingRevenue,
      customerCount: monthly.customerCount,
      currentQuarterNrr: currentQuarterNrr !== null ? round1(currentQuarterNrr) : null,
      previousQuarterNrr: previousQuarterNrr !== null ? round1(previousQuarterNrr) : null
    },
    flag,
    asOf: new Date().toISOString()
  }
}

/**
 * VC-03 — New-Logo Revenue Growth Rate. Built entirely from the same
 * QuickBooks invoice roll-forward VC-01/02 use — `newLogoRevenue` is already
 * computed there (revenue from customers with $0 at the start of the period,
 * >0 by the end). The PDF's other data source, Salesforce
 * `Opportunity.Type='New Business'`, is a corroborating cross-check ("confirm
 * the customer really is new"), not required for the number itself — skipped
 * for now (same scoping choice as VC-01's G-2 Salesforce enrichment).
 */
export async function computeVC03(orgId: string, period?: string): Promise<MetricResult> {
  const month = period ?? latestClosedMonth()
  const quarterStart = latestClosedQuarterStart(month)

  const [currentQuarter, previousQuarter, twoAgoQuarter] = await Promise.all([
    computeQuarterRollForward(orgId, QUICKBOOKS_PROVIDER, quarterStart),
    computeQuarterRollForward(orgId, QUICKBOOKS_PROVIDER, shiftMonth(quarterStart, -3)),
    computeQuarterRollForward(orgId, QUICKBOOKS_PROVIDER, shiftMonth(quarterStart, -6))
  ])

  const growthPct = (curr: number, prior: number): number | null => (prior > 0 ? ((curr - prior) / prior) * 100 : null)

  const quarterGrowth = growthPct(currentQuarter.newLogoRevenue, previousQuarter.newLogoRevenue)
  const previousQuarterGrowth = growthPct(previousQuarter.newLogoRevenue, twoAgoQuarter.newLogoRevenue)

  // The Watch/Act-now legs that compare against "plan" need operating-plan
  // data this MVP doesn't have (gap G-14). The one plan-independent leg —
  // "the growth rate itself declines two quarters in a row" — fires here as:
  // this quarter's growth rate is lower than last quarter's, which was
  // itself lower than the quarter before it.
  let flag: MetricFlag | null = null
  if (quarterGrowth !== null && previousQuarterGrowth !== null && quarterGrowth < previousQuarterGrowth) {
    flag = {
      level: 'act_now',
      reason: `New-logo revenue growth has declined two quarters running: ${previousQuarterGrowth.toFixed(1)}% → ${quarterGrowth.toFixed(1)}%.`
    }
  }

  return {
    id: 'VC-03',
    period: quarterStart,
    computable: quarterGrowth !== null,
    value: quarterGrowth !== null ? round1(quarterGrowth) : null,
    unit: 'percent',
    data: {
      newLogoRevenue: round1(currentQuarter.newLogoRevenue),
      previousQuarterNewLogoRevenue: round1(previousQuarter.newLogoRevenue),
      newLogoCustomerCount: currentQuarter.newLogoCustomerCount,
      // Surfaced for transparency (gap G-20's fix) — revenue from returning customers,
      // excluded from newLogoRevenue above so a win-back never inflates "new" growth.
      winBackRevenue: round1(currentQuarter.winBackRevenue),
      winBackCustomerCount: currentQuarter.winBackCustomerCount,
      previousQuarterGrowthPct: previousQuarterGrowth !== null ? round1(previousQuarterGrowth) : null,
      benchmarkAvailable: false
    },
    flag,
    asOf: new Date().toISOString()
  }
}
