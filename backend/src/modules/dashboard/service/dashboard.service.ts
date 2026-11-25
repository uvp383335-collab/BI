import { organizationsRepository } from '../../organizations/repository/organizations.repository'
import { integrationsRepository } from '../../integrations/repository/integrations.repository'
import { productRepository } from '../../sync/repository/product.repository'
import { latestClosedMonth } from '../../metrics/service/revenueRollForward.service'
import { AppError } from '../../../shared/utils/AppError'
import { METRICS, METRIC_BY_ID, FAMILIES, Family, MetricDef, DashUnit, num } from './metricRegistry'
import { evaluate, EvalContext, Point } from './metricEvaluator'
import {
  isMonth, isQuarter, completedQuarterAt, trailingPeriods, prevPeriod, yearAgo, periodRange, quarterEndMonth,
  periodLabel, periodShort
} from './periods'

/**
 * Builds the oryon-web screen payloads (meta / overview / family / metric
 * drawer / alerts) from the existing metric services. Payload shapes follow
 * oryon-dashboard/docs/API.md; anything our data can't support yet (TTM
 * window, region/segment filters, splits, breakdown) is returned empty and
 * advertised as unsupported in `meta.capabilities`.
 *
 * The product filter is one QuickBooks item, applied to the metrics that read
 * the per-product P&L (VC-04, VC-10, VC-13); every other metric stays
 * company-wide and is tagged so. Alerts are always company-wide.
 */

export interface DashboardQuery {
  asOf?: string
  span?: string
  n?: string
  compareOn?: string
  /** Product filter: the label of one QuickBooks item, as listed in meta.products. */
  product?: string
}

interface View {
  asOf: string
  window: 'P'
  span: number
  monthly: boolean
  quarter: string
  /** Selected QuickBooks item (id + label), if the product filter is set. */
  product: { id: string; label: string } | null
}

interface ProductOption { id: string; label: string }

interface Ctx extends EvalContext {
  products: ProductOption[]
}

/** QuickBooks items as filter options; duplicate names get their id appended so labels stay unique. */
function productOptions(rows: Array<{ providerRecordId: string; name: string }>): ProductOption[] {
  const counts = new Map<string, number>()
  rows.forEach((r) => counts.set(r.name, (counts.get(r.name) ?? 0) + 1))
  return rows
    .map((r) => ({ id: r.providerRecordId, label: (counts.get(r.name) ?? 0) > 1 ? `${r.name} (#${r.providerRecordId})` : r.name }))
    .sort((a, b) => a.label.localeCompare(b.label))
}

interface Alert {
  id: string
  period: string
  flag: 'Act now' | 'Watch'
  why: string
}

const PROVIDER_LABELS: Record<string, string> = { quickbooks: 'QuickBooks Online', salesforce: 'Salesforce', hubspot: 'HubSpot' }
const RATE_UNITS: DashUnit[] = ['%', 'pts', 'x', 'months', 'days']

const pct = (a: number | null, b: number | null): number | null => (a == null || !b ? null : (100 * a) / b)
const delta = (v: number | null, p: number | null, unit: DashUnit): number | null =>
  v == null || p == null ? null : RATE_UNITS.includes(unit) ? v - p : p ? v / p - 1 : null

async function context(orgId: string): Promise<Ctx> {
  const [integrations, org, productsChangedAt, items] = await Promise.all([
    integrationsRepository.listByOrg(orgId),
    organizationsRepository.findById(orgId),
    productRepository.latestUpdatedAt(orgId),
    productRepository.findAllForOrg(orgId, 'quickbooks')
  ])
  const providers = new Set(integrations.map((i) => i.provider))
  const provider = providers.has('hubspot') ? 'hubspot' : providers.has('salesforce') ? 'salesforce' : 'hubspot'
  const lastMonth = latestClosedMonth()
  // Any sync, (dis)connect, settings save or product categorization moves one of these timestamps.
  const stamps = [
    ...integrations.flatMap((i) => [i.updatedAt, i.lastSyncedAt]),
    (org as { updatedAt?: Date } | null)?.updatedAt,
    productsChangedAt
  ].map((d) => (d ? new Date(d).getTime() : 0))
  const dataVersion = `${integrations.length}:${Math.max(0, ...stamps)}`
  return { orgId, provider, lastMonth, lastQuarter: completedQuarterAt(lastMonth), dataVersion, products: productOptions(items) }
}

function parseView(ctx: Ctx, q: DashboardQuery): View {
  let asOf = q.asOf && (isMonth(q.asOf) || isQuarter(q.asOf)) ? q.asOf : ctx.lastQuarter
  if (isMonth(asOf) && asOf > ctx.lastMonth) asOf = ctx.lastMonth
  if (isQuarter(asOf) && asOf > ctx.lastQuarter) asOf = ctx.lastQuarter
  const span = [4, 8, 12].includes(Number(q.span)) ? Number(q.span) : 8
  const monthly = isMonth(asOf)
  // one product only: the per-product snapshots can't be combined across items
  const wanted = q.product && q.product !== 'All' ? q.product.split(',')[0] : null
  const product = (wanted && ctx.products.find((p) => p.label === wanted)) || null
  return { asOf, window: 'P', span, monthly, quarter: monthly ? completedQuarterAt(asOf) : asOf, product }
}

const viewEcho = (v: View) => ({
  asOf: v.asOf, window: v.window, span: v.span, monthly: v.monthly, quarter: v.quarter,
  filters: { region: 'All', segment: 'All', product: v.product ? [v.product.label] : 'All' }
})

/** How the active filter applies to a metric (oryon-web's card tags). */
const scopeOf = (m: MetricDef, v: View) => (v.product ? (m.filters ? 'filtered' : 'company') : m.filters ? 'responsive' : 'company')

const def = (id: string): MetricDef => {
  const m = METRIC_BY_ID.get(id)
  if (!m) throw AppError.notFound(`Unknown metric ${id}`, 'METRIC_NOT_FOUND')
  return m
}

const toAlert = (id: string, period: string, p: Point): Alert | null =>
  p.flag ? { id, period, flag: p.flag.level === 'act_now' ? 'Act now' : 'Watch', why: p.flag.reason.replace(/\.$/, '') } : null

const pointsAt = (ctx: EvalContext, quarter: string, priority: 'screen' | 'background' = 'screen') =>
  Promise.all(METRICS.map((m) => evaluate(m, ctx, quarter, priority)))

const alertsFrom = (quarter: string, points: Point[]): Alert[] =>
  METRICS.map((m, i) => toAlert(m.id, quarter, points[i])).filter((a): a is Alert => a !== null)

async function alertsAt(ctx: EvalContext, quarter: string, priority: 'screen' | 'background' = 'screen'): Promise<Alert[]> {
  return alertsFrom(quarter, await pointsAt(ctx, quarter, priority))
}

const periodFor = (m: MetricDef, v: View) => (v.monthly && m.grain === 'Q' ? v.quarter : v.asOf)

// ------------------------------------------------------------------ meta

export async function getMeta(orgId: string) {
  const ctx = await context(orgId)
  // Meta is the first call every screen makes: start computing the alert map (the slowest part
  // of the overview, sidebar and alerts screens) in the background so it is cached by the time
  // those requests arrive.
  void buildAlertMap(ctx, ctx.lastQuarter, 8, 'background').catch(() => undefined)
  const [org, integrations] = await Promise.all([organizationsRepository.findById(orgId), integrationsRepository.listByOrg(orgId)])
  const quarters = trailingPeriods(ctx.lastQuarter, 12)
  return {
    company: { id: orgId, name: org?.name ?? 'Organization', sector: null },
    dataThrough: ctx.lastMonth,
    quarters,
    months: periodRange(quarterEndMonth(quarters[0]), ctx.lastMonth),
    regions: [] as string[],
    segments: [] as string[],
    products: ctx.products.map((p) => p.label),
    families: FAMILIES,
    metrics: METRICS.map((m) => ({
      id: m.id, family: m.family, name: m.name, source: m.source, unit: m.unit, dir: m.dir, threshold: m.threshold,
      definition: m.definition, filters: m.filters ?? '', grain: m.grain, window: m.latestOnly ? 'PIT' : 'PT'
    })),
    sources: integrations.map((i) => PROVIDER_LABELS[i.provider] ?? i.provider),
    builtAt: null,
    dq: [],
    // What the backend can serve today; the UI disables the matching controls.
    capabilities: {
      ttm: false, region: false, segment: false, setup: false, splits: false, breakdown: false,
      // only when some metric can be filtered by a QuickBooks item (the Oryon calculations are company-wide)
      product: ctx.products.length > 0 && METRICS.some((m) => m.filters === 'P'),
      productMulti: false
    }
  }
}

// ------------------------------------------------------------------ one metric (card + drawer)

async function metricView(ctx: Ctx, m: MetricDef, v: View, full: boolean) {
  const p = periodFor(m, v)
  const n = isMonth(p) ? v.span * 3 : v.span
  const periods = trailingPeriods(p, n + 1) // one extra for the prior-period comparison
  const qp = isMonth(p) ? completedQuarterAt(p) : p
  const item = v.product?.id
  const at = (x: string) => evaluate(m, ctx, x, 'screen', item)
  // alerts stay company-wide, like the alerts page and alert map
  const [points, alertPoint] = await Promise.all([Promise.all(periods.map(at)), evaluate(m, ctx, qp)])
  const cur = points[points.length - 1]
  const prev = points[points.length - 2]
  const out: Record<string, unknown> = {
    id: m.id, name: m.name, label: m.name, family: m.family, unit: m.unit, dir: m.dir, threshold: m.threshold,
    period: p, periodLabel: periodLabel(p), window: m.latestOnly ? 'P' : v.window, grain: m.grain,
    quarterlyInMonthlyView: v.monthly && m.grain === 'Q',
    scope: scopeOf(m, v), filters: m.filters ?? '',
    value: cur.value, win: m.latestOnly ? 'Latest sync' : periodLabel(p), abs: cur.abs, subs: cur.subs,
    prev: { period: prevPeriod(p), value: prev.value, abs: prev.abs?.value ?? null },
    delta: delta(cur.value, prev.value, m.unit),
    immature: false,
    alert: toAlert(m.id, qp, alertPoint),
    series: periods.slice(1).map((x, i) => ({ period: x, value: points[i + 1].value, abs: points[i + 1].abs?.value ?? null }))
  }
  if (full) {
    const qs = trailingPeriods(qp, v.span)
    const histQs = trailingPeriods(qp, 12)
    const [rows, hist] = await Promise.all([
      Promise.all(qs.map(at)),
      Promise.all(histQs.map((x) => evaluate(m, ctx, x)))
    ])
    const subKeys = (rows.find((r) => r.subs.length) ?? rows[rows.length - 1]).subs
    out.definition = m.definition
    out.source = m.source
    out.splits = []
    out.detail = {
      periods: qs,
      rows: [
        { key: 'value', label: m.name, unit: m.unit, values: rows.map((r) => r.value) },
        ...subKeys.map((s) => ({ key: s.key, label: s.label, unit: s.unit, values: rows.map((r) => r.subs.find((x) => x.key === s.key)?.value ?? null) }))
      ]
    }
    out.alertHistory = histQs.map((x, i) => toAlert(m.id, x, hist[i])).filter(Boolean)
  }
  return out
}

export async function getMetric(orgId: string, metricId: string, q: DashboardQuery) {
  const ctx = await context(orgId)
  return metricView(ctx, def(metricId), parseView(ctx, q), true)
}

export async function getFamily(orgId: string, family: Family, q: DashboardQuery) {
  const ctx = await context(orgId)
  const v = parseView(ctx, q)
  const metrics = await Promise.all(METRICS.filter((m) => m.family === family).map((m) => metricView(ctx, m, v, false)))
  return { view: viewEcho(v), family, name: FAMILIES[family], metrics }
}

// ------------------------------------------------------------------ overview

interface MixRow { class: string; revenue: number; mixPct: number | null; cogsPct: number | null }

function mixOf(p: Point): MixRow[] {
  const raw = (p.result?.data as Record<string, unknown> | undefined)?.mix
  if (!Array.isArray(raw)) return []
  return raw
    .map((x: Record<string, unknown>) => ({ class: String(x.class), revenue: num(x.revenue) ?? 0, mixPct: num(x.mixPct), cogsPct: num(x.cogsPct) }))
    .sort((a, b) => b.revenue - a.revenue)
}

const dataNum = (p: Point, key: string): number | null => num((p.result?.data as Record<string, unknown> | undefined)?.[key])

export async function getOverview(orgId: string, q: DashboardQuery) {
  const ctx = await context(orgId)
  const v = parseView(ctx, q)
  const n = v.monthly ? v.span * 3 : v.span
  const ps = trailingPeriods(v.asOf, n)
  const at = (id: string, p: string, item?: string) => evaluate(def(id), ctx, p, 'screen', item)
  // every period the overview reads: the series, the prior period, and a year back for growth
  const ids = ['VC-01', 'VC-02', 'VC-03', 'VC-04', 'VC-10', 'VC-13', 'VC-14', 'CM-03']
  const periods = Array.from(new Set([...ps, prevPeriod(v.asOf), yearAgo(v.asOf), ...ps.map(yearAgo)]))
  const item = v.product?.id
  const grid = new Map<string, Point>()
  await Promise.all(
    ids.flatMap((id) =>
      periods.flatMap((p) => [
        at(id, p).then((x) => grid.set(`${id}|${p}`, x)),
        // KPI tiles follow the product filter; the charts and product comparison stay company-wide
        ...(item && def(id).filters ? [at(id, p, item).then((x) => grid.set(`${id}|${p}|f`, x))] : [])
      ])
    )
  )
  const g = (id: string, p: string): Point => grid.get(`${id}|${p}`) as Point
  const gf = (id: string, p: string): Point => grid.get(`${id}|${p}|f`) ?? g(id, p)
  const cashSeries = await Promise.all(ps.map((p) => at('CB-05', p)))
  const cash = cashSeries[cashSeries.length - 1]

  const arr = (p: string) => {
    const x = g('VC-14', p)
    const avg = dataNum(x, 'avgMonthlyRevenuePerCustomer'), cnt = dataNum(x, 'activeCustomerCount')
    return avg == null || cnt == null ? null : 12 * avg * cnt
  }
  const revenue = (p: string) => dataNum(g('VC-13', p), 'revenue')
  const grossMargin = (p: string) => { const c = g('VC-04', p).value; return c == null ? null : 100 - c }
  const newLogoRevenue = (p: string) => dataNum(g('VC-03', p), 'newLogoRevenue')
  const ebitda = (p: string) => dataNum(g('VC-10', p), 'ebitda')
  const k = (n0: number | null, suffix: string) => (n0 == null ? null : `${Math.round(n0 / 1e3).toLocaleString('en-US')}K ${suffix}`)

  const kpi = (key: string, label: string, unit: DashUnit, metricId: string | null, fn: (p: string) => number | null, sub: string | null) => {
    const series = ps.map((p) => ({ period: p, value: fn(p) }))
    const value = series[series.length - 1].value
    const prev = fn(prevPeriod(v.asOf))
    return { key, label, unit, dir: 'up', metricId, value, prev, delta: delta(value, prev, unit), sub, series }
  }
  const runway = cash.subs.find((s) => s.key === 'runway')?.value ?? null
  const fRevenue = (p: string) => dataNum(gf('VC-13', p), 'revenue')
  // Same VC-13 result the "Revenue, quarter" tile already reads — just its own totalYoY field, not a second growth calculation.
  const fRevenueGrowth = (p: string) => dataNum(gf('VC-13', p), 'totalYoY')
  const fGrossMargin = (p: string) => { const c = gf('VC-04', p).value; return c == null ? null : 100 - c }
  const fGrossProfit = (p: string) => { const x = gf('VC-04', p); const r = dataNum(x, 'revenue'), c = dataNum(x, 'cogsTotal'); return r == null || c == null ? null : r - c }
  const fEbitda = (p: string) => dataNum(gf('VC-10', p), 'ebitda')
  const kpis = [
    // No dedicated ARR metric exists in METRICS (ARR is derived here from VC-14's avgMonthlyRevenuePerCustomer x
    // activeCustomerCount x 12) -- metricId stays null rather than pointing at VC-14's own card ("LTV / CAC, whole
    // base"), which would open on an unrelated headline value and alert.
    kpi('arr', 'ARR', 'USD', null, arr, dataNum(g('VC-14', v.asOf), 'activeCustomerCount') == null ? null : `${dataNum(g('VC-14', v.asOf), 'activeCustomerCount')} active customers`),
    kpi('revenue', 'Revenue, quarter', 'USD', 'VC-13', fRevenue, v.product ? v.product.label : null),
    kpi('revenueGrowth', 'Revenue growth', '%', 'VC-13', fRevenueGrowth, v.product ? v.product.label : null),
    kpi('gm', 'Gross margin', '%', 'VC-04', fGrossMargin, k(fGrossProfit(v.asOf), 'gross profit')),
    kpi('nrr', 'NRR', '%', 'VC-02', (p) => g('VC-02', p).value, null),
    kpi('grr', 'GRR', '%', 'VC-01', (p) => g('VC-01', p).value, null),
    kpi('newArr', 'New-logo revenue', 'USD', 'VC-03', newLogoRevenue, dataNum(g('VC-03', v.asOf), 'newLogoCustomerCount') == null ? null : `${dataNum(g('VC-03', v.asOf), 'newLogoCustomerCount')} new logos`),
    kpi('ebitda', 'EBITDA margin', '%', 'VC-10', (p) => gf('VC-10', p).value, k(fEbitda(v.asOf), 'EBITDA')),
    {
      key: 'cash', label: 'Unrestricted cash', unit: 'USD', dir: 'up', metricId: 'CB-05', value: cash.value, prev: null, delta: null,
      sub: cash.value == null ? null : runway == null ? 'Self-funding' : `${runway.toFixed(0)} months runway`,
      series: ps.map((p, i) => ({ period: p, value: cashSeries[i].value }))
    }
  ]

  const products = Array.from(new Set(ps.flatMap((p) => mixOf(g('VC-04', p)).map((x) => x.class))))
  const stacks = products.length
    ? products.map((c) => ({ key: c, values: ps.map((p) => mixOf(g('VC-04', p)).find((x) => x.class === c)?.revenue ?? null) }))
    : [{ key: 'Revenue', values: ps.map(revenue) }]

  const charts = {
    periods: ps.map((p) => ({ period: p, label: periodShort(p), long: periodLabel(p) })),
    retention: { grr: ps.map((p) => g('VC-01', p).value), nrr: ps.map((p) => g('VC-02', p).value), threshold: { grr: 90, nrr: 100 } },
    revenue: { by: 'product', stacks, grossMargin: ps.map(grossMargin) },
    newBusiness: { arr: ps.map(newLogoRevenue), winRate: ps.map((p) => dataNum(g('CM-03', p), 'blendedWinRatePct')) },
    arr: { arr: ps.map(arr), customers: ps.map((p) => dataNum(g('VC-14', p), 'activeCustomerCount')) },
    profitability: { ebitda: ps.map(ebitda), margin: ps.map((p) => g('VC-10', p).value), revenue: ps.map(revenue) }
  }

  const [currentPoints, alertMap] = await Promise.all([pointsAt(ctx, v.quarter), buildAlertMap(ctx, v.quarter)])
  const currentAlerts = alertsFrom(v.quarter, currentPoints)
  const noData = new Set(METRICS.filter((_, i) => currentPoints[i].value === null).map((m) => m.id))

  return {
    view: viewEcho(v),
    kpis,
    charts,
    productComparison: { ...productComparison(v, ps, products, g, q.compareOn ?? 'revenue'), ignoresFilters: !!v.product },
    breakdown: { by: 'segment', period: v.asOf, retentionAsOf: v.quarter, rows: [] },
    read: { items: readItems(currentAlerts, v.quarter) },
    health: health(currentAlerts, noData),
    alertMap
  }
}

function productComparison(v: View, ps: string[], products: string[], g: (id: string, p: string) => Point, on: string) {
  const row = (p: string, c: string) => mixOf(g('VC-04', p)).find((x) => x.class === c) ?? null
  const gp = (r: MixRow | null) => (r && r.cogsPct != null ? r.revenue * (1 - r.cogsPct / 100) : null)
  const gm = (r: MixRow | null) => (r && r.cogsPct != null ? 100 - r.cogsPct : null)
  const measure = (p: string, c: string): number | null => {
    const a = row(p, c)
    if (!a) return null
    if (on === 'grossProfit') return gp(a)
    if (on === 'grossMargin') return gm(a)
    if (on === 'growth') { const b = row(yearAgo(p), c); return b?.revenue ? 100 * (a.revenue / b.revenue - 1) : null }
    if (on === 'mix') return a.mixPct
    return a.revenue
  }
  const company = g('VC-04', v.asOf)
  const companyRevenue = dataNum(company, 'revenue'), companyCogs = dataNum(company, 'cogsTotal')
  const rows = products.map((c) => {
    const a = row(v.asOf, c), b = row(prevPeriod(v.asOf), c), y = row(yearAgo(v.asOf), c)
    if (!a) return null
    const gmA = gm(a), gmB = gm(b)
    return {
      key: c, revenue: a.revenue, vsPrior: b?.revenue ? a.revenue / b.revenue - 1 : null, yoy: y?.revenue ? 100 * (a.revenue / y.revenue - 1) : null,
      grossProfit: gp(a), grossMargin: gmA, gmVsPrior: gmA != null && gmB != null ? gmA - gmB : null, share: a.mixPct
    }
  })
  const present = rows.filter((r): r is NonNullable<typeof r> => r !== null)
  const sum = (f: (r: (typeof present)[number]) => number | null) => present.reduce((t, r) => t + (f(r) ?? 0), 0)
  const totRev = sum((r) => r.revenue), totGp = sum((r) => r.grossProfit)
  return {
    on, products, periods: ps,
    series: products.map((c) => ({ key: c, values: ps.map((p) => measure(p, c)) })),
    rows,
    selectedTotal: present.length > 1
      ? { key: products.join(' + '), revenue: totRev, vsPrior: null, yoy: null, grossProfit: totGp, grossMargin: pct(totGp, totRev), gmVsPrior: null, share: pct(totRev, companyRevenue) }
      : null,
    company: companyRevenue != null && companyCogs != null
      ? { revenue: companyRevenue, grossProfit: companyRevenue - companyCogs, grossMargin: pct(companyRevenue - companyCogs, companyRevenue), note: 'includes COGS not allocated to a product' }
      : null,
    ignoresFilters: false
  }
}

function readItems(alerts: Alert[], quarter: string) {
  if (!alerts.length) return [{ flag: null, headline: `No metric is flagged in ${periodLabel(quarter)}.`, body: null, nextStep: null, ids: [] }]
  return alerts
    .slice()
    .sort((a, b) => (a.flag === b.flag ? 0 : a.flag === 'Act now' ? -1 : 1))
    .map((a) => ({ flag: a.flag, headline: `${a.why}.`, body: null, nextStep: null, ids: [a.id] }))
}

/** Flags per family; `noData` counts metrics with no value this quarter (not "on track"). */
function health(alerts: Alert[], noData: Set<string>) {
  return (Object.keys(FAMILIES) as Family[]).map((f) => {
    const ids = METRICS.filter((m) => m.family === f).map((m) => m.id)
    const fa = alerts.filter((a) => ids.includes(a.id))
    const flagged = new Set(fa.map((a) => a.id))
    return {
      family: f, name: FAMILIES[f], metrics: ids.length,
      actNow: fa.filter((a) => a.flag === 'Act now').length, watch: fa.filter((a) => a.flag === 'Watch').length,
      noData: ids.filter((id) => noData.has(id) && !flagged.has(id)).length
    }
  })
}

async function buildAlertMap(ctx: EvalContext, quarter: string, n = 8, priority: 'screen' | 'background' = 'screen') {
  const qs = trailingPeriods(quarter, n)
  const perQuarter = await Promise.all(qs.map((x) => alertsAt(ctx, x, priority)))
  const flags = new Map<string, Alert>()
  perQuarter.flat().forEach((a) => flags.set(`${a.period}|${a.id}`, a))
  return { quarters: qs, rows: METRICS.map((m) => ({ id: m.id, name: m.name, family: m.family, cells: qs.map((x) => flags.get(`${x}|${m.id}`) ?? null) })) }
}

// ------------------------------------------------------------------ alerts

export async function getAlerts(orgId: string, q: DashboardQuery) {
  const ctx = await context(orgId)
  const v = parseView(ctx, q)
  const n = Math.min(Math.max(Number(q.n) || 8, 1), 12)
  const qs = trailingPeriods(v.quarter, n)
  const perQuarter = await Promise.all(qs.map((x) => alertsAt(ctx, x)))
  return { quarters: qs, alerts: perQuarter.flat(), settings: {} }
}

/** Exported for tests. */
export const _internal = { parseView, mixOf, readItems, health }
