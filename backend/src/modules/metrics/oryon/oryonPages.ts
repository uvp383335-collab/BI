/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Page-level Oryon metric views — a port of the page routes of the reference
 * Python app (`mrr_app/app.py`: mrr_page, retention_page, ... msp_page).
 * Each function takes the same query parameters as the Python page and
 * returns the same computed values the page renders (rows plus the headline
 * rows picked from them: latest / prev / year_ago / ttm ...). Row keys are
 * kept identical to the Python ones.
 */
import * as E from './engine'
import { OryonData } from './oryonData'
import { Dict, truthy, or, sum, sortedBy, pyRound } from './pyCompat'

export type Query = Record<string, string | undefined>

const pick = (q: Query, key: string, allowed: string[], dflt: string) => {
  const v = q[key] ?? dflt
  return allowed.includes(v) ? v : dflt
}
const lastOf = <T>(xs: T[]): T | null => (xs.length ? xs[xs.length - 1] : null)
const findLast = <T>(xs: T[], f: (x: T) => boolean): T | null => {
  for (let i = xs.length - 1; i >= 0; i--) if (f(xs[i])) return xs[i]
  return null
}
const yearAgoOf = (rows: Dict[], latest: Dict | null) => (latest ? rows.find((r) => r.month === E.addMonths(latest.month, -12)) ?? null : null)
const qLabel = (m: string) => `Q${Math.floor(Number(m.slice(5, 7)) / 3)}-${m.slice(0, 4)}`

/** latest complete row, and the row 12 months / 4 quarters before it (cogs/ga/ebitda/recurring pages) */
function latestPrev(rows: Dict[], grain: string): [Dict | null, Dict | null] {
  const latest = findLast(rows, (r) => truthy(r.complete))
  let prev: Dict | null = null
  if (latest) {
    const back = grain === 'month' ? 12 : 4
    const idx = rows.indexOf(latest)
    prev = idx - back >= 0 ? rows[idx - back] : null
  }
  return [latest, prev]
}

function cogsArgs(q: Query): [string, string] {
  return [pick(q, 'grain', ['month', 'quarter'], 'month'), pick(q, 'window', ['period', 'ttm'], 'period')]
}

// --------------------------------------------------------------------------- MRR
export function mrrPage(d: OryonData, q: Query = {}): Dict {
  const rows = d.calculate(q.from || null, q.to || null)
  return { rows, latest: lastOf(rows) }
}

// --------------------------------------------------------------------------- VC-01 / VC-02 retention
export function retentionRows(d: OryonData, grain: string, window: string, subOnly: boolean, from?: string | null, to?: string | null): Dict[] {
  const { native, isCad, settings, lastInvoice, reliableFrom } = d.retentionInputs()
  const rates = settings.fx_cad_usd
  const end = to || lastInvoice || ''
  const start = from || (reliableFrom && window === 'ttm' ? E.addMonths(reliableFrom, 12) : reliableFrom || settings.start_month)
  const rows: Dict[] = []
  for (const m1 of start && end ? E.periodEnds(start, end, grain) : []) {
    const m0 = E.windowStart(m1, grain, window)
    const r = E.retention(native, isCad, rates, m0, m1, subOnly)
    if (r) {
      r.reliable = truthy(reliableFrom) && m0 >= reliableFrom
      r.label = grain === 'quarter' ? `Q${Math.floor((Number(m1.slice(5, 7)) - 1) / 3) + 1}-${m1.slice(0, 4)}` : m1
      rows.push(r)
    }
  }
  return rows
}

export function retentionPage(d: OryonData, q: Query = {}): Dict {
  const grain = pick(q, 'grain', ['month', 'quarter'], 'quarter')
  const window = pick(q, 'window', ['ttm', 'period'], 'ttm')
  const rows = retentionRows(d, grain, window, (q.scope ?? 'all') === 'subscription', q.from, q.to)
  return { rows, latest: lastOf(rows) }
}

// --------------------------------------------------------------------------- VC-03 new logos
function newlogoPeriods(grain: string, start: string, end: string): string[] {
  const months = E.monthRange(start, end)
  if (grain === 'quarter') {
    const out: string[] = []
    for (const m of months) {
      const qq = E.quarterOf(m)
      if (!out.includes(qq)) out.push(qq)
    }
    return out
  }
  return months
}

/** new-logo ARR/count in the close months lo..hi (counted logos from first_valid_close on) */
export function newlogoWindow(logos: Dict[], info: Dict, lo: string, hi: string): Dict {
  const fvc = or(info.first_valid_close, '')
  const sel = logos.filter((l) => lo <= l.close_month && l.close_month <= hi && l.counted && l.close_month >= fvc)
  const seg: Dict = {}
  for (const s of E.SEGMENTS) {
    seg[s] = { arr: sum(sel.filter((l) => l.segment === s).map((l) => l.arr)), n: sel.filter((l) => l.segment === s).length }
  }
  return { lo, hi, arr: sum(sel.map((l) => l.arr)), n: sel.length, seg, full: lo >= fvc }
}

export function newlogoPage(d: OryonData, q: Query = {}): Dict {
  const grain = pick(q, 'grain', ['month', 'quarter'], 'quarter')
  const [logos, info] = d.newlogoInputs()
  let start: string = q.from || info.first_valid_close || d.settings().start_month
  if (grain === 'quarter' && !q.from) while (Number(start.slice(5, 7)) % 3 !== 1) start = E.addMonths(start, 1)
  const end = q.to || info.last_invoice || start
  const rows = E.summarizeNewLogos(logos.filter((l) => l.close_month >= or(info.first_valid_close, '')),
    newlogoPeriods(grain, start, end), grain, or(info.complete_until, ''))
  const cu = info.complete_until
  let ttm: Dict | null = null
  let prev: Dict | null = null
  if (cu) {
    ttm = newlogoWindow(logos, info, E.addMonths(cu, -11), cu)
    prev = newlogoWindow(logos, info, E.addMonths(cu, -23), E.addMonths(cu, -12))
  }
  return { rows, ttm, prev, info }
}

// --------------------------------------------------------------------------- VC-06 CAC
export function cacPage(d: OryonData, q: Query = {}): Dict {
  const rows = d.cacRows(q.from || null, q.to || null)
  const latest = findLast(rows, (r) => r.complete && truthy(r.cac))
  return { rows, q_rows: rows.filter((r) => Number(r.month.slice(5, 7)) % 3 === 0), latest, year_ago: yearAgoOf(rows, latest), info: { threshold: 18 } }
}

// --------------------------------------------------------------------------- VC-04 COGS %
export function cogsRows(d: OryonData, grain: string, window: string): Dict[] {
  const pl = d.pl()
  const [, lineMap, daIds] = d.cogsAccounts()
  return d.periods(grain, window).map((p) => Object.assign(E.cogsPeriod(pl, p.months, lineMap, daIds), p))
}

export function cogsPage(d: OryonData, q: Query = {}): Dict {
  const [grain, window] = cogsArgs(q)
  let rows = cogsRows(d, grain, window)
  if (window === 'ttm') rows = rows.filter((r) => r.complete)
  const [latest, prev] = latestPrev(rows, grain)
  return { rows, latest, prev }
}

// --------------------------------------------------------------------------- VC-09 G&A %
export function gaRows(d: OryonData, grain: string, window: string): Dict[] {
  const pl = d.pl()
  const [, gaIds] = d.gaAccounts()
  const [, lineMap] = d.cogsAccounts()
  return d.periods(grain, window).map((p) => Object.assign(E.gaPeriod(pl, p.months, gaIds, lineMap), p))
}

export function gaPage(d: OryonData, q: Query = {}): Dict {
  const [grain, window] = cogsArgs(q)
  let rows = gaRows(d, grain, window)
  if (window === 'ttm') rows = rows.filter((r) => r.complete)
  const [latest, prev] = latestPrev(rows, grain)
  const [accounts, gaIds] = d.gaAccounts()
  const names = Object.fromEntries(accounts.map((a) => [a.id, a.name]))
  const order = sortedBy(gaIds, (i) => [-sum(rows.map((r) => r.by_account[i]?.amount ?? 0))])
  const stacks = order.map((i) => ({ name: names[i], data: rows.map((r) => pyRound(r.by_account[i]?.amount ?? 0, 2)) }))
  return { rows, latest, prev, stacks }
}

// --------------------------------------------------------------------------- VC-10 EBITDA
export function ebitdaRows(d: OryonData, grain: string, window: string): Dict[] {
  const pl = d.pl()
  const [, catMap, daIds] = d.ebitdaAccounts()
  const plan = d.plan()
  return d.periods(grain, window).map((p) => Object.assign(E.ebitdaPeriod(pl, p.months, catMap, daIds, plan), p))
}

export function ebitdaPage(d: OryonData, q: Query = {}): Dict {
  let [grain, window] = cogsArgs(q)
  if (q.grain === undefined) grain = 'quarter'
  let rows = ebitdaRows(d, grain, window)
  if (window === 'ttm') rows = rows.filter((r) => r.complete)
  const [latest, prev] = latestPrev(rows, grain)
  return { rows, latest, prev }
}

// --------------------------------------------------------------------------- VC-07 / VC-14 LTV / CAC
export function ltvRows(d: OryonData, from?: string | null, to?: string | null): Dict[] {
  const settings = d.settings()
  const cap = Number(settings.ltv_cap_months ?? 84)
  const subOnly = settings.ltv_grr_scope === 'subscription'
  const cac = d.cacRows(from || null, to || null)
  const { native, isCad, reliableFrom } = d.retentionInputs()
  const [mrrUsd] = d.mrrUsd()
  return cac.map((r) => {
    const m0 = E.addMonths(r.month, -12)
    const g = E.retention(native, isCad, settings.fx_cad_usd, m0, r.month, subOnly)
    const row = E.ltvCacRow(r, g ? g.grr : null, cap)
    const vals = Array.from((mrrUsd.get(r.month) ?? new Map()).values()).map((v) => v.subscription + v.retainer)
    E.ltvBaseFields(row, 12 * sum(vals), vals.filter((v) => v > 0.005).length)
    row.grr_reliable = truthy(reliableFrom) && m0 >= reliableFrom
    row.complete = row.complete && row.grr_reliable
    return row
  })
}

export function ltvPage(d: OryonData, q: Query = {}): Dict {
  const rows = ltvRows(d, q.from, q.to)
  const grain = pick(q, 'grain', ['month', 'quarter'], 'quarter')
  const shown = rows.filter((r) => grain === 'month' || Number(r.month.slice(5, 7)) % 3 === 0)
  for (const r of shown) r.label = grain === 'quarter' ? qLabel(r.month) : r.month
  const latest = findLast(shown, (r) => r.complete && truthy(r.ltv_cac))
  const prev = latest ? shown.find((r) => r.month === E.addMonths(latest.month, -12)) ?? null : null
  const st = d.settings()
  return { rows: shown, latest, prev, info: { cap: Number(st.ltv_cap_months ?? 84), threshold: Number(st.ltv_threshold ?? 3) } }
}

// --------------------------------------------------------------------------- VC-12 recurring %
export function recurringRows(d: OryonData, grain: string, window: string): Dict[] {
  const [mrr] = d.mrrUsd()
  const pl = d.pl()
  const [, tagIds] = d.recurringAccounts()
  const [, lineMap] = d.cogsAccounts()
  const lastInvoice = d.lastInvoice()
  return d.periods(grain, window).map((p) => {
    const r = Object.assign(E.recurringPeriod(mrr, pl, p.months, lineMap, tagIds), p)
    r.complete = p.complete && truthy(lastInvoice) && p.months[p.months.length - 1] <= lastInvoice!
    return r
  })
}

export function recurringPage(d: OryonData, q: Query = {}): Dict {
  let [grain, window] = cogsArgs(q)
  if (q.grain === undefined) grain = 'quarter'
  let rows = recurringRows(d, grain, window)
  if (window === 'ttm') rows = rows.filter((r) => r.complete)
  const [latest, prev] = latestPrev(rows, grain)
  return { rows, latest, prev }
}

// --------------------------------------------------------------------------- VC-13 growth
export function growthRows(d: OryonData, grain: string, window: string): Dict[] {
  const [mrr] = d.mrrUsd()
  const pl = d.pl()
  const [, lineMap] = d.cogsAccounts()
  const plan = d.plan()
  const have = new Set(Array.from(pl.keys()).filter((m) => truthy(pl.get(m)!.revenue)))
  const lastInvoice = d.lastInvoice()
  const rows = d.periods(grain, window).map((p) => {
    const r = Object.assign(E.growthPeriod(mrr, pl, p.months, lineMap, plan), p)
    r.has_prior = r.prior.every((m: string) => have.has(m))
    r.complete = p.complete && r.has_prior && truthy(lastInvoice) && p.months[p.months.length - 1] <= lastInvoice!
    return r
  })
  const byLabel = new Map(rows.map((r) => [r.label, r]))
  for (const r of rows) {
    let prevLabel: string
    if (grain === 'quarter' && window === 'period') {
      const [qq, y] = r.label.split('-')
      prevLabel = `${qq}-${Number(y) - 1}`
    } else if (window === 'ttm') prevLabel = `TTM ${E.addMonths(r.end, -12)}`
    else prevLabel = E.addMonths(r.end, -12)
    const pr = byLabel.get(prevLabel)
    r.growth_ly = pr && pr.has_prior ? pr.growth : null
    r.growth_change = r.growth !== null && r.growth_ly !== null ? r.growth - r.growth_ly : null
  }
  return rows
}

export function growthPage(d: OryonData, q: Query = {}): Dict {
  let [grain, window] = cogsArgs(q)
  if (q.grain === undefined) grain = 'quarter'
  const rows = growthRows(d, grain, window).filter((r) => r.has_prior)
  return { rows, latest: findLast(rows, (r) => r.complete) }
}

// --------------------------------------------------------------------------- CB-05 cash
export function cashPage(d: OryonData, q: Query = {}): Dict {
  // copies: the label is set on the rows in place, like the Python page does
  const rows = d.cashInputs()[0].map((r) => ({ ...r }))
  const grain = pick(q, 'grain', ['month', 'quarter'], 'month')
  const shown = rows.filter((r) => !r.stale && (grain === 'month' || Number(r.month.slice(5, 7)) % 3 === 0))
  for (const r of shown) r.label = grain === 'quarter' ? qLabel(r.month) : r.month
  const latest = findLast(shown, (r) => r.closed) ?? lastOf(shown)
  return { rows: shown, latest, year_ago: yearAgoOf(rows, latest), stale: rows.filter((r) => r.stale).map((r) => r.month) }
}

// --------------------------------------------------------------------------- CB-07 FCF
export function fcfPage(d: OryonData, q: Query = {}): Dict {
  const rows = d.fcfInputs()
  const view = pick(q, 'view', ['ttm', 'month'], 'ttm')
  const shown = view === 'ttm' ? rows.filter((r) => r.ttm_ok) : rows
  const latest = lastOf(shown)
  const yearAgo = latest ? shown.find((r) => r.month === E.addMonths(latest.month, -12)) ?? null : null
  return {
    rows: shown.map((r) => {
      const { capex_lines: _omit, ...rest } = r
      return rest
    }),
    latest, year_ago: yearAgo
  }
}

// --------------------------------------------------------------------------- CB-10 CCC
export function cccPage(d: OryonData, q: Query = {}): Dict {
  const rows = d.cccInputs()
  const view = pick(q, 'view', ['quarter', 'month'], 'quarter')
  const shown = view === 'quarter' ? rows.filter((r) => r.quarter_end) : rows
  const latestQ = findLast(rows, (r) => r.quarter_end)
  return { rows: shown, latest: latestQ, year_ago: yearAgoOf(rows, latestQ) }
}

// --------------------------------------------------------------------------- CM-02 concentration / ER-05 diversification
const stripRanking = (rows: Dict[]) => rows.map((r) => {
  const { ranking: _r, window: _w, ...rest } = r
  return rest
})

export function concPage(d: OryonData, q: Query = {}): Dict {
  const line = q.line && q.line !== 'All' ? q.line : null
  const rows = d.concInputs(line)
  const latest = lastOf(rows)
  const byLine: Dict = {}
  if (line === null && latest) {
    for (const l of d.invoiceClasses()) {
      byLine[l] = d.concInputs(l).map((r) => ({ month: r.month, share: r.share, largest: r.largest, total: r.total, groups: r.groups }))
    }
  }
  return { rows: stripRanking(rows), latest, year_ago: yearAgoOf(rows, latest), by_line: byLine }
}

export function divPage(d: OryonData): Dict {
  const cfg = d.divSettings()
  const rows = d.concInputs(null, cfg.top_n)
  const latest = lastOf(rows)
  return {
    rows: stripRanking(rows), latest, year_ago: yearAgoOf(rows, latest),
    quarters: rows.filter((r) => Number(r.month.slice(5, 7)) % 3 === 0), cfg
  }
}

// --------------------------------------------------------------------------- CM-03 win rate
export async function wrPage(d: OryonData, q: Query = {}): Promise<Dict> {
  const view = pick(q, 'view', ['period', 'ttm'], 'period')
  const segment = q.segment && q.segment !== 'All' ? q.segment : null
  const stWindow = Math.trunc(Number(or(d.settings().wr_window_months, 6)))
  const [rows0, info] = await d.wrInputs(view === 'ttm' ? 12 : stWindow, segment)
  const grain = pick(q, 'grain', ['month', 'quarter'], 'month')
  let rows = rows0.filter((r) => r.month >= or(d.settings().start_month, '')).map((r) => {
    const m = Number(r.month.slice(5, 7))
    r.quarter_end = m % 3 === 0
    r.label = grain === 'quarter' && r.quarter_end ? `Q${Math.floor(m / 3)}-${r.month.slice(0, 4)}` : r.month
    return r
  })
  if (grain === 'quarter') rows = rows.filter((r) => r.quarter_end)
  const latest = lastOf(rows)
  return { rows, latest, year_ago: yearAgoOf(rows, latest), info }
}

// --------------------------------------------------------------------------- CM-06 funnel
export function fnPeriods(series: Dict[], grain: string, view: string, start: string): Dict[] {
  const by = new Map(series.map((r) => [r.month, r]))
  const out: Dict[] = []
  for (const r of series) {
    const m = r.month
    if (m < start || (grain === 'quarter' && Number(m.slice(5)) % 3)) continue
    const k = view === 'ttm' ? 12 : grain === 'quarter' ? 3 : 1
    const win: string[] = []
    for (let i = k - 1; i >= 0; i--) win.push(E.addMonths(m, -i))
    if (!win.every((w) => by.has(w))) continue
    const t = E.funnelRate(win.map((w) => by.get(w)!))
    Object.assign(t, { month: m, window: [win[0], win[win.length - 1]], label: grain === 'quarter' ? qLabel(m) : m })
    out.push(t)
  }
  return out
}

export async function fnPage(d: OryonData, q: Query = {}): Promise<Dict> {
  const grain = pick(q, 'grain', ['month', 'quarter'], 'month')
  const view = pick(q, 'view', ['period', 'ttm'], 'period')
  const [series, info] = await d.fnInputs()
  const rows = fnPeriods(series, grain, view, info.start)
  const latest = lastOf(rows)
  return { rows, latest, year_ago: yearAgoOf(rows, latest), info }
}

// --------------------------------------------------------------------------- CM-08 MQLs vs plan
export async function mqlPage(d: OryonData, q: Query = {}): Promise<Dict> {
  const grain = pick(q, 'grain', ['month', 'quarter'], 'month')
  const view = pick(q, 'view', ['period', 'ttm'], 'period')
  const [rows, info] = await d.mqlInputs(grain, view)
  const latest = findLast(rows, (r) => r.plan !== null) ?? lastOf(rows)
  return { rows, latest, year_ago: yearAgoOf(rows, latest), info }
}

// --------------------------------------------------------------------------- CM-07 marketing ROI / CM-05 marketing-sourced
function roiArgs(q: Query): [string, string] {
  return [pick(q, 'grain', ['month', 'quarter'], 'quarter'), pick(q, 'view', ['period', 'ttm'], 'period')]
}

export async function roiPage(d: OryonData, q: Query = {}): Promise<Dict> {
  const [grain, view] = roiArgs(q)
  const [series, cfg] = await d.roiInputs(grain, view)
  const latest = lastOf(series)
  return { rows: series, latest, year_ago: yearAgoOf(series, latest), cfg }
}

export async function mspPage(d: OryonData, q: Query = {}): Promise<Dict> {
  const [grain, view] = roiArgs(q)
  const [rows, cfg] = await d.mspInputs(grain, view)
  const latest = lastOf(rows)
  return { rows, latest, year_ago: yearAgoOf(rows, latest), cfg }
}

/**
 * Pages built only from invoice lines, so they can be limited to some QuickBooks products (`items`). Every other
 * page mixes in the P&L, Balance Sheet or CRM, which have no product breakdown.
 */
export const PRODUCT_PAGES = new Set(['mrr', 'retention', 'new_logos', 'concentration', 'diversification'])

export const PAGES: Record<string, (d: OryonData, q: Query) => Dict | Promise<Dict>> = {
  mrr: mrrPage,
  retention: retentionPage,
  new_logos: newlogoPage,
  cac: cacPage,
  cogs: cogsPage,
  ga: gaPage,
  ebitda: ebitdaPage,
  ltv: ltvPage,
  recurring: recurringPage,
  growth: growthPage,
  cash: cashPage,
  fcf: fcfPage,
  ccc: cccPage,
  concentration: concPage,
  diversification: divPage,
  win_rate: wrPage,
  funnel: fnPage,
  mql: mqlPage,
  roi: roiPage,
  msp: mspPage
}
