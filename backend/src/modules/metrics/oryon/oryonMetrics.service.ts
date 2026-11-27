/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Oryon metrics as `MetricResult`s for the dashboard (oryon-web portfolio
 * screens). Every number comes from the Python-parity port (engine.ts /
 * oryonData.ts / oryonPages.ts) evaluated at one month `e`, using the same
 * view as the reference app's page defaults:
 *   - retention, CAC, LTV/CAC, FCF, concentration: trailing 12 months ending at e
 *   - COGS %, G&A %, EBITDA, recurring %, growth, CCC, funnel, ROI, marketing-sourced: the quarter ending at e
 *   - cash, win rate (trailing 6 months), MQLs vs plan: the month e
 * Flags use the reference app's own thresholds (GRR 90 %, NRR 100 %, payback
 * 18 months, LTV/CAC settings threshold, runway 18 months, ROI / MQL settings thresholds).
 */
import { MetricResult, MetricFlag, MetricUnit } from '../metrics.types'
import * as E from './engine'
import { oryonDataFor, OryonData } from './oryonData'
import * as P from './oryonPages'
import { Dict, truthy } from './pyCompat'

/** `item`: a QuickBooks item id — only the invoice-based metrics (VC-01/02/03, CM-02, ER-05) take it. */
type Compute = (orgId: string, month: string, item?: string) => Promise<MetricResult>
const itemsOf = (item?: string) => (item ? [item] : null)

const result = (id: string, period: string, unit: MetricUnit, value: number | null | undefined, data: Dict, flag: MetricFlag | null = null): MetricResult => {
  const v = typeof value === 'number' && Number.isFinite(value) ? value : null
  return { id, period, computable: v !== null, value: v, unit, data, flag: v === null ? null : flag, asOf: new Date().toISOString() }
}
const watch = (cond: boolean, reason: string): MetricFlag | null => (cond ? { level: 'watch', reason } : null)
const fmt = (v: number, d = 1) => v.toFixed(d)

/** rows memoized per OryonData instance and view */
const viewCache = new WeakMap<OryonData, Map<string, Promise<Dict[]>>>()
function rowsOf(d: OryonData, key: string, fn: () => Dict[] | Promise<Dict[]>): Promise<Dict[]> {
  let m = viewCache.get(d)
  if (!m) viewCache.set(d, (m = new Map()))
  if (!m.has(key)) m.set(key, Promise.resolve(fn()))
  return m.get(key)!
}
const at = (rows: Dict[], month: string, key = 'month') => rows.find((r) => r[key] === month) ?? null
/** quarter rows (cogs_periods, grain=quarter) are keyed by their end month */
const quarterRow = (rows: Dict[], month: string) => rows.find((r) => r.end === month && r.months.length === 3 && r.complete) ?? null

// --------------------------------------------------------------------------- VC-01 / VC-02
const retentionAt = async (orgId: string, month: string, item?: string) => {
  const d = await oryonDataFor(orgId, itemsOf(item))
  const { native, isCad, settings, reliableFrom } = d.retentionInputs()
  const m0 = E.addMonths(month, -12)
  // the reference page only shows cohorts that start once 12 months of MRR data exist (earlier ones understate S)
  if (!reliableFrom || m0 < reliableFrom) return null
  const r = E.retention(native, isCad, settings.fx_cad_usd, m0, month)
  if (r) r.reliable = true
  return r
}

export const oryonVC01: Compute = async (orgId, month, item) => {
  const r = await retentionAt(orgId, month, item)
  return result('VC-01', month, 'percent', r?.grr, r ?? {}, r ? watch(r.grr < 90, `GRR ${fmt(r.grr)}% is below the 90% benchmark`) : null)
}
export const oryonVC02: Compute = async (orgId, month, item) => {
  const r = await retentionAt(orgId, month, item)
  return result('VC-02', month, 'percent', r?.nrr, r ?? {}, r ? watch(r.nrr < 100, `NRR ${fmt(r.nrr)}% is below 100%`) : null)
}

// --------------------------------------------------------------------------- VC-03 new-logo ARR growth (12 months vs the 12 before)
export const oryonVC03: Compute = async (orgId, month, item) => {
  const d = await oryonDataFor(orgId, itemsOf(item))
  const [logos, info] = d.newlogoInputs()
  const ttm = P.newlogoWindow(logos, info, E.addMonths(month, -11), month)
  const prev = P.newlogoWindow(logos, info, E.addMonths(month, -23), E.addMonths(month, -12))
  const complete = truthy(info.complete_until) && month <= info.complete_until
  const growth = complete && prev.full && prev.arr ? ((ttm.arr - prev.arr) / prev.arr) * 100 : null
  return result('VC-03', month, 'percent', growth, {
    newLogoArr: ttm.arr, newLogos: ttm.n, newLogoRevenue: ttm.arr, newLogoCustomerCount: ttm.n, priorNewLogoArr: prev.arr, priorNewLogos: prev.n,
    avgArrPerLogo: ttm.n ? ttm.arr / ttm.n : null, complete, ttm, prev
  })
}

// --------------------------------------------------------------------------- VC-04 COGS %
export const oryonVC04: Compute = async (orgId, month) => {
  const d = await oryonDataFor(orgId)
  const r = quarterRow(await rowsOf(d, 'cogs:q', () => P.cogsRows(d, 'quarter', 'period')), month)
  return result('VC-04', month, 'percent', r?.pct, r ? {
    ...r, cogsTotal: r.cogs, platformPct: r.lines.Platform.pct, servicesPct: r.lines.Services.pct, hardwarePct: r.lines.Hardware.pct,
    // product-line revenue mix, in the shape the overview's revenue chart / product comparison read
    mix: (Object.entries(r.lines) as [string, Dict][]).filter(([, v]) => v.revenue).map(([cls, v]) => ({ class: cls, revenue: v.revenue, mixPct: v.share, cogsPct: v.pct }))
  } : {})
}

// --------------------------------------------------------------------------- VC-06 CAC payback / VC-07, VC-14 LTV/CAC
export const oryonVC06: Compute = async (orgId, month) => {
  const d = await oryonDataFor(orgId)
  const r = at(await rowsOf(d, 'cac', () => d.cacRows()), month)
  const flag = r?.payback != null ? watch(r.payback > 18, `CAC payback ${fmt(r.payback)} months is above the 18-month threshold`) : null
  return result('VC-06', month, 'months', r?.payback, r ? { ...r, gmPct: r.gm !== null ? r.gm * 100 : null } : {}, flag)
}

const ltvAt = async (orgId: string, month: string) => {
  const d = await oryonDataFor(orgId)
  return { r: at(await rowsOf(d, 'ltv', () => P.ltvRows(d)), month), threshold: Number(d.settings().ltv_threshold ?? 3) }
}
export const oryonVC07: Compute = async (orgId, month) => {
  const { r, threshold } = await ltvAt(orgId, month)
  const data = r ? { ...r, churnPct: r.churn !== null ? r.churn * 100 : null } : {}
  return result('VC-07', month, 'multiple', r?.ltv_cac, data, r?.ltv_cac != null ? watch(r.ltv_cac < threshold, `LTV/CAC ${fmt(r.ltv_cac, 2)}x is below ${threshold}x`) : null)
}
export const oryonVC14: Compute = async (orgId, month) => {
  const { r, threshold } = await ltvAt(orgId, month)
  // ARR and active customers for the overview tiles, independent of whether LTV/CAC itself is computable
  const data = r ? { ...r, activeCustomerCount: r.customers, avgMonthlyRevenuePerCustomer: r.customers ? r.arr / (r.customers * 12) : null } : {}
  return result('VC-14', month, 'multiple', r?.base_ltv_cac, data, r?.base_ltv_cac != null ? watch(r.base_ltv_cac < threshold, `Whole-base LTV/CAC ${fmt(r.base_ltv_cac, 2)}x is below ${threshold}x`) : null)
}

// --------------------------------------------------------------------------- VC-09 G&A %, VC-10 EBITDA, VC-12 recurring %, VC-13 growth
export const oryonVC09: Compute = async (orgId, month) => {
  const d = await oryonDataFor(orgId)
  const r = quarterRow(await rowsOf(d, 'ga:q', () => P.gaRows(d, 'quarter', 'period')), month)
  return result('VC-09', month, 'percent', r?.pct, r ?? {})
}
export const oryonVC10: Compute = async (orgId, month) => {
  const d = await oryonDataFor(orgId)
  const rows = await rowsOf(d, 'ebitda:q', () => P.ebitdaRows(d, 'quarter', 'period'))
  const r = quarterRow(rows, month)
  const prev = r ? quarterRow(rows, E.addMonths(month, -3)) : null
  return result('VC-10', month, 'percent', r?.margin, r ? { ...r, previousQuarterMargin: prev?.margin ?? null } : {})
}
export const oryonVC12: Compute = async (orgId, month) => {
  const d = await oryonDataFor(orgId)
  const r = quarterRow(await rowsOf(d, 'recurring:q', () => P.recurringRows(d, 'quarter', 'period')), month)
  return result('VC-12', month, 'percent', r && r.complete ? r.pct : null, r ?? {})
}
export const oryonVC13: Compute = async (orgId, month) => {
  const d = await oryonDataFor(orgId)
  const r = quarterRow(await rowsOf(d, 'growth:q', () => P.growthRows(d, 'quarter', 'period')), month)
  return result('VC-13', month, 'percent', r && r.has_prior ? r.growth : null, r ? { ...r, totalYoY: r.has_prior ? r.growth : null } : {})
}

// --------------------------------------------------------------------------- CB-05 cash, CB-07 FCF, CB-10 CCC
export const oryonCB05: Compute = async (orgId, month) => {
  const d = await oryonDataFor(orgId)
  const r = at(d.cashInputs()[0], month)
  const ok = r && !r.stale
  const flag = ok && r.runway !== null ? watch(r.runway < 18, `Runway ${fmt(r.runway)} months is below 18 months`) : null
  return result('CB-05', month, 'usd', ok ? r.cash : null, ok ? r : {}, flag)
}
export const oryonCB07: Compute = async (orgId, month) => {
  const d = await oryonDataFor(orgId)
  const r = at(d.fcfInputs(), month)
  const data = r ? (({ capex_lines: _c, ...rest }) => rest)(r) : {}
  return result('CB-07', month, 'percent', r && r.ttm_ok ? r.fcf_pct : null, data)
}
export const oryonCB10: Compute = async (orgId, month) => {
  const d = await oryonDataFor(orgId)
  const r = at(d.cccInputs(), month)
  return result('CB-10', month, 'days', r?.ccc, r ?? {})
}

// --------------------------------------------------------------------------- CM-02 concentration, ER-05 diversification
export const oryonCM02: Compute = async (orgId, month, item) => {
  const d = await oryonDataFor(orgId, itemsOf(item))
  const r = at(d.concInputs(null), month)
  const top5 = r ? r.ranking.slice(0, 5).reduce((s: number, g: Dict) => s + g.share, 0) : null
  return result('CM-02', month, 'percent', r?.share, r ? { ...r, ranking: r.ranking.slice(0, 10), top5Share: top5 } : {})
}
export const oryonER05: Compute = async (orgId, month, item) => {
  const d = await oryonDataFor(orgId, itemsOf(item))
  const cfg = d.divSettings()
  const r = at(d.concInputs(null, cfg.top_n), month)
  const flag = r && cfg.threshold > 0 ? watch(r.share > cfg.threshold, `Top-${cfg.top_n} share ${fmt(r.share, 2)}% is above ${cfg.threshold}%`) : null
  return result('ER-05', month, 'percent', r?.share, r ? { ...r, ranking: r.ranking.slice(0, cfg.top_n) } : {}, flag)
}

// --------------------------------------------------------------------------- CM-03 win rate vs the headline competitor
export const oryonCM03: Compute = async (orgId, month) => {
  const d = await oryonDataFor(orgId)
  const page = await rowsOf(d, 'wr', async () => {
    const p = await P.wrPage(d, {})
    return [{ rows: p.rows, info: p.info }]
  })
  const { rows, info } = page[0]
  const r = at(rows, month)
  const c = r && info.headline ? r.comp[info.headline] : null
  return result('CM-03', month, 'percent', c?.rate, r ? { ...r, headline: info.headline, headlineDeals: c?.deals ?? null, headlineDecided: c?.decided ?? null, headlineWon: c?.won ?? null, blendedWinRatePct: c?.rate ?? null } : {})
}

// --------------------------------------------------------------------------- CM-05 marketing-sourced, CM-06 funnel, CM-07 ROI, CM-08 MQLs
export const oryonCM05: Compute = async (orgId, month) => {
  const d = await oryonDataFor(orgId)
  const page = await rowsOf(d, 'msp:q', async () => {
    const p = await P.mspPage(d, { grain: 'quarter', view: 'period' })
    return [{ rows: p.rows, threshold: p.cfg.threshold }]
  })
  const r = at(page[0].rows, month)
  const thr = page[0].threshold
  return result('CM-05', month, 'percent', r?.pct, r ?? {}, r?.pct != null && thr > 0 ? watch(r.pct < thr, `Marketing-sourced ${fmt(r.pct)}% is below ${thr}%`) : null)
}

export const oryonCM06: Compute = async (orgId, month) => {
  const d = await oryonDataFor(orgId)
  const rows = await rowsOf(d, 'fn:q', async () => (await P.fnPage(d, { grain: 'quarter', view: 'period' })).rows)
  const r = at(rows, month)
  const stages = r
    ? (Object.entries(E.FUNNEL_STEPS) as [string, string][]).map(([key, label]) => ({ key, label, ratePct: r[`${key}_pct`], immature: r.immature[key] }))
    : []
  return result('CM-06', month, 'percent', r?.m2s_pct, r ? { ...r, stages } : {})
}

export const oryonCM07: Compute = async (orgId, month) => {
  const d = await oryonDataFor(orgId)
  const page = await rowsOf(d, 'roi:q', async () => {
    const p = await P.roiPage(d, { grain: 'quarter', view: 'period' })
    return [{ rows: p.rows, threshold: p.cfg.threshold }]
  })
  const r = at(page[0].rows, month)
  const thr = page[0].threshold
  return result('CM-07', month, 'multiple', r?.blended, r ?? {}, r?.blended != null ? watch(r.blended < thr, `Blended marketing ROI ${fmt(r.blended, 2)}x is below ${thr}x`) : null)
}

export const oryonCM08: Compute = async (orgId, month) => {
  const d = await oryonDataFor(orgId)
  const page = await rowsOf(d, 'mql:m', async () => {
    const [rows, info] = await d.mqlInputs('month', 'period')
    return [{ rows, threshold: info.threshold }]
  })
  const r = at(page[0].rows, month)
  const thr = page[0].threshold
  const flag = r && r.pct !== null ? watch(r.pct < thr, `${r.mqls} MQLs, ${fmt(-r.pct)}% below the plan of ${Math.round(r.plan)}`) : null
  return result('CM-08', month, 'count', r?.mqls, r ?? {}, flag)
}
