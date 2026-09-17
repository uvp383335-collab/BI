import { MetricFlag, MetricResult } from '../metrics.types'
import { getStoredProfitAndLoss, getStoredItemProfitAndLoss } from './plReport.service'
import { ParsedProfitAndLoss, sumColumn, sumDepreciationAndAmortization, sumExpensesByCategory, sumRecurringIncome } from './plParser'
import { computeQuarterRollForward, latestClosedMonth, latestClosedQuarterStart, shiftMonth } from './revenueRollForward.service'

/**
 * VC-04, VC-06, VC-07, VC-09, VC-10, VC-12, VC-13, VC-14 — the P&L-driven
 * metrics (Phase 2). Deliberate scoping choices, all documented in
 * docs/sherpai-metrics-progress.md:
 *
 * - Every metric here operates at QUARTER grain (both the headline value and
 *   the flag), not monthly-value + quarterly-flag like VC-01/02. The PDF's
 *   own cadence for these is "monthly once books close; checked quarterly" —
 *   collapsing to one quarterly figure matches how these numbers actually
 *   get used (PE portfolio reporting is quarterly). `?period=YYYY-MM` still
 *   accepts any month; it's resolved to the quarter containing it.
 * - Data comes from `PLSnapshot` (populated by the sync job), never a live
 *   QuickBooks call at request time — see plReport.service.ts /
 *   getStoredProfitAndLoss and gap G-15 in the progress doc. A quarter that
 *   hasn't been synced yet returns `null`; the CURRENT/requested quarter
 *   missing makes the whole metric "not computable" (honest-numbers rule —
 *   never silently treated as a zero P&L). A *comparison* quarter (prior
 *   quarter, year-ago quarter) missing just drops that one comparison leg
 *   instead of failing the whole metric.
 * - No peer-benchmark or operating-plan data exists in this MVP (both are
 *   out of connector scope per the PDF itself). Flag legs that require a
 *   peer/plan comparison are simply never triggered — `data.benchmarkAvailable
 *   : false` marks this rather than silently comparing against nothing.
 */

const round1 = (n: number): number => Math.round(n * 10) / 10
const round2 = (n: number): number => Math.round(n * 100) / 100
const QUICKBOOKS = 'quickbooks'

/** A quarter with no synced snapshot behaves like an empty P&L for comparison purposes — every ratio guarded by `>0` naturally falls back to null instead of computing against a fake zero. */
const EMPTY_PL: ParsedProfitAndLoss = { columns: ['Total'], income: [], cogs: [], expenses: [], otherExpenses: [], sectionTotals: {} }

/** `itemId` reads the per-product snapshot (VC-04/09/10/13's product filter) instead of the whole-company one. */
async function getQuarterPL(orgId: string, quarterStart: string, itemId?: string): Promise<ParsedProfitAndLoss | null> {
  if (itemId) return getStoredItemProfitAndLoss(orgId, QUICKBOOKS, quarterStart, itemId)
  return getStoredProfitAndLoss(orgId, QUICKBOOKS, quarterStart)
}

function notComputable(id: string, period: string, unit: MetricResult['unit']): MetricResult {
  return { id, period, computable: false, value: null, unit, data: { snapshotAvailable: false }, flag: null, asOf: new Date().toISOString() }
}

// ---------------------------------------------------------------------------
// VC-04 — Cost of Goods Sold % and Mix
// ---------------------------------------------------------------------------

export async function computeVC04(orgId: string, period?: string, itemId?: string): Promise<MetricResult> {
  const month = period ?? latestClosedMonth()
  const quarterStart = latestClosedQuarterStart(month)
  const prevQuarterStart = shiftMonth(quarterStart, -3)

  const [currentOrNull, previousOrNull] = await Promise.all([getQuarterPL(orgId, quarterStart, itemId), getQuarterPL(orgId, prevQuarterStart, itemId)])
  if (!currentOrNull) return notComputable('VC-04', quarterStart, 'percent')
  const current = currentOrNull
  const previous = previousOrNull ?? EMPTY_PL

  const revenue = sumColumn(current.income, 'Total')
  const cogsTotal = sumColumn(current.cogs, 'Total')
  const cogsPct = revenue > 0 ? (cogsTotal / revenue) * 100 : null

  const prevRevenue = sumColumn(previous.income, 'Total')
  const prevCogsTotal = sumColumn(previous.cogs, 'Total')
  const prevCogsPct = prevRevenue > 0 ? (prevCogsTotal / prevRevenue) * 100 : null

  const classColumns = Array.from(new Set([...current.columns, ...previous.columns])).filter((c) => c !== 'Total')
  const mix = classColumns.map((cls) => {
    const classRevenue = sumColumn(current.income, cls)
    const classCogs = sumColumn(current.cogs, cls)
    return {
      class: cls,
      revenue: round1(classRevenue),
      mixPct: revenue > 0 ? round1((classRevenue / revenue) * 100) : null,
      cogsPct: classRevenue > 0 ? round1((classCogs / classRevenue) * 100) : null
    }
  })

  // Two-factor variance decomposition: rate effect = prior-mix-weighted
  // change in each product's own cost rate; mix effect = prior-rate-weighted
  // change in each product's revenue share. This is what lets the flag say
  // "driven by cost inflation" vs. "driven by mix" instead of just "COGS % moved".
  let rateEffect: number | null = null
  let mixEffect: number | null = null
  if (revenue > 0 && prevRevenue > 0) {
    rateEffect = 0
    mixEffect = 0
    for (const cls of classColumns) {
      const curRev = sumColumn(current.income, cls)
      const curCogs = sumColumn(current.cogs, cls)
      const prevRev = sumColumn(previous.income, cls)
      const prevCogs = sumColumn(previous.cogs, cls)
      const mixCurr = curRev / revenue
      const mixPrev = prevRev / prevRevenue
      const rateCurr = curRev > 0 ? curCogs / curRev : 0
      const ratePrev = prevRev > 0 ? prevCogs / prevRev : 0
      rateEffect += mixPrev * (rateCurr - ratePrev) * 100
      mixEffect += ratePrev * (mixCurr - mixPrev) * 100
    }
  }

  let flag: MetricFlag | null = null
  if (cogsPct !== null && prevCogsPct !== null && cogsPct > prevCogsPct) {
    const rateDriven = rateEffect !== null && rateEffect > 1
    flag = rateDriven
      ? {
          level: 'act_now',
          reason: `COGS % rose to ${cogsPct.toFixed(1)}% this quarter (from ${prevCogsPct.toFixed(1)}%), driven mainly by cost inflation (${rateEffect!.toFixed(1)} pt rate effect, not mix).`
        }
      : { level: 'watch', reason: `COGS % rose to ${cogsPct.toFixed(1)}% this quarter, up from ${prevCogsPct.toFixed(1)}%.` }
  }

  return {
    id: 'VC-04',
    period: quarterStart,
    computable: cogsPct !== null,
    value: cogsPct !== null ? round1(cogsPct) : null,
    unit: 'percent',
    data: {
      revenue: round1(revenue),
      cogsTotal: round1(cogsTotal),
      previousQuarterCogsPct: prevCogsPct !== null ? round1(prevCogsPct) : null,
      rateEffect: rateEffect !== null ? round1(rateEffect) : null,
      mixEffect: mixEffect !== null ? round1(mixEffect) : null,
      mix,
      benchmarkAvailable: false
    },
    flag,
    asOf: new Date().toISOString()
  }
}

// ---------------------------------------------------------------------------
// VC-09 — G&A as % of Revenue
// ---------------------------------------------------------------------------

export async function computeVC09(orgId: string, period?: string, itemId?: string): Promise<MetricResult> {
  const month = period ?? latestClosedMonth()
  const quarterStart = latestClosedQuarterStart(month)
  const pl = await getQuarterPL(orgId, quarterStart, itemId)
  if (!pl) return notComputable('VC-09', quarterStart, 'percent')

  const revenue = sumColumn(pl.income, 'Total')
  const gaExpense = sumExpensesByCategory(pl, 'g_and_a', 'Total')
  const gaPct = revenue > 0 ? (gaExpense / revenue) * 100 : null

  return {
    id: 'VC-09',
    period: quarterStart,
    computable: gaPct !== null,
    value: gaPct !== null ? round1(gaPct) : null,
    unit: 'percent',
    data: { revenue: round1(revenue), gaExpense: round1(gaExpense), benchmarkAvailable: false },
    // Both of VC-09's flag conditions (peer benchmark, >1pt over plan) need data this MVP
    // doesn't have yet — see docs/sherpai-metrics-progress.md gap G-14. Never fires until then.
    flag: null,
    asOf: new Date().toISOString()
  }
}

// ---------------------------------------------------------------------------
// VC-10 — EBITDA Margin Trend
// ---------------------------------------------------------------------------

/** Exported for reuse by cbMetrics.service.ts (CB-07's Free Cash Flow Conversion needs the same EBITDA figure). */
export function ebitdaFromPL(pl: ParsedProfitAndLoss): { revenue: number; ebitda: number } {
  const revenue = sumColumn(pl.income, 'Total')
  // Fallback (only used when QuickBooks' own report omits a NetOperatingIncome section) must
  // subtract every section `da` below scans -- cogs, expenses, AND otherExpenses -- or D&A sitting
  // in otherExpenses never actually got subtracted here, and adding it back next would double-count it.
  const operatingIncome =
    pl.sectionTotals.NetOperatingIncome?.Total ??
    revenue - sumColumn(pl.cogs, 'Total') - sumColumn(pl.expenses, 'Total') - sumColumn(pl.otherExpenses, 'Total')
  const da = sumDepreciationAndAmortization(pl, 'Total')
  return { revenue, ebitda: operatingIncome + da }
}

/** Exported for reuse by cmMetrics.service.ts (CM-07's Profit ROI needs the same gross-margin figure VC-04/06 use). Decimal fraction (0.70 = 70%), null if there's no revenue to divide by. */
export function grossMarginFromPL(pl: ParsedProfitAndLoss): number | null {
  const revenue = sumColumn(pl.income, 'Total')
  const cogs = sumColumn(pl.cogs, 'Total')
  return revenue > 0 ? (revenue - cogs) / revenue : null
}

export async function computeVC10(orgId: string, period?: string, itemId?: string): Promise<MetricResult> {
  const month = period ?? latestClosedMonth()
  const quarterStart = latestClosedQuarterStart(month)
  const prevQuarterStart = shiftMonth(quarterStart, -3)
  const prev2QuarterStart = shiftMonth(quarterStart, -6)

  const [plOrNull, prevPlOrNull, prev2PlOrNull] = await Promise.all([
    getQuarterPL(orgId, quarterStart, itemId),
    getQuarterPL(orgId, prevQuarterStart, itemId),
    getQuarterPL(orgId, prev2QuarterStart, itemId)
  ])
  if (!plOrNull) return notComputable('VC-10', quarterStart, 'percent')

  const { revenue, ebitda } = ebitdaFromPL(plOrNull)
  const { revenue: prevRevenue, ebitda: prevEbitda } = ebitdaFromPL(prevPlOrNull ?? EMPTY_PL)
  const { revenue: prev2Revenue, ebitda: prev2Ebitda } = ebitdaFromPL(prev2PlOrNull ?? EMPTY_PL)

  const marginPct = revenue > 0 ? (ebitda / revenue) * 100 : null
  const prevMarginPct = prevRevenue > 0 ? (prevEbitda / prevRevenue) * 100 : null
  const prev2MarginPct = prev2Revenue > 0 ? (prev2Ebitda / prev2Revenue) * 100 : null

  let flag: MetricFlag | null = null
  if (marginPct !== null && prevMarginPct !== null && prev2MarginPct !== null) {
    const shrinkingTwoQuartersRunning = marginPct < prevMarginPct && prevMarginPct < prev2MarginPct
    if (shrinkingTwoQuartersRunning) {
      flag = {
        level: 'watch',
        reason: `EBITDA margin has shrunk two quarters running: ${prev2MarginPct.toFixed(1)}% → ${prevMarginPct.toFixed(1)}% → ${marginPct.toFixed(1)}%.`
      }
    }
  }
  // The plan-relative watch/act-now legs (>1pt / >3pts below plan, >5pts below peer median)
  // need data this MVP doesn't have — see gap G-14. Only the pure trend leg above can fire.

  return {
    id: 'VC-10',
    period: quarterStart,
    computable: marginPct !== null,
    value: marginPct !== null ? round1(marginPct) : null,
    unit: 'percent',
    data: {
      revenue: round1(revenue),
      ebitda: round1(ebitda),
      previousQuarterMarginPct: prevMarginPct !== null ? round1(prevMarginPct) : null,
      benchmarkAvailable: false
    },
    flag,
    asOf: new Date().toISOString()
  }
}

// ---------------------------------------------------------------------------
// Shared unit-economics core for VC-06 / VC-07 / VC-14 — CAC, payback, LTV
// all derive from the same quarter's P&L + revenue roll-forward, so compute
// it once and let each metric format its own slice + flag. Every field is
// nullable and stays null end-to-end when this quarter's P&L snapshot is
// missing — never silently substituted with a zero ("no S&M spend recorded"
// must never be confused with "genuinely spent nothing").
// ---------------------------------------------------------------------------

interface UnitEconomicsCore {
  quarterStart: string
  hasData: boolean
  revenue: number | null
  cogsTotal: number | null
  /** Decimal fraction (0.70 = 70%), not a percentage. */
  grossMarginPct: number | null
  smSpend: number | null
  newLogoCount: number
  newLogoRevenue: number
  avgNewCustomerMonthlyRevenue: number | null
  cac: number | null
  paybackMonths: number | null
  /** Monthly revenue-churn rate, derived from this quarter's cancellations ÷ starting revenue (VC-01's roll-forward), spread evenly across the quarter's 3 months. */
  monthlyChurnRate: number | null
  ltvNew: number | null
  ltvNewRatio: number | null
}

const MODELED_LIFE_CAP_MONTHS = 84 // 7 years, per VC-07's "Worth knowing"

async function computeUnitEconomicsCore(orgId: string, monthInQuarter: string): Promise<UnitEconomicsCore> {
  const quarterStart = latestClosedQuarterStart(monthInQuarter)

  const [pl, rollForward] = await Promise.all([
    getQuarterPL(orgId, quarterStart),
    computeQuarterRollForward(orgId, QUICKBOOKS, quarterStart)
  ])

  const newLogoCount = rollForward.newLogoCustomerCount
  const avgNewCustomerMonthlyRevenue = newLogoCount > 0 ? rollForward.newLogoRevenue / newLogoCount : null
  const monthlyChurnRate = rollForward.startingRevenue > 0 ? rollForward.cancellations / rollForward.startingRevenue / 3 : null

  if (!pl) {
    return {
      quarterStart,
      hasData: false,
      revenue: null,
      cogsTotal: null,
      grossMarginPct: null,
      smSpend: null,
      newLogoCount,
      newLogoRevenue: rollForward.newLogoRevenue,
      avgNewCustomerMonthlyRevenue,
      cac: null,
      paybackMonths: null,
      monthlyChurnRate,
      ltvNew: null,
      ltvNewRatio: null
    }
  }

  const revenue = sumColumn(pl.income, 'Total')
  const cogsTotal = sumColumn(pl.cogs, 'Total')
  const grossMarginPct = revenue > 0 ? (revenue - cogsTotal) / revenue : null
  const smSpend = sumExpensesByCategory(pl, 'sales_marketing', 'Total')

  const cac = newLogoCount > 0 ? smSpend / newLogoCount : null
  const monthlyGrossProfitPerNewCustomer =
    avgNewCustomerMonthlyRevenue !== null && grossMarginPct !== null ? avgNewCustomerMonthlyRevenue * grossMarginPct : null
  const paybackMonths =
    cac !== null && monthlyGrossProfitPerNewCustomer !== null && monthlyGrossProfitPerNewCustomer > 0
      ? cac / monthlyGrossProfitPerNewCustomer
      : null

  let ltvNew: number | null = null
  if (avgNewCustomerMonthlyRevenue !== null && grossMarginPct !== null && monthlyChurnRate !== null && monthlyChurnRate > 0) {
    const modeledMonths = Math.min(1 / monthlyChurnRate, MODELED_LIFE_CAP_MONTHS)
    ltvNew = avgNewCustomerMonthlyRevenue * grossMarginPct * modeledMonths
  }
  const ltvNewRatio = ltvNew !== null && cac !== null && cac > 0 ? ltvNew / cac : null

  return {
    quarterStart,
    hasData: true,
    revenue,
    cogsTotal,
    grossMarginPct,
    smSpend,
    newLogoCount,
    newLogoRevenue: rollForward.newLogoRevenue,
    avgNewCustomerMonthlyRevenue,
    cac,
    paybackMonths,
    monthlyChurnRate,
    ltvNew,
    ltvNewRatio
  }
}

// ---------------------------------------------------------------------------
// VC-06 — CAC & Payback Period
// ---------------------------------------------------------------------------

export async function computeVC06(orgId: string, period?: string): Promise<MetricResult> {
  const month = period ?? latestClosedMonth()
  const core = await computeUnitEconomicsCore(orgId, month)
  if (!core.hasData) return notComputable('VC-06', core.quarterStart, 'months')

  let flag: MetricFlag | null = null
  if (core.paybackMonths !== null) {
    const paybackOver18 = core.paybackMonths > 18
    const paybackOver24 = core.paybackMonths > 24
    const ltvBelow3 = core.ltvNewRatio !== null && core.ltvNewRatio < 3
    if (paybackOver24 || (paybackOver18 && ltvBelow3)) {
      flag = {
        level: 'act_now',
        reason: paybackOver24
          ? `Payback is ${core.paybackMonths.toFixed(1)} months, beyond the 24-month ceiling.`
          : `Payback is ${core.paybackMonths.toFixed(1)} months and LTV:CAC is ${core.ltvNewRatio!.toFixed(2)}x — both past target at once.`
      }
    } else if (paybackOver18) {
      flag = { level: 'watch', reason: `Payback is ${core.paybackMonths.toFixed(1)} months, past the 18-month target.` }
    } else if (ltvBelow3) {
      flag = { level: 'watch', reason: `LTV:CAC is ${core.ltvNewRatio!.toFixed(2)}x, below 3.0x.` }
    }
  }

  return {
    id: 'VC-06',
    period: core.quarterStart,
    computable: core.cac !== null && core.paybackMonths !== null,
    value: core.paybackMonths !== null ? round1(core.paybackMonths) : null,
    unit: 'months',
    data: {
      cac: core.cac !== null ? round2(core.cac) : null,
      smSpend: core.smSpend !== null ? round1(core.smSpend) : null,
      newCustomersWon: core.newLogoCount,
      grossMarginPct: core.grossMarginPct !== null ? round1(core.grossMarginPct * 100) : null,
      ltvCacRatio: core.ltvNewRatio !== null ? round2(core.ltvNewRatio) : null
    },
    flag,
    asOf: new Date().toISOString()
  }
}

// ---------------------------------------------------------------------------
// VC-07 — LTV:CAC (New Customers)
// ---------------------------------------------------------------------------

export async function computeVC07(orgId: string, period?: string): Promise<MetricResult> {
  const month = period ?? latestClosedMonth()
  const quarterStart = latestClosedQuarterStart(month)
  const [core, prevCore, twoAgoCore] = await Promise.all([
    computeUnitEconomicsCore(orgId, month),
    computeUnitEconomicsCore(orgId, shiftMonth(quarterStart, -3)),
    computeUnitEconomicsCore(orgId, shiftMonth(quarterStart, -6))
  ])
  if (!core.hasData) return notComputable('VC-07', quarterStart, 'multiple')

  const ratio = core.ltvNewRatio
  const prevRatio = prevCore.ltvNewRatio
  const twoAgoRatio = twoAgoCore.ltvNewRatio

  let flag: MetricFlag | null = null
  if (ratio !== null) {
    if (ratio < 2) flag = { level: 'act_now', reason: `LTV:CAC is ${ratio.toFixed(2)}x, below 2.0x.` }
    else if (ratio < 3) flag = { level: 'watch', reason: `LTV:CAC is ${ratio.toFixed(2)}x, below the 3.0x floor.` }
    else if (prevRatio !== null && twoAgoRatio !== null && ratio < prevRatio && prevRatio < twoAgoRatio) {
      // Doc: "above 3.0x but declining two quarters running" — needs a genuine
      // two-quarter losing streak, not just this quarter being lower than last
      // (a single dip after a long rise would otherwise false-fire).
      flag = {
        level: 'watch',
        reason: `LTV:CAC is ${ratio.toFixed(2)}x, above 3.0x but has fallen two quarters running: ${twoAgoRatio.toFixed(2)}x → ${prevRatio.toFixed(2)}x → ${ratio.toFixed(2)}x.`
      }
    }
  }

  return {
    id: 'VC-07',
    period: quarterStart,
    computable: ratio !== null,
    value: ratio !== null ? round2(ratio) : null,
    unit: 'multiple',
    data: {
      ltv: core.ltvNew !== null ? round1(core.ltvNew) : null,
      cac: core.cac !== null ? round2(core.cac) : null,
      monthlyChurnRate: core.monthlyChurnRate !== null ? round2(core.monthlyChurnRate * 100) : null,
      previousQuarterRatio: prevRatio !== null ? round2(prevRatio) : null
    },
    flag,
    asOf: new Date().toISOString()
  }
}

// ---------------------------------------------------------------------------
// VC-12 — Recurring Revenue % of Total
// ---------------------------------------------------------------------------

function recurringSharePct(pl: ParsedProfitAndLoss): { revenue: number; recurring: number; pct: number | null } {
  const revenue = sumColumn(pl.income, 'Total')
  const recurring = sumRecurringIncome(pl, 'Total')
  return { revenue, recurring, pct: revenue > 0 ? (recurring / revenue) * 100 : null }
}

export async function computeVC12(orgId: string, period?: string): Promise<MetricResult> {
  const month = period ?? latestClosedMonth()
  const quarterStart = latestClosedQuarterStart(month)
  const quarterStarts = [quarterStart, shiftMonth(quarterStart, -3), shiftMonth(quarterStart, -6), shiftMonth(quarterStart, -12)]
  const [currentOrNull, prevOrNull, prev2OrNull, yearAgoOrNull] = await Promise.all(quarterStarts.map((q) => getQuarterPL(orgId, q)))
  if (!currentOrNull) return notComputable('VC-12', quarterStart, 'percent')

  const cur = recurringSharePct(currentOrNull)
  const p1 = recurringSharePct(prevOrNull ?? EMPTY_PL)
  const p2 = recurringSharePct(prev2OrNull ?? EMPTY_PL)
  const ya = recurringSharePct(yearAgoOrNull ?? EMPTY_PL)

  let flag: MetricFlag | null = null
  if (cur.pct !== null && ya.pct !== null && ya.pct - cur.pct > 5) {
    flag = { level: 'act_now', reason: `Recurring revenue share fell ${(ya.pct - cur.pct).toFixed(1)} points over the past year, to ${cur.pct.toFixed(1)}%.` }
  } else if (cur.pct !== null && p1.pct !== null && p2.pct !== null && cur.pct < p1.pct && p1.pct < p2.pct) {
    flag = { level: 'watch', reason: `Recurring revenue share has fallen two quarters running: ${p2.pct.toFixed(1)}% → ${p1.pct.toFixed(1)}% → ${cur.pct.toFixed(1)}%.` }
  }

  return {
    id: 'VC-12',
    period: quarterStart,
    computable: cur.pct !== null,
    value: cur.pct !== null ? round1(cur.pct) : null,
    unit: 'percent',
    data: {
      revenue: round1(cur.revenue),
      recurringRevenue: round1(cur.recurring),
      previousQuarterPct: p1.pct !== null ? round1(p1.pct) : null,
      yearAgoQuarterPct: ya.pct !== null ? round1(ya.pct) : null
    },
    flag,
    asOf: new Date().toISOString()
  }
}

// ---------------------------------------------------------------------------
// VC-13 — Revenue Growth Rate (Recurring vs. Non-Recurring)
// ---------------------------------------------------------------------------

function growthPct(current: number, prior: number): number | null {
  return prior > 0 ? ((current - prior) / prior) * 100 : null
}

export async function computeVC13(orgId: string, period?: string, itemId?: string): Promise<MetricResult> {
  const month = period ?? latestClosedMonth()
  const quarterStart = latestClosedQuarterStart(month)
  const prevQuarterStart = shiftMonth(quarterStart, -3)
  const yearAgoQuarterStart = shiftMonth(quarterStart, -12)

  const [plOrNull, prevPlOrNull, yearAgoPlOrNull] = await Promise.all([
    getQuarterPL(orgId, quarterStart, itemId),
    getQuarterPL(orgId, prevQuarterStart, itemId),
    getQuarterPL(orgId, yearAgoQuarterStart, itemId)
  ])
  if (!plOrNull) return notComputable('VC-13', quarterStart, 'percent')

  const splits = (p: ParsedProfitAndLoss) => {
    const total = sumColumn(p.income, 'Total')
    const recurring = sumRecurringIncome(p, 'Total')
    return { total, recurring, nonRecurring: total - recurring }
  }
  const cur = splits(plOrNull)
  const prevQ = splits(prevPlOrNull ?? EMPTY_PL)
  const yearAgo = splits(yearAgoPlOrNull ?? EMPTY_PL)

  const totalYoY = growthPct(cur.total, yearAgo.total)
  const recurringYoY = growthPct(cur.recurring, yearAgo.recurring)
  // A non-recurring base under 5% of total is too small to bounce around meaningfully — excluded from alerts (PDF "Worth knowing").
  const nonRecurringBaseTooSmall = cur.total > 0 && cur.nonRecurring / cur.total < 0.05
  const nonRecurringYoY = nonRecurringBaseTooSmall ? null : growthPct(cur.nonRecurring, yearAgo.nonRecurring)
  const totalQoQ = growthPct(cur.total, prevQ.total)
  const recurringQoQ = growthPct(cur.recurring, prevQ.recurring)

  // Gated on totalYoY !== null (same condition as `computable` below) -- a flag must
  // never survive onto a response the card renders as "Not computable" (found during
  // manual validation: this leg's own inputs, totalQoQ/recurringQoQ, don't depend on
  // the year-ago quarter totalYoY needs, so they could resolve even when totalYoY can't).
  let flag: MetricFlag | null = null
  if (totalYoY !== null && totalQoQ !== null && recurringQoQ !== null && recurringQoQ < totalQoQ) {
    flag = {
      level: 'watch',
      reason: `Recurring revenue is growing slower (${recurringQoQ.toFixed(1)}%) than total revenue (${totalQoQ.toFixed(1)}%) this quarter — mix is degrading.`
    }
  }
  // The plan-relative legs (>10% below plan; misses plan two quarters running) need
  // operating-plan data this MVP doesn't have — see gap G-14.

  return {
    id: 'VC-13',
    period: quarterStart,
    computable: totalYoY !== null,
    value: totalYoY !== null ? round1(totalYoY) : null,
    unit: 'percent',
    data: {
      totalYoY: totalYoY !== null ? round1(totalYoY) : null,
      recurringYoY: recurringYoY !== null ? round1(recurringYoY) : null,
      nonRecurringYoY: nonRecurringYoY !== null ? round1(nonRecurringYoY) : null,
      totalQoQ: totalQoQ !== null ? round1(totalQoQ) : null,
      recurringQoQ: recurringQoQ !== null ? round1(recurringQoQ) : null,
      benchmarkAvailable: false
    },
    flag,
    asOf: new Date().toISOString()
  }
}

// ---------------------------------------------------------------------------
// VC-14 — Customer Lifetime Value to Acquisition Cost (Whole Base)
// ---------------------------------------------------------------------------

export async function computeVC14(orgId: string, period?: string): Promise<MetricResult> {
  const month = period ?? latestClosedMonth()
  const quarterStart = latestClosedQuarterStart(month)

  // Trailing 12 months = the 4 quarters ending with the requested quarter.
  const quarterStarts = [0, -3, -6, -9].map((d) => shiftMonth(quarterStart, d))
  const [cores, wholeBaseRollForward] = await Promise.all([
    Promise.all(quarterStarts.map((q) => computeUnitEconomicsCore(orgId, q))),
    computeQuarterRollForward(orgId, QUICKBOOKS, quarterStart)
  ])

  const current = cores[0]
  if (!current.hasData) return notComputable('VC-14', quarterStart, 'multiple')

  // Any quarter in the trailing-12mo window missing its P&L snapshot means the
  // TTM S&M spend can't be trusted — treating a gap as "$0 spent" would
  // understate CAC, which is worse than just marking it not computable.
  const allCoresHaveData = cores.every((c) => c.hasData)
  const ttmSmSpend = allCoresHaveData ? cores.reduce((sum, c) => sum + (c.smSpend ?? 0), 0) : null
  const ttmNewLogos = cores.reduce((sum, c) => sum + c.newLogoCount, 0)
  const cacTtm = ttmSmSpend !== null && ttmNewLogos > 0 ? ttmSmSpend / ttmNewLogos : null

  const avgMonthlyRevenuePerCustomer =
    wholeBaseRollForward.customerCount > 0 ? wholeBaseRollForward.endingRevenue / wholeBaseRollForward.customerCount : null

  let ltv: number | null = null
  if (avgMonthlyRevenuePerCustomer !== null && current.grossMarginPct !== null && current.monthlyChurnRate !== null && current.monthlyChurnRate > 0) {
    const modeledMonths = Math.min(1 / current.monthlyChurnRate, MODELED_LIFE_CAP_MONTHS)
    ltv = avgMonthlyRevenuePerCustomer * current.grossMarginPct * modeledMonths
  }
  const ratio = ltv !== null && cacTtm !== null && cacTtm > 0 ? ltv / cacTtm : null

  let flag: MetricFlag | null = null
  if (ratio !== null) {
    if (ratio < 3) flag = { level: 'act_now', reason: `Whole-base LTV:CAC is ${ratio.toFixed(2)}x, below 3.0x.` }
    // The PDF's watch condition is "fallen two quarters running AND at/below 3.5x" — approximated
    // here as just the level check (see gap G-17).
    else if (ratio <= 3.5) {
      flag = { level: 'watch', reason: `Whole-base LTV:CAC is ${ratio.toFixed(2)}x, near the 3.0x floor.` }
    }
  }

  return {
    id: 'VC-14',
    period: quarterStart,
    computable: ratio !== null,
    value: ratio !== null ? round2(ratio) : null,
    unit: 'multiple',
    data: {
      ltv: ltv !== null ? round1(ltv) : null,
      cacTrailing12Months: cacTtm !== null ? round2(cacTtm) : null,
      avgMonthlyRevenuePerCustomer: avgMonthlyRevenuePerCustomer !== null ? round2(avgMonthlyRevenuePerCustomer) : null,
      activeCustomerCount: wholeBaseRollForward.customerCount
    },
    flag,
    asOf: new Date().toISOString()
  }
}
