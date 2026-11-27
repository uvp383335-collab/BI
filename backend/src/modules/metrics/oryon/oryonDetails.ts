/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Drill-downs behind one row of an Oryon metric page — a port of the reference
 * Python app's detail routes (mrr_app/app.py: month_detail, retention_detail,
 * newlogo_detail, cac_detail, cogs_detail, ga_detail, ebitda_detail,
 * ltv_detail, recurring_detail, growth_detail, cash_detail, fcf_detail,
 * ccc_detail, conc_detail, wr_detail, fn_detail, roi_detail, msp_detail).
 * Same figures; customer names are added where the Python page only shows ids.
 */
import { AppError } from '../../../shared/utils/AppError'
import * as E from './engine'
import { OryonData } from './oryonData'
import * as P from './oryonPages'
import { Dict, or, pyStr, sortedBy, sum } from './pyCompat'

type Q = P.Query

/** "TTM 2026-09" | "Q3-2026" | "2026-Q3" | "2026-09" -> its months (Python period_months) */
export function periodMonths(period: string): string[] {
  if (period.startsWith('TTM ')) {
    const out: string[] = []
    for (let k = 11; k >= 0; k--) out.push(E.addMonths(period.slice(4), -k))
    return out
  }
  if (period.includes('Q')) {
    let [q, y] = period.split('-')
    if (!period.startsWith('Q')) [y, q] = [q, y]
    const n = Number(q.replace('Q', ''))
    return [1, 2, 3].map((k) => `${y}-${String(3 * (n - 1) + k).padStart(2, '0')}`)
  }
  return [period]
}

const customerName = (d: OryonData) => {
  const names = new Map(d.qboCustomers.map((c) => [pyStr(c.providerRecordId), (c.displayName as string) || '']))
  return (id: string) => names.get(id) || `Customer ${id}`
}
const need = (v: string | undefined, what: string): string => {
  if (!v) throw AppError.badRequest(`${what} is required`, 'ORYON_DETAIL_PARAM')
  return v
}
const notFound = (what: string): never => {
  throw AppError.notFound(`No ${what}`, 'ORYON_DETAIL_NOT_FOUND')
}

const DETAILS: Record<string, (d: OryonData, period: string, q: Q) => Dict | Promise<Dict>> = {
  mrr: (d, month) => {
    const [mrr, isCad] = d.mrrUsd()
    const name = customerName(d)
    const custs = Array.from((mrr.get(month) ?? new Map()).entries())
      .filter(([, v]) => v.subscription + v.retainer > 0.005)
      .map(([c, v]) => ({ customer: c, name: name(c), currency: isCad.get(c) ? 'CAD' : 'USD', subscription: v.subscription, retainer: v.retainer, total: v.subscription + v.retainer, arr: (v.subscription + v.retainer) * 12 }))
    const rows = sortedBy(custs, (x) => [-x.total])
    return { month, rows, total: sum(rows.map((r) => r.total)) }
  },

  retention: (d, m1, q) => {
    const grain = q.grain === 'month' ? 'month' : 'quarter'
    const window = q.window === 'period' ? 'period' : 'ttm'
    const { native, isCad, settings } = d.retentionInputs()
    const m0 = E.windowStart(m1, grain, window)
    const r = E.retention(native, isCad, settings.fx_cad_usd, m0, m1, q.scope === 'subscription', true) ?? notFound(`customers with MRR in ${m0}`)
    const name = customerName(d)
    r.customers = (r.customers as Dict[]).map((c): Dict => ({ ...c, name: name(c.customer) })).filter((c) => !q.bucket || c.bucket === q.bucket)
    return { ...r, rate: E.fxFor(m0, settings.fx_cad_usd) }
  },

  new_logos: (d, period) => {
    const grain = period.startsWith('Q') ? 'quarter' : 'month'
    const [logos] = d.newlogoInputs()
    const sel = sortedBy(logos.filter((l) => (grain === 'quarter' ? E.quarterOf(l.close_month) : l.close_month) === period), (l) => [l.close_month, -l.arr])
    const counted = sel.filter((l) => l.counted)
    return { period, logos: sel, total: sum(counted.map((l) => l.arr)), n: counted.length }
  },

  cac: (d, month) => {
    const { pl, accounts, ids, logos, info } = d.cacInputs() as { pl: E.PlTable; accounts: Dict[]; ids: Set<string>; logos: Dict[]; info: Dict }
    const r = E.cacSeries(pl, ids, logos, [month], info.first_valid_close, info.complete_until)[0]
    const window = E.monthRange(r.start, month)
    const names = new Map<string, Dict>(accounts.map((a) => [a.id, a]))
    const byAcc = new Map<string, Dict>()
    for (const m of window) {
      for (const [, aid, , amt] of pl.get(m)?.lines ?? []) {
        if (!ids.has(aid)) continue
        const a = byAcc.get(aid) ?? { name: names.get(aid)!.name, reason: names.get(aid)!.reason, months: {} as Dict, total: 0 }
        a.months[m] = (a.months[m] ?? 0) + amt
        a.total += amt
        byAcc.set(aid, a)
      }
    }
    const accRows = sortedBy(byAcc.values(), (a) => [or(E.accountNumber(a.name), 99999)])
    const monthTot = Object.fromEntries(window.map((m) => [m, sum(accRows.map((a) => a.months[m] ?? 0))]))
    const sel = sortedBy(logos.filter((l) => l.counted && r.start <= l.close_month && l.close_month <= month), (l) => [l.close_month, -l.arr])
    return { r, window, accounts: accRows, month_totals: monthTot, logos: sel }
  },

  cogs: (d, period) => {
    const pl = d.pl()
    const [, lineMap, daIds] = d.cogsAccounts()
    const months = periodMonths(period)
    const r = E.cogsPeriod(pl, months, lineMap, daIds)
    const by = new Map<string, Dict>()
    for (const m of months) {
      for (const [sec, aid, name, amt] of pl.get(m)?.rc_lines ?? []) {
        const a = by.get(aid) ?? { id: aid, name, section: sec, line: lineMap[aid] ?? 'Unassigned', da: daIds.has(aid), amount: 0 }
        a.amount += amt
        by.set(aid, a)
      }
    }
    return { period, months, r, accounts: sortedBy(by.values(), (a) => [a.section !== 'income', or(E.accountNumber(a.name), 99999), a.name]) }
  },

  ga: (d, period) => {
    const pl = d.pl()
    const [, gaIds] = d.gaAccounts()
    const [, lineMap] = d.cogsAccounts()
    const months = periodMonths(period)
    const r = E.gaPeriod(pl, months, gaIds, lineMap)
    const by = new Map<string, Dict>()
    for (const m of months) {
      for (const [, aid, name, amt] of pl.get(m)?.lines ?? []) {
        if (!gaIds.has(aid)) continue
        const a = by.get(aid) ?? { name, months: {} as Dict, total: 0 }
        a.months[m] = (a.months[m] ?? 0) + amt
        a.total += amt
        by.set(aid, a)
      }
    }
    const accRows = sortedBy(by.values(), (a) => [or(E.accountNumber(a.name), 99999)])
    return {
      period, months, r, accounts: accRows,
      month_totals: Object.fromEntries(months.map((m) => [m, sum(accRows.map((a) => a.months[m] ?? 0))])),
      month_revenue: Object.fromEntries(months.map((m) => [m, E.gaPeriod(pl, [m], gaIds, lineMap).revenue]))
    }
  },

  ebitda: (d, period) => {
    const pl = d.pl()
    const [, catMap, daIds] = d.ebitdaAccounts()
    const months = periodMonths(period)
    const r = E.ebitdaPeriod(pl, months, catMap, daIds, d.plan())
    const by = new Map<string, Dict>()
    for (const m of months) {
      const snap = pl.get(m)
      for (const [sec, aid, name, amt] of [...(snap?.rc_lines ?? []), ...(snap?.lines ?? [])]) {
        const a = by.get(aid) ?? { name, cat: catMap[aid] ?? 'exclude', da: daIds.has(aid), section: sec, amount: 0 }
        a.amount += amt
        by.set(aid, a)
      }
    }
    const order: Dict = { revenue: 0, cogs: 1, opex: 2, below: 3, exclude: 4 }
    return { period, months, r, categories: E.EBITDA_CATEGORIES, accounts: sortedBy(by.values(), (a) => [order[a.cat], or(E.accountNumber(a.name), 99999), a.name]) }
  },

  ltv: (d, month) => {
    const rows = P.ltvRows(d, month, month)
    if (!rows.length) notFound(`LTV/CAC for ${month}: it needs 12 months of P&L and new logos`)
    return { r: rows[0], cap: Number(d.settings().ltv_cap_months ?? 84), threshold: Number(d.settings().ltv_threshold ?? 3) }
  },

  recurring: (d, period) => {
    const [mrr] = d.mrrUsd()
    const pl = d.pl()
    const [, tagIds] = d.recurringAccounts()
    const [, lineMap] = d.cogsAccounts()
    const months = periodMonths(period)
    const r = E.recurringPeriod(mrr, pl, months, lineMap, tagIds)
    const perMonth = months.map((m) => ({ ...E.recurringPeriod(mrr, pl, [m], lineMap, tagIds), month: m }))
    const rev = new Map<string, Dict>()
    for (const m of months) {
      for (const [sec, aid, name, amt] of pl.get(m)?.rc_lines ?? []) {
        if (sec !== 'income' || lineMap[aid] === 'Exclude') continue
        const a = rev.get(aid) ?? { name, tagged: tagIds.has(aid), amount: 0 }
        a.amount += amt
        rev.set(aid, a)
      }
    }
    return { period, months, r, per_month: perMonth, accounts: sortedBy(rev.values(), (a) => [or(E.accountNumber(a.name), 99999)]) }
  },

  growth: (d, period) => {
    const [mrr] = d.mrrUsd()
    const pl = d.pl()
    const [, lineMap] = d.cogsAccounts()
    const plan = d.plan()
    const months = periodMonths(period)
    const r = E.growthPeriod(mrr, pl, months, lineMap, plan)
    const perMonth = months.map((m) => ({ ...E.growthPeriod(mrr, pl, [m], lineMap, plan), month: m }))
    const rev = new Map<string, Dict>()
    for (const [which, ms] of [['cur', months], ['old', r.prior]] as [string, string[]][]) {
      for (const m of ms) {
        for (const [sec, aid, name, amt] of pl.get(m)?.rc_lines ?? []) {
          if (sec !== 'income' || lineMap[aid] === 'Exclude') continue
          const a = rev.get(aid) ?? { name, cur: 0, old: 0 }
          a[which] += amt
          rev.set(aid, a)
        }
      }
    }
    const accounts = sortedBy(rev.values(), (a) => [or(E.accountNumber(a.name), 99999)])
      .map((a) => ({ ...a, change: a.cur - a.old, growth: a.old ? 100 * (a.cur / a.old - 1) : null }))
    return { period, months, r, per_month: perMonth, accounts }
  },

  cash: (d, month) => {
    const [rows, info] = d.cashInputs()
    const r = rows.find((x) => x.month === month) ?? notFound(`balance sheet snapshot for ${month}`)
    const back = rows.find((x) => x.month === E.addMonths(month, -info.lookback)) ?? null
    const [accs, , , restrictedIds] = d.cashAccounts()
    const chosen = new Set(accs.filter((a) => a.cat === 'unrestricted').map((a) => a.id))
    const snap = d.bsSnapshots.find((x) => x.month === month) ?? {}
    const accounts = ((snap.accounts ?? []) as Dict[])
      .filter((a) => a.section === 'BankAccounts' || chosen.has(pyStr(a.id)))
      .map((a) => ({ name: a.name, amount: Number(a.amount || 0), chosen: chosen.has(pyStr(a.id)), restricted: restrictedIds.has(pyStr(a.id)) }))
    const { raw: _raw, ...row } = r
    return { r: row, back: back ? { month: back.month, cash: back.cash } : null, lookback: info.lookback, accounts }
  },

  fcf: (d, month) => {
    const rows = d.fcfInputs()
    const r = rows.find((x) => x.month === month) ?? notFound(`FCF data for ${month}`)
    const by = new Map(rows.map((x) => [x.month, x]))
    const win = (r.window as string[]).filter((m) => by.has(m)).map((m) => by.get(m)!)
    const [capexAccs] = d.fcfCapexAccounts()
    const names = new Map(capexAccs.map((a) => [a.id, a.name]))
    const capexByAcct = new Map<string, number>()
    for (const x of win) for (const [i, v] of Object.entries(x.capex_lines as Dict)) capexByAcct.set(names.get(i) ?? i, (capexByAcct.get(names.get(i) ?? i) ?? 0) + (v as number))
    const strip = (x: Dict) => (({ capex_lines: _c, ...rest }) => rest)(x)
    return { r: strip(r), months: win.map(strip), capex_by_account: Array.from(capexByAcct.entries()).sort().map(([name, amount]) => ({ name, amount })) }
  },

  ccc: (d, month) => {
    const rows = d.cccInputs()
    const r = rows.find((x) => x.month === month) ?? notFound(`cash conversion cycle for ${month}`)
    const [, cccMap] = d.cccAccounts()
    const snap = d.bsSnapshots.find((x) => x.month === month) ?? {}
    const lines = r.mode === 'accounts'
      ? ((snap.accounts ?? []) as Dict[]).flatMap((a) => {
        const c = (cccMap ?? {})[pyStr(a.id)]
        return c === 'ar' || c === 'inventory' || c === 'ap' ? [{ cat: c, name: a.name, amount: Number(a.amount || 0) }] : []
      })
      : []
    return { r, lines, categories: E.CCC_CATEGORIES }
  },

  concentration: (d, month, q) => {
    const line = q.line && q.line !== 'All' ? q.line : null
    const n = q.n ? Number(q.n) : null
    const r = d.concInputs(line, Number.isFinite(n) ? n : null).find((x) => x.month === month) ?? notFound(`concentration figures for ${month}`)
    return { r }
  },

  diversification: (d, month) => {
    const r = d.concInputs(null, d.divSettings().top_n).find((x) => x.month === month) ?? notFound(`diversification figures for ${month}`)
    return { r }
  },

  win_rate: async (d, month, q) => {
    const page = await P.wrPage(d, { ...q, grain: 'month' })
    const r = page.rows.find((x: Dict) => x.month === month) ?? notFound(`win-rate figures for ${month}`)
    return { r, competitors: page.info.competitors, headline: page.info.headline }
  },

  funnel: async (d, month, q) => {
    const grain = q.grain === 'quarter' ? 'quarter' : 'month'
    const view = q.view === 'ttm' ? 'ttm' : 'period'
    const [series] = await d.fnInputs()
    const r = P.fnPeriods(series, grain, view, '0000').find((x) => x.month === month) ?? notFound(`funnel figures for ${month}`)
    return { r, months: series.filter((x) => r.window[0] <= x.month && x.month <= r.window[1]) }
  },

  mql: async (d, month, q) => {
    const page = await P.mqlPage(d, q)
    return { r: page.rows.find((x: Dict) => x.month === month) ?? notFound(`MQL figures for ${month}`) }
  },

  roi: async (d, month, q) => {
    const grain = q.grain === 'month' ? 'month' : 'quarter'
    const view = q.view === 'ttm' ? 'ttm' : 'period'
    const [series, cfg] = await d.roiInputs(grain, view)
    const r = series.find((x) => x.month === month) ?? notFound(`${grain} ending ${month}`)
    const deals = (await d.deals(cfg.provider, ['dealname', 'dealstage', 'type', 'accountName', 'amount', 'arr', 'leadSource', 'campaignName', 'dealCreatedAt', 'createdDate']))
    const rows = E.roiDealRows(deals, cfg.value_field, new Set(cfg.nb_types ?? []), new Set(cfg.mk_sources ?? []))
    const [lo, hi] = r.window
    const sel = sortedBy(rows.filter((x) => lo <= x.month && x.month <= hi), (x) => [-x.value, x.date])
      .map((x): Dict => ({ ...x, channels: (cfg.channels as Dict[]).filter((c) => E.roiChannelOf(x, c)).map((c) => c.name) }))
    const bySrc = new Map<string, [number, number]>()
    for (const x of sel) {
      const v = bySrc.get(x.source) ?? [0, 0]
      bySrc.set(x.source, [v[0] + 1, v[1] + x.value])
    }
    return { r, deals: sel, by_source: sortedBy(bySrc.entries(), (e) => [-e[1][1]]).map(([source, [n, value]]) => ({ source, n, value })) }
  },

  msp: async (d, month, q) => {
    const grain = q.grain === 'month' ? 'month' : 'quarter'
    const view = q.view === 'ttm' ? 'ttm' : 'period'
    const cfg = await d.mspConfig()
    const [rows] = await d.mspInputs(grain, view)
    const r = rows.find((x) => x.month === month) ?? notFound(`${grain} ending ${month}`)
    const deals = await d.deals(cfg.provider, ['dealname', 'dealstage', 'pipeline', 'type', 'accountId', 'accountName', 'amount', 'arr', 'leadSource', 'closedate', 'dealCreatedAt', 'createdDate'])
    const defs = await d.stageDefs(cfg.provider)
    const wonKeys = new Set(defs.filter((x) => x.isWon).map((x) => `${pyStr(x.pipeline)}::${pyStr(x.rawStage)}`))
    const closedKeys = new Set(defs.filter((x) => x.isClosed).map((x) => `${pyStr(x.pipeline)}::${pyStr(x.rawStage)}`))
    const [created, won] = E.mspRows(deals, cfg.value_field, new Set(cfg.nb_types ?? []), new Set(cfg.mk_sources ?? []),
      new Set((cfg.duplicates as Map<string, string>).keys()), (x) => E.dealOutcome(x, wonKeys, closedKeys), cfg.true_new)
    const [lo, hi] = r.window
    const [wlo, whi] = r.ttm_window
    const cd = sortedBy(created.filter((x) => lo <= x.month && x.month <= hi), (x) => [-x.value, x.date])
    const wd = sortedBy(won.filter((x) => wlo <= x.month && x.month <= whi), (x) => [-x.value, x.date])
    const bySrc = new Map<string, Dict>()
    for (const x of cd) {
      if (cfg.exclude_dups && x.dup) continue
      const k = x.source || '(none)'
      const v = bySrc.get(k) ?? { source: k, n: 0, value: 0, marketing: x.mk }
      v.n += 1
      v.value += x.value
      bySrc.set(k, v)
    }
    return { r, created: cd, won: wd, exclude_dups: cfg.exclude_dups, by_source: sortedBy(bySrc.values(), (v) => [-v.value]) }
  }
}

export async function getOryonDetail(d: OryonData, page: string, q: Q): Promise<Dict> {
  const fn = DETAILS[page]
  if (!fn) throw AppError.notFound(`No detail view for ${page}`, 'ORYON_DETAIL_NOT_FOUND')
  return fn(d, need(q.period, 'period'), q)
}
