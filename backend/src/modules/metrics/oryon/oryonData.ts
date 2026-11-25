/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Data access + settings + per-metric inputs for the Oryon metrics — a port of
 * the data/glue half of the reference Python app (`mrr_app/app.py`: load_*,
 * *_accounts, *_config, *_inputs). Reads the same tenant collections the
 * Python app reads, with the same filters and projections, including the
 * Python app's own settings collections (`mrr_settings`, `mrr_product_mapping`)
 * so a mapping saved there gives the same numbers here.
 */
import { Connection } from 'mongoose'
import { getTenantConnection } from '../../../database/tenantConnection'
import * as E from './engine'
import { Dict, truthy, or, pyStr, sortedBy, sortedStr } from './pyCompat'

export const CAC_THRESHOLD = 18
const BS_ROLLUPS = new Set(['TotalAssets', 'TotalLiabilitiesAndEquity', 'CurrentAssets', 'CurrentLiabilities', 'Liabilities'])
const PROVIDER = 'quickbooks'

const proj = (...keys: string[]): Dict => Object.fromEntries([['_id', 0], ...keys.map((k) => [k, 1])])

const lastOf = <T>(xs: T[]): T | undefined => xs[xs.length - 1]
const maxStr = (xs: Iterable<string>): string | null => {
  let best: string | null = null
  for (const x of xs) if (best === null || x > best) best = x
  return best
}
const minStr = (xs: Iterable<string>): string | null => {
  let best: string | null = null
  for (const x of xs) if (best === null || x < best) best = x
  return best
}
const utcMonth = (d = new Date()) => d.toISOString().slice(0, 7)
const utcDate = (d = new Date()) => d.toISOString().slice(0, 10)

/**
 * One snapshot of an org's data. Raw collections are loaded once per
 * instance (lazily); derived inputs are memoized on the instance too, so a
 * dashboard screen asking for many metrics/periods reuses them.
 */
export class OryonData {
  private memo = new Map<string, any>()
  constructor(private readonly conn: Connection) {}

  static async forOrg(orgId: string): Promise<OryonData> {
    return new OryonData(await getTenantConnection(orgId))
  }

  private once<T>(key: string, fn: () => T): T {
    if (!this.memo.has(key)) this.memo.set(key, fn())
    return this.memo.get(key)
  }

  private col(name: string) {
    return this.conn.db!.collection(name)
  }

  // ------------------------------------------------------------------ raw data
  load(): Promise<void> {
    return this.once('load', async () => {
      const [invoices, settingsDoc, products, savedMapping, qbo, sf, pl, bs] = await Promise.all([
        this.col('invoices').find({ provider: PROVIDER }, { projection: proj('customerRecordId', 'txnDate', 'billingAddress.country', 'lines.itemId', 'lines.amount', 'lines.className', 'totalAmount') }).toArray(),
        this.col('mrr_settings').findOne({ _id: 'settings' as any }),
        this.col('products').find({ provider: PROVIDER }, { projection: proj('providerRecordId', 'name', 'category', 'billingFrequency') }).toArray(),
        this.col('mrr_product_mapping').find({}, { projection: { _id: 0 } }).toArray(),
        this.col('quickbookscustomers').find({ provider: PROVIDER }, { projection: proj('providerRecordId', 'displayName', 'parentRecordId') }).toArray(),
        this.col('salesforceaccounts').find({ provider: 'salesforce' }, { projection: proj('providerRecordId', 'name', 'segment', 'parentRecordId', 'qboCustomerId') }).toArray(),
        this.col('plmonthlysnapshots').find({}, { projection: proj('month', 'income', 'cogs', 'expenses', 'otherExpenses') }).toArray(),
        this.col('balancesheetmonthlysnapshots').find({ provider: PROVIDER }, { projection: proj('month', 'asOfDate', 'sectionTotals', 'accounts') }).toArray()
      ])
      Object.assign(this.raw, { invoices, settingsDoc: settingsDoc ?? {}, products, savedMapping, qbo, sf, pl, bs })
    })
  }

  private raw: Dict = {}

  get invoices(): Dict[] { return this.raw.invoices }
  get qboCustomers(): Dict[] { return this.raw.qbo }
  get sfAccounts(): Dict[] { return this.raw.sf }
  get settingsDoc(): Dict { return this.raw.settingsDoc }
  get bsSnapshots(): Dict[] { return this.raw.bs }

  deals(provider: string, fields: string[]): Promise<Dict[]> {
    return this.once(`deals:${provider}:${fields.join(',')}`, () => this.col('deals').find({ provider }, { projection: proj(...fields) }).toArray())
  }
  stageDefs(provider: string, wonOnly = false): Promise<Dict[]> {
    const q: Dict = { provider, entityType: 'deal' }
    if (wonOnly) q.isWon = true
    return this.once(`defs:${provider}:${wonOnly}`, () => this.col('pipelinestagedefinitions').find(q, { projection: proj('pipeline', 'rawStage', 'isWon', 'isClosed') }).toArray())
  }
  contacts(provider: string): Promise<Dict[]> {
    return this.once(`contacts:${provider}`, () => this.col('contacts').find({ provider }, { projection: proj('providerRecordId', 'email', 'analyticsSource', 'leadCreatedAt', 'lifecycleStageHistory') }).toArray())
  }
  distinctProviders(collection: string): Promise<string[]> {
    return this.once(`distinct:${collection}`, async () => (await this.col(collection).distinct('provider')).filter((p: unknown) => truthy(p)) as string[])
  }

  // ------------------------------------------------------------------ settings
  /** load_settings(): defaults overlaid with the saved keys that exist in DEFAULT_SETTINGS. */
  settings(): Dict {
    return this.once('settings', () => {
      const s: Dict = { ...E.DEFAULT_SETTINGS }
      for (const k of Object.keys(E.DEFAULT_SETTINGS)) if (k in this.settingsDoc) s[k] = this.settingsDoc[k]
      return s
    })
  }

  /** product_catalog(invoices) */
  catalog(): Dict[] {
    return this.once('catalog', () => {
      const stats = new Map<string, Dict>()
      for (const inv of this.invoices) {
        const month = E.toDateStr(inv.txnDate).slice(0, 7)
        for (const line of (or(inv.lines, []) as Dict[])) {
          const item = String(or(line.itemId, ''))
          if (!item) continue
          let s = stats.get(item)
          if (!s) {
            s = { lines: 0, amount: 0.0, classes: new Set<string>(), first: month, last: month }
            stats.set(item, s)
          }
          s.lines += 1
          s.amount += Number(or(line.amount, 0))
          if (truthy(line.className)) s.classes.add(line.className)
          s.first = month < s.first ? month : s.first
          s.last = month > s.last ? month : s.last
        }
      }
      const products = new Map<string, Dict>()
      for (const p of this.raw.products as Dict[]) products.set(pyStr(p.providerRecordId), p)
      const saved = new Map<string, Dict>()
      for (const d of this.raw.savedMapping as Dict[]) saved.set(d.itemId, d)
      const ids = sortedBy(new Set([...stats.keys(), ...products.keys()]), (x) => [-(stats.get(x)?.amount ?? 0), x])
      return ids.map((item) => {
        const p = products.get(item) ?? {}
        const name = or(p.name, `Item ${item}`)
        const [auto, reason] = E.suggestMapping(name, p.category, p.billingFrequency)
        const s = stats.get(item) ?? { lines: 0, amount: 0.0, classes: new Set(), first: '', last: '' }
        return {
          itemId: item, name, category: or(p.category, '-'), frequency: or(p.billingFrequency, ''),
          lines: s.lines, amount: s.amount, classes: sortedStr(s.classes).join(', ') || '-',
          first: s.first, last: s.last, auto, reason,
          mapping: saved.get(item)?.type ?? auto, saved: saved.has(item)
        }
      })
    })
  }

  mapping(): Dict {
    return this.once('mapping', () => Object.fromEntries(this.catalog().map((p) => [p.itemId, p.mapping])))
  }

  unsaved(): number {
    return this.catalog().filter((p) => !p.saved).length
  }

  mrrUsd(): [E.MrrTable, Map<string, boolean>] {
    return this.once('mrr', () => E.computeMrr(this.invoices, this.mapping(), this.settings()))
  }

  nativeMrr(): [E.MrrTable, Map<string, boolean>] {
    return this.once('native', () => E.computeNativeMrr(this.invoices, this.mapping(), this.settings()))
  }

  lastInvoice(): string | null {
    return this.once('lastInvoice', () => maxStr(this.invoices.filter((i) => truthy(i.txnDate)).map((i) => E.toDateStr(i.txnDate).slice(0, 7))))
  }

  /** calculate(start, end) */
  calculate(start?: string | null, end?: string | null): Dict[] {
    const [mrr] = this.mrrUsd()
    const settings = this.settings()
    const monthsWithData = sortedStr(Array.from(mrr.keys()).filter((m) => mrr.get(m)!.size > 0))
    const s = start || settings.start_month
    const e = end || this.lastInvoice() || (monthsWithData.length ? lastOf(monthsWithData)! : s)
    return s <= e ? E.summarize(mrr, E.monthRange(s, e)) : []
  }

  // ------------------------------------------------------------------ retention
  retentionInputs(): Dict {
    return this.once('retention', () => {
      const [native, isCad] = this.nativeMrr()
      const mrrMonths = sortedStr(Array.from(native.keys()).filter((m) => Array.from(native.get(m)!.values()).some((v) => v.subscription + v.retainer > 0.005)))
      const reliableFrom = mrrMonths.length ? E.addMonths(mrrMonths[0], 11) : null
      return { native, isCad, settings: this.settings(), lastInvoice: this.lastInvoice(), reliableFrom }
    })
  }

  // ------------------------------------------------------------------ new logos
  links(): Map<string, Dict> {
    return this.once('links', () => E.linkCustomers(this.qboCustomers, this.sfAccounts))
  }

  newlogoInputs(): [Dict[], Dict] {
    return this.once('newlogos', () => {
      const settings = this.settings()
      const [mrr] = this.mrrUsd()
      const links = this.links()
      const lag = Math.trunc(Number(settings.newlogo_lag_months ?? 1))
      const logos = E.newLogos(mrr, links, lag, truthy(settings.newlogo_group_parent))
      const mrrMonths = sortedStr(Array.from(mrr.keys()).filter((m) => Array.from(mrr.get(m)!.values()).some((v) => v.subscription + v.retainer > 0.005)))
      const lastInvoice = this.lastInvoice()
      const firstValidBilling = mrrMonths.length ? E.addMonths(mrrMonths[0], 12) : null
      const firstValidClose = firstValidBilling ? E.addMonths(firstValidBilling, -lag) : null
      const completeUntil = lastInvoice ? E.addMonths(lastInvoice, -lag) : null
      const withMrr = new Set(logos.map((l) => l.customer))
      const linked = Array.from(withMrr).filter((c) => truthy((links.get(c) ?? {}).account)).length
      const info = {
        lag, group_parent: truthy(settings.newlogo_group_parent), first_valid_close: firstValidClose,
        complete_until: completeUntil, last_invoice: lastInvoice, customers: withMrr.size, linked,
        n_qbo: this.qboCustomers.length, n_sf: this.sfAccounts.length, unsaved: this.unsaved()
      }
      return [logos, info]
    })
  }

  // ------------------------------------------------------------------ P&L
  pl(): E.PlTable {
    return this.once('pl', () => E.plByMonth(this.raw.pl))
  }

  private last12(pl: E.PlTable): Set<string> {
    return new Set(sortedStr(Array.from(pl.keys()).filter((m) => truthy(pl.get(m)!.revenue))).slice(-12))
  }

  private accountRows(pl: E.PlTable, which: 'lines' | 'rc_lines' | 'both', withFirstLast: boolean): Map<string, Dict> {
    const acc = new Map<string, Dict>()
    const last12 = this.last12(pl)
    for (const m of sortedStr(pl.keys())) {
      const p = pl.get(m)!
      const lines = which === 'lines' ? p.lines : which === 'rc_lines' ? p.rc_lines : [...p.rc_lines, ...p.lines]
      for (const [sec, aid, name, amt] of lines) {
        let a = acc.get(aid)
        if (!a) {
          a = withFirstLast ? { id: aid, name, section: sec, total: 0.0, ttm: 0.0, first: m, last: m } : { id: aid, name, section: sec, total: 0.0, ttm: 0.0 }
          acc.set(aid, a)
        }
        a.name = or(name, a.name)
        if (withFirstLast) a.last = m
        a.total += amt
        if (last12.has(m)) a.ttm += amt
      }
    }
    return acc
  }

  cacAccounts(): [Dict[], boolean] {
    return this.once('cacAccounts', () => {
      const savedIds: string[] | null | undefined = this.settingsDoc.cac_account_ids
      const acc = this.accountRows(this.pl(), 'lines', true)
      const numbered = Array.from(acc.values()).some((a) => truthy(E.accountNumber(a.name)))
      for (const a of acc.values()) {
        ;[a.auto, a.reason] = E.suggestCacAccount(a.name, a.section, numbered)
        a.selected = savedIds !== null && savedIds !== undefined ? savedIds.includes(a.id) : a.auto
      }
      const rows = sortedBy(acc.values(), (a) => [a.section !== 'expenses', or(E.accountNumber(a.name), 99999), a.name])
      return [rows, savedIds !== null && savedIds !== undefined]
    })
  }

  cacInputs(): Dict {
    return this.once('cacInputs', () => {
      const pl = this.pl()
      const [accounts, saved] = this.cacAccounts()
      const ids = new Set<string>(accounts.filter((a) => a.selected).map((a) => a.id))
      const [logos, info0] = this.newlogoInputs()
      const monthsWithPl = sortedStr(Array.from(pl.keys()).filter((m) => truthy(pl.get(m)!.revenue)))
      const info = {
        ...info0, pl_first: monthsWithPl[0] ?? null, pl_last: lastOf(monthsWithPl) ?? null,
        n_selected: ids.size, accounts_saved: saved, threshold: CAC_THRESHOLD
      }
      return { pl, accounts, ids, logos, info }
    })
  }

  cacRows(start?: string | null, end?: string | null): Dict[] {
    const { pl, ids, logos, info } = this.cacInputs()
    if (!info.pl_first) return []
    const first = E.addMonths(maxStr([info.pl_first, or(info.first_valid_close, info.pl_first)])!, 11)
    const s = maxStr([start || first, first])!
    const e = end || info.pl_last
    return E.cacSeries(pl, ids, logos, E.monthRange(s, e), info.first_valid_close, info.complete_until)
  }

  cogsAccounts(): [Dict[], Dict, Set<string>, boolean] {
    return this.once('cogsAccounts', () => {
      const savedMap: Dict | null | undefined = this.settingsDoc.cogs_account_map
      const savedDa: string[] | null | undefined = this.settingsDoc.cogs_da_ids
      const acc = this.accountRows(this.pl(), 'rc_lines', true)
      const numbered = Array.from(acc.values()).some((a) => truthy(E.accountNumber(a.name)))
      for (const a of acc.values()) {
        ;[a.auto, a.reason] = E.suggestCogsLine(a.name, a.section, numbered)
        a.auto_da = E.suggestCogsDa(a.name, a.section)
        a.line = savedMap !== null && savedMap !== undefined ? (savedMap[a.id] ?? a.auto) : a.auto
        a.da = savedDa !== null && savedDa !== undefined ? savedDa.includes(a.id) : a.auto_da
      }
      const rows = sortedBy(acc.values(), (a) => [a.section !== 'income', or(E.accountNumber(a.name), 99999), a.name])
      return [rows, Object.fromEntries(rows.map((a) => [a.id, a.line])), new Set(rows.filter((a) => a.da).map((a) => a.id)), savedMap !== null && savedMap !== undefined]
    })
  }

  /** cogs_periods(pl, grain, window) */
  periods(grain: string, window: string): Dict[] {
    const pl = this.pl()
    const months = sortedStr(Array.from(pl.keys()).filter((m) => truthy(pl.get(m)!.revenue)))
    if (!months.length) return []
    const monthSet = new Set(months)
    let ends: string[]
    if (grain === 'quarter') {
      ends = months.filter((m) => Number(m.slice(5, 7)) % 3 === 0)
      if (!ends.includes(lastOf(months)!)) ends.push(lastOf(months)!)
    } else ends = months
    return ends.map((e) => {
      let ms: string[], label: string
      if (window === 'ttm') {
        ms = []
        for (let k = 11; k >= 0; k--) ms.push(E.addMonths(e, -k))
        label = `TTM ${e}`
      } else if (grain === 'quarter') {
        ms = [2, 1, 0].map((k) => E.addMonths(e, -k))
        label = E.quarterOf(e)
      } else {
        ms = [e]
        label = e
      }
      return { label, end: e, months: ms, complete: ms.every((m) => monthSet.has(m)) }
    })
  }

  gaAccounts(): [Dict[], Set<string>, boolean] {
    return this.once('gaAccounts', () => {
      const savedIds: string[] | null | undefined = this.settingsDoc.ga_account_ids
      const acc = this.accountRows(this.pl(), 'lines', true)
      const numbered = Array.from(acc.values()).some((a) => truthy(E.accountNumber(a.name)))
      for (const a of acc.values()) {
        ;[a.auto, a.reason] = E.suggestGaAccount(a.name, a.section, numbered)
        a.selected = savedIds !== null && savedIds !== undefined ? savedIds.includes(a.id) : a.auto
      }
      const rows = sortedBy(acc.values(), (a) => [!a.selected, a.section !== 'expenses', or(E.accountNumber(a.name), 99999), a.name])
      return [rows, new Set(rows.filter((a) => a.selected).map((a) => a.id)), savedIds !== null && savedIds !== undefined]
    })
  }

  ebitdaAccounts(): [Dict[], Dict, Set<string>, boolean] {
    return this.once('ebitdaAccounts', () => {
      const savedMap: Dict | null | undefined = this.settingsDoc.ebitda_account_map
      const savedDa: string[] | null | undefined = this.settingsDoc.ebitda_da_ids
      const acc = this.accountRows(this.pl(), 'both', false)
      const numbered = Array.from(acc.values()).some((a) => truthy(E.accountNumber(a.name)))
      for (const a of acc.values()) {
        ;[a.auto, a.auto_da, a.reason] = E.suggestEbitdaAccount(a.name, a.section, numbered)
        a.cat = savedMap !== null && savedMap !== undefined ? (savedMap[a.id] ?? a.auto) : a.auto
        a.da = savedDa !== null && savedDa !== undefined ? savedDa.includes(a.id) : a.auto_da
      }
      const order: Dict = { income: 0, cogs: 1, expenses: 2, otherExpenses: 3 }
      const rows = sortedBy(acc.values(), (a) => [a.cat === 'exclude', order[a.section] ?? 9, or(E.accountNumber(a.name), 99999), a.name])
      return [rows, Object.fromEntries(rows.map((a) => [a.id, a.cat])), new Set(rows.filter((a) => a.da).map((a) => a.id)), savedMap !== null && savedMap !== undefined]
    })
  }

  plan(): Dict {
    return this.once('plan', () => {
      const out: Dict = {}
      for (const [m, v] of Object.entries((or(this.settingsDoc.ebitda_plan, {}) as Dict))) out[m] = Array.from(v as number[])
      return out
    })
  }

  recurringAccounts(): [Dict[], Set<string>, boolean] {
    return this.once('recurringAccounts', () => {
      const saved: string[] | null | undefined = this.settingsDoc.recurring_tag_ids
      const [, lineMap] = this.cogsAccounts()
      const pl = this.pl()
      const last12 = this.last12(pl)
      const acc = new Map<string, Dict>()
      for (const m of sortedStr(pl.keys())) {
        for (const [sec, aid, name, amt] of pl.get(m)!.rc_lines) {
          if (sec !== 'income') continue
          let a = acc.get(aid)
          if (!a) {
            a = { id: aid, name, total: 0.0, ttm: 0.0 }
            acc.set(aid, a)
          }
          a.name = or(name, a.name)
          a.total += amt
          if (last12.has(m)) a.ttm += amt
        }
      }
      for (const a of acc.values()) {
        ;[a.auto, a.reason] = E.suggestRecurringTag(a.name, 'income')
        a.selected = saved !== null && saved !== undefined ? saved.includes(a.id) : a.auto
        a.in_revenue = lineMap[a.id] !== 'Exclude'
      }
      const rows = sortedBy(acc.values(), (a) => [!a.in_revenue, or(E.accountNumber(a.name), 99999), a.name])
      return [rows, new Set(rows.filter((a) => a.selected).map((a) => a.id)), saved !== null && saved !== undefined]
    })
  }

  lastClosedPl(): string | null {
    const pl = this.pl()
    return maxStr(Array.from(pl.keys()).filter((m) => truthy(pl.get(m)!.revenue)))
  }

  // ------------------------------------------------------------------ balance sheet
  cashAccounts(): [Dict[], Set<string> | null, boolean, Set<string>] {
    return this.once('cashAccounts', () => {
      const accs = E.bsAccounts(this.bsSnapshots).filter((a) => a.section === 'BankAccounts')
      if (!accs.length) return [[], null, false, new Set<string>()]
      const st = this.settings()
      const saved: Dict | null | undefined = st.cash_account_map
      const legacy: string[] | null | undefined = st.cash_account_ids
      const named = accs.some((a) => truthy(E.accountNumber(a.name)) || !['checking', 'savings'].includes(a.name.trim().toLowerCase()))
      for (const a of accs) {
        ;[a.auto, a.reason] = E.suggestCashCategory(a.name, a.section, named)
        if (saved !== null && saved !== undefined) a.cat = saved[a.id] ?? a.auto
        else if (legacy !== null && legacy !== undefined) a.cat = legacy.includes(a.id) ? 'unrestricted' : a.auto === 'restricted' ? 'restricted' : 'exclude'
        else a.cat = a.auto
        a.selected = a.cat === 'unrestricted'
      }
      const order: Dict = { unrestricted: 0, restricted: 1, exclude: 2 }
      const sorted = sortedBy(accs, (a) => [order[a.cat], or(E.accountNumber(a.name), 99999), a.name])
      return [sorted, new Set(sorted.filter((a) => a.cat === 'unrestricted').map((a) => a.id)),
        (saved !== null && saved !== undefined) || (legacy !== null && legacy !== undefined),
        new Set(sorted.filter((a) => a.cat === 'restricted').map((a) => a.id))]
    })
  }

  cashInputs(): [Dict[], Dict] {
    return this.once('cashInputs', () => {
      const settings = this.settings()
      const snaps = this.bsSnapshots
      const sections: string[] = or(settings.cash_sections, ['BankAccounts'])
      const lookback = Math.trunc(Number(or(settings.cash_lookback_months, 3)))
      const lastClosed = this.lastClosedPl()
      const [accounts, ids, accountsSaved, restrictedIds] = this.cashAccounts()
      const adjust = Number(or(settings.cash_restricted_adjust, 0))
      const rows = E.cashSeries(snaps, sections, lookback, lastClosed, ids, adjust, restrictedIds)
      const info = {
        sections, lookback, last_closed: lastClosed, mode: ids !== null ? 'accounts' : 'sections', adjust,
        accounts_saved: accountsSaved, chosen: accounts.filter((a) => a.cat === 'unrestricted')
      }
      return [rows, info]
    })
  }

  fcfCapexAccounts(): [Dict[], Set<string> | null, boolean] {
    const accs = E.capexAccounts(this.bsSnapshots)
    if (!accs.length) return [[], null, false]
    const saved: Dict | null | undefined = this.settings().fcf_capex_map
    const numbered = accs.some((a) => truthy(E.accountNumber(a.name)))
    for (const a of accs) {
      ;[a.auto, a.reason] = E.suggestCapexCategory(a.name, a.section, numbered)
      a.cat = saved !== null && saved !== undefined ? (saved[a.id] ?? a.auto) : a.auto
    }
    const order: Dict = { capex: 0, accum: 1, exclude: 2 }
    const sorted = sortedBy(accs, (a) => [order[a.cat], a.section !== 'FixedAssets', or(E.accountNumber(a.name), 99999), a.name])
    return [sorted, new Set(sorted.filter((a) => a.cat === 'capex').map((a) => a.id)), saved !== null && saved !== undefined]
  }

  fcfWcAccounts(): [Dict[], Dict | null, boolean] {
    const accs = E.bsAccounts(this.bsSnapshots).filter((a) => E.WC_SECTIONS.includes(a.section))
    if (!accs.length) return [[], null, false]
    const saved: Dict | null | undefined = this.settings().fcf_wc_map
    for (const a of accs) {
      ;[a.auto, a.reason] = E.suggestWcCategory(a.name, a.section)
      a.cat = saved !== null && saved !== undefined ? (saved[a.id] ?? a.auto) : a.auto
    }
    const order = Object.fromEntries(Object.keys(E.WC_CATEGORIES).map((k, i) => [k, i]))
    const sorted = sortedBy(accs, (a) => [order[a.cat], or(E.accountNumber(a.name), 99999), a.name])
    return [sorted, Object.fromEntries(sorted.map((a) => [a.id, a.cat])), saved !== null && saved !== undefined]
  }

  fcfFaDaAccounts(ebAccs: Dict[]): [Dict[], Set<string>] {
    const saved: string[] | null | undefined = this.settings().fcf_fa_da_ids
    const rows = ebAccs.filter((a) => a.da && (a.cat === 'cogs' || a.cat === 'opex')).map((a) => ({ ...a }))
    for (const a of rows) {
      a.auto_fa = E.suggestFaDa(a.name)
      a.fa = saved !== null && saved !== undefined ? saved.includes(a.id) : a.auto_fa
    }
    return [rows, new Set(rows.filter((a) => a.fa).map((a) => a.id))]
  }

  fcfInputs(): Dict[] {
    return this.once('fcfInputs', () => {
      const st = this.settings()
      const [ebAccs, catMap, daIds] = this.ebitdaAccounts()
      const [, capexIds] = this.fcfCapexAccounts()
      const [, faDaIds] = this.fcfFaDaAccounts(ebAccs)
      const sections: string[] = or(st.fcf_capex_sections, ['FixedAssets'])
      const [, wcMap] = this.fcfWcAccounts()
      const wcSec: Dict = or(st.fcf_wc_section_map, E.DEFAULT_SETTINGS.fcf_wc_section_map)
      return E.fcfSeries(this.pl(), this.bsSnapshots, catMap, daIds, this.lastClosedPl(), capexIds, sections, faDaIds, wcMap, wcSec)
    })
  }

  cccAccounts(): [Dict[], Dict | null, boolean] {
    const accs = E.bsAccounts(this.bsSnapshots).filter((a) => E.CCC_SECTIONS.includes(a.section))
    if (!accs.length) return [[], null, false]
    const saved: Dict | null | undefined = this.settings().ccc_account_map
    for (const a of accs) {
      ;[a.auto, a.reason] = E.suggestCccCategory(a.name, a.section)
      a.cat = saved !== null && saved !== undefined ? (saved[a.id] ?? a.auto) : a.auto
    }
    const order = Object.fromEntries(Object.keys(E.CCC_CATEGORIES).map((k, i) => [k, i]))
    const sorted = sortedBy(accs, (a) => [order[a.cat], or(E.accountNumber(a.name), 99999), a.name])
    return [sorted, Object.fromEntries(sorted.map((a) => [a.id, a.cat])), saved !== null && saved !== undefined]
  }

  cccInputs(): Dict[] {
    return this.once('cccInputs', () => {
      const st = this.settings()
      const [, catMap, daIds] = this.ebitdaAccounts()
      const [, cccMap] = this.cccAccounts()
      const secMap: Dict = or(st.ccc_section_map, E.DEFAULT_SETTINGS.ccc_section_map)
      const includeDa = truthy(st.ccc_cogs_include_da ?? true)
      return E.cccSeries(this.pl(), this.bsSnapshots, catMap, daIds, this.lastClosedPl(), cccMap, secMap, includeDa)
    })
  }

  // ------------------------------------------------------------------ concentration
  invoiceClasses(): string[] {
    return this.once('classes', () => E.invoiceClasses(this.invoices))
  }

  concInputs(line: string | null = null, topN: number | null = null): Dict[] {
    const st = this.settings()
    const groupParent = truthy(st.conc_group_parent ?? true)
    const groups = this.once(`groups:${groupParent}`, () => E.customerGroups(this.qboCustomers, this.sfAccounts, this.links(), groupParent))
    const n = Math.max(1, Math.trunc(Number(or(or(topN, st.conc_top_n), 10))))
    return this.once(`conc:${line}:${n}`, () =>
      E.concentrationSeries(this.invoices, this.mapping(), st, groups, n, line).filter((r) => r.month >= or(st.start_month, '')))
  }

  divSettings(): Dict {
    const st = this.settings()
    let n = Math.trunc(Number(or(st.div_top_n, 5)))
    if (!Number.isFinite(n)) n = 5
    n = Math.max(1, Math.min(100, n))
    return { top_n: n, threshold: Number(or(st.div_threshold, 0)), group_parent: truthy(st.conc_group_parent ?? true) }
  }

  // ------------------------------------------------------------------ win rate
  async wrConfig(): Promise<Dict> {
    const st = this.settings()
    const provider = or(st.wr_provider, 'salesforce')
    const deals = await this.deals(provider, WR_FIELDS)
    const labels = new Map<string, number>()
    const types = new Map<string, number>()
    let hasStd = false, hasMulti = false
    for (const d of deals) {
      for (const f of (or(d.customFields, []) as Dict[])) if (truthy(f.label)) labels.set(f.label, (labels.get(f.label) ?? 0) + 1)
      const t = String(or(d.type, ''))
      types.set(t, (types.get(t) ?? 0) + 1)
      hasStd = hasStd || truthy(d.competitor)
      hasMulti = hasMulti || truthy(d.competitors)
    }
    const labelList = sortedBy(labels.keys(), (l) => [-labels.get(l)!, l])
    const typeList = sortedBy(Array.from(types.keys()).filter((t) => t), (t) => [-types.get(t)!, t])
    const autoComp = E.suggestCompetitorField(labelList, hasStd, hasMulti)
    const autoLoss = E.suggestLossReasonField(labelList)
    const autoTypes = E.suggestNewBusinessTypes(typeList)
    return {
      provider, n_deals: deals.length,
      comp_field: or(st.wr_competitor_field, autoComp),
      loss_field: or(st.wr_loss_reason_field !== null && st.wr_loss_reason_field !== undefined ? st.wr_loss_reason_field : autoLoss, null),
      exclude_reasons: or(st.wr_exclude_loss_reasons, []),
      nb_types: st.wr_new_business_types !== null && st.wr_new_business_types !== undefined ? st.wr_new_business_types : autoTypes,
      headline: st.wr_headline, window: Math.trunc(Number(or(st.wr_window_months, 6)))
    }
  }

  async wrInputs(window: number | null = null, segment: string | null = null): Promise<[Dict[], Dict]> {
    const cfg = await this.wrConfig()
    const deals = await this.deals(cfg.provider, WR_FIELDS)
    const defs = await this.stageDefs(cfg.provider)
    const wonKeys = new Set(defs.filter((x) => truthy(x.isWon)).map((x) => `${pyStr(x.pipeline)}::${pyStr(x.rawStage)}`))
    const closedKeys = new Set(defs.filter((x) => truthy(x.isClosed)).map((x) => `${pyStr(x.pipeline)}::${pyStr(x.rawStage)}`))
    const seg = new Map<string, unknown>()
    if (segment) for (const a of this.sfAccounts) seg.set(pyStr(a.providerRecordId), a.segment)
    let [rows, comps] = E.winRateSeries(deals, cfg.comp_field, cfg.loss_field, cfg.exclude_reasons,
      new Set(or(cfg.nb_types, []) as string[]), wonKeys, closedKeys, window || cfg.window,
      (d) => seg.get(pyStr(d.accountId)), segment)
    const thisMonth = utcMonth()
    rows = rows.filter((r) => r.month < thisMonth)
    const headline = comps.includes(cfg.headline) ? cfg.headline : comps.includes('Verdance FSM') ? 'Verdance FSM' : comps[0] ?? null
    return [rows, { ...cfg, competitors: comps, headline, stage_defs: defs.length > 0 }]
  }

  // ------------------------------------------------------------------ funnel
  async fnConfig(): Promise<Dict> {
    const st = this.settings()
    const provider = or(st.fn_provider, 'hubspot')
    const contacts = await this.contacts(provider)
    const sources = new Map<string, number>()
    for (const c of contacts) {
      const s = String(or(c.analyticsSource, ''))
      sources.set(s, (sources.get(s) ?? 0) + 1)
    }
    const srcList = sortedBy(Array.from(sources.keys()).filter((x) => x), (x) => [-sources.get(x)!, x])
    const autoMkt = E.suggestMarketingSources(srcList)
    const defaults = [60, 90, 180, 60, 180]
    const md0: number[] = Array.from(or(st.fn_mature_days, defaults) as number[])
    const md = [...md0, ...defaults.slice(md0.length)].slice(0, 5)
    return {
      provider, n: contacts.length,
      lead_stage: or(st.fn_lead_stage, 'lead'), mql_stage: or(st.fn_mql_stage, 'marketingqualifiedlead'),
      sql_stage: or(st.fn_sql_stage, 'salesqualifiedlead'), opp_stage: or(st.fn_opp_stage, 'opportunity'),
      sql_via_mql: truthy(st.fn_sql_via_mql ?? true),
      marketing: st.fn_marketing_sources !== null && st.fn_marketing_sources !== undefined ? st.fn_marketing_sources : autoMkt,
      dedupe: truthy(st.fn_dedupe_email ?? true), mature: md.map((x) => Math.trunc(Number(x)))
    }
  }

  async fnInputs(): Promise<[Dict[], Dict]> {
    const cfg = await this.fnConfig()
    const contacts = await this.contacts(cfg.provider)
    const defs = await this.stageDefs(cfg.provider, true)
    const wonKeys = new Set(defs.map((x) => `${pyStr(x.pipeline)}::${pyStr(x.rawStage)}`))
    const wonIds = new Set<string>()
    for (const d of await this.deals(cfg.provider, ['pipeline', 'dealstage', 'contactIds'])) {
      const stage = String(or(d.dealstage, ''))
      const won = wonKeys.size ? wonKeys.has(`${pyStr(d.pipeline)}::${stage}`) : ['closedwon', 'won'].includes(stage.replace(/ /g, '').toLowerCase())
      if (won) for (const i of (or(d.contactIds, []) as unknown[])) wonIds.add(pyStr(i))
    }
    const rows = E.funnelContacts(contacts, cfg.lead_stage, cfg.mql_stage, cfg.sql_stage, wonIds, cfg.opp_stage)
    const today = utcDate()
    let last = E.addMonths(today.slice(0, 7), -1)
    const dataLast = maxStr(rows.filter((r) => r.created).map((r) => r.created.slice(0, 7)))
    if (dataLast && dataLast < last) last = dataLast
    const start = or(this.settings().start_month, '2023-10')
    const first = E.addMonths(start, -11)
    const series = E.funnelSeries(rows, new Set(cfg.marketing as string[]), cfg.dedupe, today, cfg.mature, first, last, cfg.sql_via_mql)
    return [series, { ...cfg, won_contacts: wonIds.size, cutoff: today, start, stage_defs: defs.length > 0 }]
  }

  // ------------------------------------------------------------------ lead volume (MQLs)
  mqlPlanQuarters(): Dict {
    const out: Dict = {}
    for (const [k, v] of Object.entries((or(this.settings().mql_plan_quarters, {}) as Dict))) {
      if (v !== null && v !== undefined && v !== '') out[k] = Number(v)
    }
    return out
  }

  async mqlInputs(grain: string, view: string): Promise<[Dict[], Dict]> {
    const st = this.settings()
    const cfg = await this.fnConfig()
    const contacts = await this.contacts(cfg.provider)
    const firsts: string[] = []
    for (const c of contacts) {
      const t = (or(c.lifecycleStageHistory, []) as Dict[])
        .filter((h) => h.value === cfg.mql_stage && truthy(h.timestamp)).map((h) => E.toDateStr(h.timestamp))
      if (t.length) firsts.push(minStr(t)!.slice(0, 7))
    }
    let last = E.addMonths(utcMonth(), -1)
    const dataLast = maxStr(firsts)
    if (dataLast && dataLast < last) last = dataLast
    const start = or(st.start_month, '2023-10')
    const months = E.monthRange(E.addMonths(start, -11), last)
    const plan = this.mqlPlanQuarters()
    const rows = E.mqlVsPlan(firsts, plan, months, grain, view).filter((r) => r.month >= start)
    return [rows, { provider: cfg.provider, mql_stage: cfg.mql_stage, threshold: Number(or(st.mql_threshold, 0)), plan_quarters: plan }]
  }

  // ------------------------------------------------------------------ marketing ROI
  async roiConfig(): Promise<Dict> {
    const st = this.settings()
    const provider = or(st.roi_provider, 'salesforce')
    const deals = await this.deals(provider, ROI_FIELDS)
    const pl = this.pl()
    const srcN = new Map<string, number>()
    const typeN = new Map<string, number>()
    for (const d of deals) {
      if (truthy(d.leadSource)) srcN.set(d.leadSource, (srcN.get(d.leadSource) ?? 0) + 1)
      if (truthy(d.type)) typeN.set(d.type, (typeN.get(d.type) ?? 0) + 1)
    }
    const sources = sortedBy(srcN.keys(), (s) => [-srcN.get(s)!, s])
    const types = sortedBy(typeN.keys(), (t) => [-typeN.get(t)!, t])
    const seen = new Map<string, string>()
    for (const m of sortedStr(pl.keys())) for (const [, aid, name] of pl.get(m)!.lines) seen.set(aid, name)
    const accounts = sortedBy(Array.from(seen.entries()), (x) => [x[1]]) as [string, string][]
    const [autoBl, autoPr] = E.suggestRoiAccounts(accounts)
    const autoSrc = E.suggestRoiSources(sources)
    const autoTypes = E.suggestNewBusinessTypes(types)
    const valueField = or(st.roi_value_field, 'arr')
    let saved: Dict[] | null = st.roi_channels
    if (truthy(saved) && saved!.some((c) => 'monthly' in c || c.spend === 'manual')) saved = null
    const channels = (or(saved, E.ROI_DEFAULT_CHANNELS) as Dict[]).map((c) => ({
      name: or(c.name, ''), sources: Array.from(or(c.sources, []) as string[]), gl_accounts: Array.from(or(c.gl_accounts, []) as string[])
    }))
    const nn = (k: string, auto: unknown) => (st[k] !== null && st[k] !== undefined ? st[k] : auto)
    return {
      provider, value_field: valueField === 'arr' || valueField === 'amount' ? valueField : 'arr',
      mk_sources: nn('roi_marketing_sources', autoSrc), nb_types: nn('roi_new_business_types', autoTypes),
      blended_ids: nn('roi_blended_accounts', autoBl), programs_ids: nn('roi_programs_accounts', autoPr), channels,
      threshold: Number(st.roi_threshold !== null && st.roi_threshold !== undefined ? st.roi_threshold : 1.0)
    }
  }

  async roiInputs(grain: string, view: string): Promise<[Dict[], Dict]> {
    const st = this.settings()
    const pl = this.pl()
    const cfg = await this.roiConfig()
    const deals = await this.deals(cfg.provider, ROI_FIELDS)
    const rows = E.roiDealRows(deals, cfg.value_field, new Set(or(cfg.nb_types, []) as string[]), new Set(or(cfg.mk_sources, []) as string[]))
    const gl = new Map<string, [string, string, number][]>()
    for (const [m, p] of pl) gl.set(m, p.lines.map(([, aid, name, a]) => [aid, name, a]))
    let last = E.addMonths(utcMonth(), -1)
    const plMax = maxStr(pl.keys())
    if (pl.size && plMax! < last) last = plMax!
    const lastQ = grain === 'quarter' && Number(last.slice(5, 7)) % 3 ? E.addMonths(last, -(Number(last.slice(5, 7)) % 3)) : last
    const start = or(st.start_month, '2023-10')
    const months = E.monthRange(E.addMonths(start, -11), grain === 'quarter' ? lastQ : last)
    const series = E.roiSeries(rows, gl, new Set(cfg.blended_ids), new Set(cfg.programs_ids), cfg.channels, months, grain, view)
      .filter((r) => r.month >= start)
    return [series, { ...cfg, start, last, n_rows: rows.length }]
  }

  // ------------------------------------------------------------------ marketing-sourced pipeline
  async mspConfig(): Promise<Dict> {
    const st = this.settings()
    const provider = or(st.msp_provider, 'salesforce')
    const deals = await this.deals(provider, MSP_FIELDS)
    const srcN = new Map<string, number>()
    const typeN = new Map<string, number>()
    for (const d of deals) {
      if (truthy(d.leadSource)) srcN.set(d.leadSource, (srcN.get(d.leadSource) ?? 0) + 1)
      if (truthy(d.type)) typeN.set(d.type, (typeN.get(d.type) ?? 0) + 1)
    }
    const sources = sortedBy(srcN.keys(), (s) => [-srcN.get(s)!, s])
    const types = sortedBy(typeN.keys(), (t) => [-typeN.get(t)!, t])
    const autoSrc = E.suggestRoiSources(sources)
    const autoTypes = E.suggestNewBusinessTypes(types)
    const vf = or(st.msp_value_field, 'arr')
    const nn = (k: string, auto: unknown) => (st[k] !== null && st[k] !== undefined ? st[k] : auto)
    return {
      provider, value_field: vf === 'arr' || vf === 'amount' ? vf : 'arr',
      mk_sources: nn('msp_marketing_sources', autoSrc), nb_types: nn('msp_new_business_types', autoTypes),
      exclude_dups: truthy(st.msp_exclude_duplicates ?? true), true_new: truthy(st.msp_true_new_logos ?? true),
      threshold: Number(or(st.msp_threshold, 0)), duplicates: E.duplicateAccounts(deals)
    }
  }

  async mspInputs(grain: string, view: string): Promise<[Dict[], Dict]> {
    const st = this.settings()
    const cfg = await this.mspConfig()
    const deals = await this.deals(cfg.provider, MSP_FIELDS)
    const defs = await this.stageDefs(cfg.provider)
    const wonKeys = new Set(defs.filter((x) => truthy(x.isWon)).map((x) => `${pyStr(x.pipeline)}::${pyStr(x.rawStage)}`))
    const closedKeys = new Set(defs.filter((x) => truthy(x.isClosed)).map((x) => `${pyStr(x.pipeline)}::${pyStr(x.rawStage)}`))
    const [created, won] = E.mspRows(deals, cfg.value_field, new Set(or(cfg.nb_types, []) as string[]), new Set(or(cfg.mk_sources, []) as string[]),
      new Set((cfg.duplicates as Map<string, string>).keys()), (d) => E.dealOutcome(d, wonKeys, closedKeys), cfg.true_new)
    let last = E.addMonths(utcMonth(), -1)
    const dataLast = maxStr(created.map((r) => r.month))
    if (dataLast && dataLast < last) last = dataLast
    if (grain === 'quarter' && Number(last.slice(5, 7)) % 3) last = E.addMonths(last, -(Number(last.slice(5, 7)) % 3))
    const start = or(st.start_month, '2023-10')
    const months = E.monthRange(E.addMonths(start, -11), last)
    const rows = E.mspSeries(created, won, months, grain, view, cfg.exclude_dups).filter((r) => r.month >= start)
    return [rows, { ...cfg, duplicates: undefined, start }]
  }

  /** Bank / balance-sheet sections used by the settings screens (kept for parity with the Python app). */
  bsSections(): string[] {
    return sortedStr(new Set(this.bsSnapshots.flatMap((d) => Object.keys(or(d.sectionTotals, {}) as Dict)).filter((k) => !BS_ROLLUPS.has(k))))
  }
}

const WR_FIELDS = ['dealname', 'dealstage', 'pipeline', 'closedate', 'type', 'accountId', 'accountName', 'competitor', 'competitors', 'customFields']
const ROI_FIELDS = ['dealname', 'dealstage', 'type', 'accountName', 'amount', 'arr', 'leadSource', 'campaignName', 'dealCreatedAt', 'createdDate']
const MSP_FIELDS = ['dealname', 'dealstage', 'pipeline', 'type', 'accountId', 'accountName', 'amount', 'arr', 'leadSource', 'closedate', 'dealCreatedAt', 'createdDate']

// ---------------------------------------------------------------------------- per-org cache
const TTL_MS = 2 * 60 * 1000
const instances = new Map<string, { at: number; data: Promise<OryonData> }>()

/** A loaded OryonData for the org, shared for TTL_MS so one screen's many metric calls read the data once. */
export function oryonDataFor(orgId: string): Promise<OryonData> {
  const hit = instances.get(orgId)
  if (hit && Date.now() - hit.at < TTL_MS) return hit.data
  const data = (async () => {
    const d = await OryonData.forOrg(orgId)
    await d.load()
    return d
  })()
  data.catch(() => instances.delete(orgId))
  instances.set(orgId, { at: Date.now(), data })
  return data
}

/** Drop the cached data (tests; after a settings change). */
export function clearOryonData(orgId?: string): void {
  if (orgId) instances.delete(orgId)
  else instances.clear()
}
