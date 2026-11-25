/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Oryon metric engine — a line-by-line TypeScript port of the reference
 * Python engine `mrr_app/mrr_engine.py`. Pure functions, no database or web
 * code. Function names, argument order, row keys and every formula follow the
 * Python file exactly so the two can be diffed side by side; keep them in
 * step when the Python reference changes.
 *
 * Mapping types (one per product):
 *   subscription_monthly    counts in its invoice month
 *   subscription_quarterly  Amount / 3 spread over 3 months
 *   subscription_yearly     Amount / 12 spread over 12 months
 *   retainer_repeating      recurring only when the same customer is billed the same
 *                           amount in an adjacent month
 *   retainer_always         every line is recurring, counts in its invoice month
 *   not_mrr                 one-time / usage / credits - never MRR
 */
import { Dict, truthy, or, pyStr, num, pyRound, sortedBy, sortedStr, deepEqual, sum, add2, getOr } from './pyCompat'

export const MAPPING_TYPES: Record<string, string> = {
  subscription_monthly: 'Subscription - monthly',
  subscription_quarterly: 'Subscription - quarterly (÷3)',
  subscription_yearly: 'Subscription - annual (÷12)',
  retainer_repeating: 'Retainer - only when repeated monthly',
  retainer_always: 'Retainer - always recurring',
  not_mrr: 'Not MRR (one-time / usage / credit)'
}
export const SPREAD_MONTHS: Record<string, number> = { subscription_monthly: 1, subscription_quarterly: 3, subscription_yearly: 12 }

export const ROI_DEFAULT_SOURCES = ['Paid Search', 'Organic Search', 'Review Site', 'Webinar', 'Web', 'Trade Show', 'Paid Social',
  'Content Download', 'Email', 'Social']
export const ROI_DEFAULT_CHANNELS = [{ name: 'Events', sources: ['Trade Show'], gl_accounts: ['6130'] }]

export const DEFAULT_SETTINGS: Dict = {
  start_month: '2023-10',
  early_invoice_day: 16,
  cad_countries: ['CA', 'CAN', 'CANADA'],
  newlogo_lag_months: 1,
  newlogo_group_parent: false,
  ltv_cap_months: 84,
  ltv_threshold: 3.0,
  ltv_grr_scope: 'all',
  cash_sections: ['BankAccounts'],
  cash_lookback_months: 3,
  cash_show_ar_check: true,
  cash_account_ids: null,
  cash_account_map: null,
  cash_restricted_adjust: 500000,
  fcf_capex_map: null,
  fcf_capex_sections: ['FixedAssets'],
  fcf_fa_da_ids: null,
  fcf_wc_map: null,
  fcf_wc_section_map: { AR: 'ar', OtherCurrentAssets: 'prepaid', AP: 'ap', CreditCards: 'credit_card', OtherCurrentLiabilities: 'accrued' },
  fcf_show_ar_check: true,
  ccc_account_map: null,
  ccc_section_map: { AR: 'ar', AP: 'ap', OtherCurrentAssets: 'exclude' },
  ccc_cogs_include_da: true,
  conc_top_n: 10,
  conc_group_parent: true,
  wr_provider: 'salesforce',
  wr_competitor_field: null,
  wr_loss_reason_field: null,
  wr_exclude_loss_reasons: ['No Decision / Status Quo'],
  wr_new_business_types: null,
  wr_headline: null,
  wr_window_months: 6,
  fn_provider: 'hubspot',
  fn_lead_stage: 'lead',
  fn_mql_stage: 'marketingqualifiedlead',
  fn_sql_stage: 'salesqualifiedlead',
  fn_opp_stage: 'opportunity',
  fn_sql_via_mql: true,
  fn_marketing_sources: null,
  fn_dedupe_email: true,
  mql_plan_quarters: {
    '2023-Q1': 418, '2023-Q2': 433, '2023-Q3': 409, '2023-Q4': 457, '2024-Q1': 449, '2024-Q2': 459,
    '2024-Q3': 426, '2024-Q4': 484, '2025-Q1': 481, '2025-Q2': 496, '2025-Q3': 468, '2025-Q4': 514,
    '2026-Q1': 592, '2026-Q2': 611, '2026-Q3': 556, '2026-Q4': 596
  },
  mql_threshold: 0.0,
  roi_provider: 'salesforce',
  roi_value_field: 'arr',
  roi_new_business_types: null,
  roi_marketing_sources: null,
  roi_blended_accounts: null,
  roi_programs_accounts: null,
  roi_channels: ROI_DEFAULT_CHANNELS,
  roi_threshold: 1.0,
  div_top_n: 5,
  div_threshold: 0.0,
  msp_provider: 'salesforce',
  msp_value_field: 'arr',
  msp_marketing_sources: null,
  msp_new_business_types: null,
  msp_exclude_duplicates: true,
  msp_true_new_logos: true,
  msp_threshold: 0.0,
  fn_mature_days: [60, 90, 180, 60, 180],
  fx_cad_usd: {
    '2022-10': 0.735, '2022-11': 0.7375, '2022-12': 0.7396, '2023-01': 0.7468, '2023-02': 0.7469,
    '2023-03': 0.7459, '2023-04': 0.744, '2023-05': 0.7416, '2023-06': 0.739, '2023-07': 0.7368,
    '2023-08': 0.7354, '2023-09': 0.735, '2023-10': 0.7357, '2023-11': 0.7375, '2023-12': 0.7398,
    '2024-01': 0.7384, '2024-02': 0.7407, '2024-03': 0.7424, '2024-04': 0.743, '2024-05': 0.7425,
    '2024-06': 0.741, '2024-07': 0.7387, '2024-08': 0.7362, '2024-09': 0.7337, '2024-10': 0.7319,
    '2024-11': 0.731, '2024-12': 0.7313, '2025-01': 0.7116, '2025-02': 0.7137, '2025-03': 0.7163,
    '2025-04': 0.7188, '2025-05': 0.7207, '2025-06': 0.7218, '2025-07': 0.7219, '2025-08': 0.7208,
    '2025-09': 0.7188, '2025-10': 0.7163, '2025-11': 0.7138, '2025-12': 0.7116, '2026-01': 0.7223,
    '2026-02': 0.722, '2026-03': 0.7229, '2026-04': 0.7247, '2026-05': 0.7271, '2026-06': 0.7297,
    '2026-07': 0.7319, '2026-08': 0.7335, '2026-09': 0.734
  }
}

// ---------------------------------------------------------------------------
// automatic mapping suggestion
// ---------------------------------------------------------------------------
const NOT_MRR_WORDS = ['overage', 'usage', 'implementation', 'onboarding', 'training', 'workshop',
  'kit', 'hardware', 'tablet', 'device', 'credit', 'write-off', 'write off',
  'bad debt', 'refund', 'setup', 'set-up', 'installation', 'one-time', 'one time']
const RETAINER_WORDS = ['professional services', 'retainer', 'managed services', 'consulting']

export function suggestMapping(name: string, category?: string | null, frequency?: string | null): [string, string] {
  const n = (name || '').toLowerCase()
  if (RETAINER_WORDS.some((w) => n.includes(w))) return ['retainer_repeating', 'name looks like services/retainer']
  if (NOT_MRR_WORDS.some((w) => n.includes(w))) return ['not_mrr', 'name looks one-time / usage / credit']
  if (n.includes('annual') || n.includes('yearly') || n.includes('12 month')) return ['subscription_yearly', 'name says annual']
  if (n.includes('quarter')) return ['subscription_quarterly', 'name says quarterly']
  if (n.includes('monthly') || n.includes('/mo') || n.includes('subscription')) return ['subscription_monthly', 'name says monthly']
  if (category === 'recurring') {
    const f = ({ monthly: 'subscription_monthly', quarterly: 'subscription_quarterly', yearly: 'subscription_yearly' } as Dict)[frequency || ''] ?? 'subscription_monthly'
    return [f, 'categorized recurring in Oryon Settings']
  }
  if (category === 'non_recurring') return ['not_mrr', 'categorized non-recurring in Oryon Settings']
  return ['not_mrr', 'no recurring signal - please review']
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------
export function addMonths(ym: string, k: number): string {
  let y = Number(ym.slice(0, 4))
  let m = Number(ym.slice(5, 7))
  m += k
  y += Math.floor((m - 1) / 12)
  m = (((m - 1) % 12) + 12) % 12 + 1
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}`
}

export function monthRange(start: string, end: string): string[] {
  const out: string[] = []
  let m = start
  while (m <= end) {
    out.push(m)
    m = addMonths(m, 1)
  }
  return out
}

export function toDateStr(value: unknown): string {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? '' : value.toISOString().slice(0, 10)
  return String(or(value, '')).slice(0, 10)
}

export function fxFor(month: string, rates: Dict | null | undefined): number {
  if (!rates || Object.keys(rates).length === 0) return 1.0
  if (month in rates) return Number(rates[month])
  const keys = Object.keys(rates)
  const earlier = keys.filter((m) => m <= month)
  const pick = earlier.length ? earlier.reduce((a, b) => (b > a ? b : a)) : keys.reduce((a, b) => (b < a ? b : a))
  return Number(rates[pick])
}

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

// ---------------------------------------------------------------------------
// calculation
// ---------------------------------------------------------------------------
export interface CustMrr { subscription: number; retainer: number }
export type MrrTable = Map<string, Map<string, CustMrr>>

export function computeMrr(invoices: Dict[], mapping: Dict, settings: Dict): [MrrTable, Map<string, boolean>] {
  const earlyDay = Math.trunc(Number(or(settings.early_invoice_day, 16)))
  const cadCountries = new Set<string>((or(settings.cad_countries, []) as string[]).map((c) => c.toUpperCase()))
  const rates = (or(settings.fx_cad_usd, {}) as Dict)

  const subscription = new Map<string, Map<string, number>>()
  const retainer = new Map<string, Map<string, number>>()
  const repeatLines = new Map<string, Map<string, number[]>>()
  const isCad = new Map<string, boolean>()

  for (const inv of invoices) {
    const cust = String(or(inv.customerRecordId, ''))
    const date = toDateStr(inv.txnDate)
    if (!cust || date.length < 10) continue
    const month = date.slice(0, 7)
    if (cadCountries.has(String(or((or(inv.billingAddress, {}) as Dict).country, '')).toUpperCase())) isCad.set(cust, true)
    for (const line of (or(inv.lines, []) as Dict[])) {
      const item = String(or(line.itemId, ''))
      const amount = num(line.amount)
      if (!item || !amount) continue
      const kind = mapping[item] ?? 'not_mrr'
      if (kind in SPREAD_MONTHS) {
        const n = SPREAD_MONTHS[kind]
        const start = n > 1 && Number(date.slice(8, 10)) >= earlyDay ? addMonths(month, 1) : month
        for (let k = 0; k < n; k++) add2(subscription, addMonths(start, k), cust, amount / n)
      } else if (kind === 'retainer_always') {
        add2(retainer, month, cust, amount)
      } else if (kind === 'retainer_repeating') {
        getOr(getOr(repeatLines, cust, () => new Map()), month, () => []).push(amount)
      }
    }
  }

  for (const [cust, byMonth] of repeatLines) {
    for (const [month, amounts] of byMonth) {
      const neighbours = [...(byMonth.get(addMonths(month, -1)) ?? []), ...(byMonth.get(addMonths(month, 1)) ?? [])]
      for (const a of amounts) if (neighbours.includes(a)) add2(retainer, month, cust, a)
    }
  }

  const mrr: MrrTable = new Map()
  const months = new Set([...subscription.keys(), ...retainer.keys()])
  for (const month of months) {
    const s = subscription.get(month) ?? new Map<string, number>()
    const r = retainer.get(month) ?? new Map<string, number>()
    const custs = new Set([...s.keys(), ...r.keys()])
    const row = new Map<string, CustMrr>()
    for (const cust of custs) {
      const fx = isCad.get(cust) ? fxFor(month, rates) : 1.0
      row.set(cust, { subscription: (s.get(cust) ?? 0) * fx, retainer: (r.get(cust) ?? 0) * fx })
    }
    mrr.set(month, row)
  }
  return [mrr, isCad]
}

export function summarize(mrr: MrrTable, months: string[]): Dict[] {
  const rows: Dict[] = []
  let prev: number | null = null
  for (const m of months) {
    const custs = Array.from((mrr.get(m) ?? new Map<string, CustMrr>()).values())
    const sub = sum(custs.map((v) => v.subscription))
    const ret = sum(custs.map((v) => v.retainer))
    const total = sub + ret
    rows.push({
      month: m,
      subscription_mrr: pyRound(sub, 2),
      retainer_mrr: pyRound(ret, 2),
      total_mrr: pyRound(total, 2),
      arr: pyRound(total * 12, 2),
      active_customers: custs.filter((v) => v.subscription + v.retainer > 0.005).length,
      mom_pct: prev ? pyRound(((total - prev) / prev) * 100, 2) : null
    })
    prev = total
  }
  return rows
}

// ---------------------------------------------------------------------------
// retention (GRR / NRR)
// ---------------------------------------------------------------------------
export function computeNativeMrr(invoices: Dict[], mapping: Dict, settings: Dict): [MrrTable, Map<string, boolean>] {
  return computeMrr(invoices, mapping, { ...settings, fx_cad_usd: {} })
}

export function retention(native: MrrTable, isCad: Map<string, boolean>, rates: Dict, m0: string, m1: string,
  subscriptionOnly = false, withCustomers = false): Dict | null {
  const val = (month: string, cust: string): number => {
    const v = native.get(month)?.get(cust)
    if (!v) return 0.0
    return subscriptionOnly ? v.subscription : v.subscription + v.retainer
  }
  const fx0 = fxFor(m0, rates)
  let S = 0, C = 0, Dn = 0, U = 0
  const counts: Dict = { churn: 0, downgrade: 0, upgrade: 0, flat: 0 }
  const customers: Dict[] = []
  for (const cust of (native.get(m0) ?? new Map()).keys()) {
    const f = isCad.get(cust) ? fx0 : 1.0
    const a = val(m0, cust) * f
    if (a <= 0.005) continue
    const b = val(m1, cust) * f
    S += a
    let bucket: string, delta: number
    if (b <= 0.005) {
      bucket = 'churn'; delta = -a; C += a
    } else if (b < a - 0.005) {
      bucket = 'downgrade'; delta = b - a; Dn += a - b
    } else if (b > a + 0.005) {
      bucket = 'upgrade'; delta = b - a; U += b - a
    } else {
      bucket = 'flat'; delta = 0.0
    }
    counts[bucket] += 1
    if (withCustomers) customers.push({ customer: cust, currency: isCad.get(cust) ? 'CAD' : 'USD', start: a, end: b, change: delta, bucket })
  }
  if (S <= 0) return null
  const K = S - C - Dn
  const E = K + U
  const out: Dict = {
    m0, m1, S, C, Dn, U, K, E, grr: (100 * K) / S, nrr: (100 * E) / S,
    cohort: counts.churn + counts.downgrade + counts.upgrade + counts.flat, ...counts
  }
  if (withCustomers) out.customers = sortedBy(customers, (r) => [r.change])
  return out
}

export function windowStart(end: string, grain: string, window: string): string {
  if (window === 'ttm') return addMonths(end, -12)
  return addMonths(end, grain === 'quarter' ? -3 : -1)
}

export function periodEnds(start: string, end: string, grain: string): string[] {
  const months = monthRange(start, end)
  if (grain === 'quarter') return months.filter((m) => Number(m.slice(5, 7)) % 3 === 0)
  return months
}

// ---------------------------------------------------------------------------
// new logos - QuickBooks invoices + Salesforce accounts
// ---------------------------------------------------------------------------
const W = '[\\p{L}\\p{N}_]'
const SUFFIX = new RegExp(`(?<!${W})(incorporated|inc|llc|l\\.l\\.c|co|corp|corporation|company|ltd|limited|the)(?!${W})\\.?`, 'gu')

export function normalizeName(name: string): string {
  let n = (name || '').toLowerCase().split(':').slice(-1)[0]
  n = n.replace(SUFFIX, '')
  return n.replace(/[^a-z0-9]/g, '')
}

export function linkCustomers(qboCustomers: Dict[], sfAccounts: Dict[]): Map<string, Dict> {
  const byQboId = new Map<string, Dict>()
  for (const a of sfAccounts) if (truthy(a.qboCustomerId)) byQboId.set(pyStr(a.qboCustomerId), a)
  const byName = new Map<string, Dict[]>()
  for (const a of sfAccounts) getOr(byName, normalizeName(a.name ?? ''), () => []).push(a)
  const links = new Map<string, Dict>()
  for (const c of qboCustomers) {
    const cid = String(or(c.providerRecordId, ''))
    if (!cid) continue
    let acct: Dict | null = byQboId.get(cid) ?? null
    let method = 'QBO_Customer_Id__c'
    if (!acct) {
      let cands = byName.get(normalizeName(c.displayName ?? '')) ?? []
      cands = sortedBy(cands, (a) => [truthy(a.parentRecordId)])
      if (cands.length) {
        acct = cands[0]
        method = 'name match' + (cands.length > 1 ? ' (ambiguous)' : '')
      } else {
        acct = null
        method = ''
      }
    }
    links.set(cid, { customer_name: or(c.displayName, ''), account: acct, method })
  }
  return links
}

export function newLogos(mrrUsd: MrrTable, links: Map<string, Dict>, lagMonths = 1, groupParent = false): Dict[] {
  const groupOf = (cust: string): string => {
    const acct = (links.get(cust) ?? {}).account
    if (!truthy(acct)) return 'qbo:' + cust
    return or(or(acct.parentRecordId, acct.providerRecordId), 'qbo:' + cust)
  }
  const seen = new Set<string>()
  const seenGroups = new Set<string>()
  const out: Dict[] = []
  for (const month of sortedStr(mrrUsd.keys())) {
    const active = new Map<string, number>()
    for (const [c, v] of mrrUsd.get(month)!) if (v.subscription + v.retainer > 0.005) active.set(c, v.subscription + v.retainer)
    for (const [cust, mrr] of active) {
      if (seen.has(cust)) continue
      const g = groupOf(cust)
      const subsidiaryOfExisting = seenGroups.has(g)
      const link = links.get(cust) ?? {}
      const acct = (or(link.account, {}) as Dict)
      out.push({
        customer: cust,
        customer_name: link.customer_name ?? '',
        account_id: acct.providerRecordId ?? '',
        account_name: acct.name ?? '',
        segment: or(acct.segment, 'Unlinked'),
        parent_id: acct.parentRecordId ?? '',
        link_method: or(link.method ?? '', 'not linked'),
        billing_month: month,
        close_month: addMonths(month, -lagMonths),
        first_mrr: mrr,
        arr: mrr * 12,
        subsidiary_of_existing: subsidiaryOfExisting,
        counted: !(groupParent && subsidiaryOfExisting)
      })
    }
    for (const c of active.keys()) seen.add(c)
    for (const c of active.keys()) seenGroups.add(groupOf(c))
  }
  return out
}

export const SEGMENTS = ['SMB', 'Mid-Market', 'Upper Mid-Market', 'Enterprise', 'Unlinked']

export const quarterOf = (month: string): string => `Q${Math.floor((Number(month.slice(5, 7)) - 1) / 3) + 1}-${month.slice(0, 4)}`

export function summarizeNewLogos(logos: Dict[], periods: string[], grain: string, completeUntil: string): Dict[] {
  const key = (m: string) => (grain === 'quarter' ? quarterOf(m) : m)
  const buckets = new Map<string, Dict>()
  for (const p of periods) {
    const b: Dict = { arr: 0.0, n: 0 }
    for (const s of SEGMENTS) b[s] = 0.0
    for (const s of SEGMENTS) b[`n_${s}`] = 0
    buckets.set(p, b)
  }
  for (const l of logos) {
    const k = key(l.close_month)
    if (buckets.has(k) && l.counted) {
      const b = buckets.get(k)!
      b.arr += l.arr; b.n += 1
      b[l.segment] = (b[l.segment] ?? 0) + l.arr; b[`n_${l.segment}`] = (b[`n_${l.segment}`] ?? 0) + 1
    }
  }
  const rows: Dict[] = []
  const step = grain === 'quarter' ? 4 : 12
  periods.forEach((p, i) => {
    const b = buckets.get(p)!
    const lastMonth = grain === 'month' ? p : `${p.slice(3)}-${String(Number(p[1]) * 3).padStart(2, '0')}`
    const prev = i ? rows[i - 1] : null
    const ya = i >= step ? rows[i - step] : null
    rows.push({
      period: p, complete: lastMonth <= completeUntil, ...b,
      pop_pct: prev && prev.arr ? ((b.arr - prev.arr) / prev.arr) * 100 : null,
      yoy_pct: ya && ya.arr ? ((b.arr - ya.arr) / ya.arr) * 100 : null
    })
  })
  return rows
}

// ---------------------------------------------------------------------------
// CAC & payback (VC-06)
// ---------------------------------------------------------------------------
const CAC_RANGES: [number, number, string][] = [[6010, 6050, 'Sales'], [6110, 6115, 'Marketing payroll'], [6120, 6160, 'Marketing programs']]
const CAC_EXCLUDE_WORDS = ['customer success', 'support', 'cost of', 'cogs', 'depreciation', 'amortization']
const CAC_INCLUDE_WORDS = ['sales', 'marketing', 'advertis', 'sponsorship', 'events', 'trade show', 'lead gen', 'partner referral', 'commission']

export function accountNumber(name: string): number | null {
  const head = (name || '').trim().split(' ')[0]
  return /^\d+$/.test(head) ? Number(head) : null
}

export function suggestCacAccount(name: string, section = 'expenses', numberedChart = false): [boolean, string] {
  const n = accountNumber(name)
  if (n !== null) {
    for (const [lo, hi, label] of CAC_RANGES) if (lo <= n && n <= hi) return [true, label]
    if (n >= 6210 && n <= 6216) return [false, 'Customer Success - excluded from CAC']
    return [false, 'outside the S&M account ranges']
  }
  if (numberedChart) return [false, 'no account number (the S&M accounts are numbered 6010-6160)']
  const low = (name || '').toLowerCase()
  if (section !== 'expenses') return [false, 'other expense']
  if (CAC_EXCLUDE_WORDS.some((w) => low.includes(w))) return [false, 'name looks like support / customer success / COGS']
  if (CAC_INCLUDE_WORDS.some((w) => low.includes(w))) return [true, 'name looks like sales or marketing']
  return [false, 'no sales/marketing signal']
}

/** [section, accountId, name, amount] */
export type PlLine = [string, string, string, number]
export interface PlMonth { revenue: number; cogs: number; lines: PlLine[]; rc_lines: PlLine[] }
export type PlTable = Map<string, PlMonth>

export function plByMonth(snapshots: Dict[]): PlTable {
  const out: PlTable = new Map()
  const total = (l: Dict) => num((or(l.amounts, {}) as Dict).Total)
  for (const s of snapshots) {
    const m = s.month
    if (!truthy(m)) continue
    const rev = sum((or(s.income, []) as Dict[]).map(total))
    const cogs = sum((or(s.cogs, []) as Dict[]).map(total))
    const rcLines: PlLine[] = []
    for (const sec of ['income', 'cogs']) {
      for (const l of (or(s[sec], []) as Dict[])) rcLines.push([sec, pyStr(or(l.accountId, l.account)), or(l.account, ''), total(l)])
    }
    const lines: PlLine[] = []
    for (const sec of ['expenses', 'otherExpenses']) {
      for (const l of (or(s[sec], []) as Dict[])) lines.push([sec, pyStr(or(l.accountId, l.account)), or(l.account, ''), total(l)])
    }
    out.set(m, { revenue: rev, cogs, lines, rc_lines: rcLines })
  }
  return out
}

export function cacSeries(pl: PlTable, accountIds: Set<string>, logos: Dict[], ends: string[],
  firstValidClose: string | null, completeUntil: string | null): Dict[] {
  const byClose = new Map<string, Dict[]>()
  for (const l of logos) if (l.counted) getOr(byClose, l.close_month, () => []).push(l)
  const rows: Dict[] = []
  for (const e of ends) {
    const window: string[] = []
    for (let k = 11; k >= 0; k--) window.push(addMonths(e, -k))
    const havePl = window.every((m) => pl.has(m) && truthy(pl.get(m)!.revenue))
    let sm = 0
    for (const m of window) if (pl.has(m)) for (const [, aid, , a] of pl.get(m)!.lines) if (accountIds.has(aid)) sm += a
    const rev = sum(window.filter((m) => pl.has(m)).map((m) => pl.get(m)!.revenue))
    const cogs = sum(window.filter((m) => pl.has(m)).map((m) => pl.get(m)!.cogs))
    const winLogos = window.flatMap((m) => byClose.get(m) ?? [])
    const n = winLogos.length
    const arr = sum(winLogos.map((l) => l.arr))
    const gm = rev ? (rev - cogs) / rev : null
    const cac = n ? sm / n : null
    const payback = cac !== null && arr && gm ? cac / ((arr / n / 12) * gm) : null
    const logosOk = truthy(firstValidClose) && window[0] >= firstValidClose! && truthy(completeUntil) && window[window.length - 1] <= completeUntil!
    rows.push({
      month: e, start: window[0], sm, revenue: rev, cogs, gm,
      new_logos: n, new_logo_arr: arr, avg_arr: n ? arr / n : null,
      cac, payback, sm_per_arr: arr ? sm / arr : null,
      has_pl: havePl, logos_complete: logosOk, complete: havePl && logosOk
    })
  }
  return rows
}

// ---------------------------------------------------------------------------
// COGS % and mix (VC-04)
// ---------------------------------------------------------------------------
export const PRODUCT_LINES = ['Platform', 'Services', 'Hardware']
export const COGS_LINE_CHOICES: Dict = { Platform: 'Platform', Services: 'Services', Hardware: 'Hardware',
  Unassigned: 'Company only (no product line)', Exclude: 'Exclude (not in COGS %)' }
const LINE_RANGES: [number, number, string][] = [[0, 99, 'Platform'], [100, 199, 'Services'], [200, 299, 'Hardware']]

export function suggestCogsLine(name: string, section: string, numberedChart: boolean): [string, string] {
  const n = accountNumber(name)
  const base = section === 'income' ? 4000 : 5000
  if (n !== null) {
    if (base <= n && n < base + 1000) {
      for (const [lo, hi, line] of LINE_RANGES) if (base + lo <= n && n <= base + hi) return [line, `${base + lo}-${base + hi} -> ${line}`]
      return ['Unassigned', 'numbered account outside the product ranges']
    }
    return ['Unassigned', 'outside the 4xxx / 5xxx ranges']
  }
  if (numberedChart) return ['Exclude', 'no account number - QuickBooks sandbox/demo account']
  const low = (name || '').toLowerCase()
  for (const [word, line] of [['subscription', 'Platform'], ['hosting', 'Platform'], ['usage', 'Platform'],
    ['implementation', 'Services'], ['professional', 'Services'], ['training', 'Services'],
    ['hardware', 'Hardware'], ['freight', 'Hardware']]) {
    if (low.includes(word)) return [line, `name contains '${word}'`]
  }
  return ['Unassigned', 'no product signal in the name']
}

export function suggestCogsDa(name: string, section: string): boolean {
  if (section !== 'cogs') return false
  const low = (name || '').toLowerCase()
  return accountNumber(name) === 5040 || low.includes('amortization') || low.includes('depreciation')
}

const pct = (a: number, b: number): number | null => (b ? (100 * a) / b : null)

export function cogsPeriod(pl: PlTable, months: string[], lineMap: Dict, daIds: Set<string>): Dict {
  const lines: Dict = {}
  for (const p of [...PRODUCT_LINES, 'Unassigned']) lines[p] = { revenue: 0.0, cogs: 0.0 }
  const r: Dict = { revenue: 0.0, cogs: 0.0, da: 0.0, months: months.filter((m) => pl.has(m)).length, lines }
  for (const m of months) {
    for (const [sec, aid, , amt] of pl.get(m)?.rc_lines ?? []) {
      const line = lineMap[aid] ?? 'Unassigned'
      if (line === 'Exclude') continue
      const key = sec === 'income' ? 'revenue' : 'cogs'
      r[key] += amt
      if (!r.lines[line]) r.lines[line] = { revenue: 0.0, cogs: 0.0 }
      r.lines[line][key] += amt
      if (sec === 'cogs' && daIds.has(aid)) r.da += amt
    }
  }
  r.pct = pct(r.cogs, r.revenue)
  r.pct_ex_da = pct(r.cogs - r.da, r.revenue)
  for (const v of Object.values(r.lines) as Dict[]) {
    v.pct = pct(v.cogs, v.revenue)
    v.share = pct(v.revenue, r.revenue)
  }
  return r
}

// ---------------------------------------------------------------------------
// G&A % of revenue (VC-09)
// ---------------------------------------------------------------------------
export function suggestGaAccount(name: string, section: string, numberedChart: boolean): [boolean, string] {
  const n = accountNumber(name)
  if (n !== null) {
    if ((n >= 6410 && n <= 6485) || n === 6495) return [true, 'G&A (6410-6485, 6495)']
    if (n === 6490) return [false, 'one-time transaction & deal fees - excluded']
    if (n === 6510 || n === 6520) return [false, 'D&A - excluded']
    return [false, 'outside the G&A ranges']
  }
  const low = (name || '').toLowerCase()
  if (section === 'expenses' && low.includes('insurance')) return [true, 'insurance (prepaid amortization) - G&A']
  if (numberedChart) return [false, 'no account number - QuickBooks sandbox/demo account']
  if (section === 'expenses' && ['rent', 'legal', 'accounting', 'office', 'bank', 'recruit', 'general', 'administrative'].some((w) => low.includes(w))) {
    return [true, 'name looks like G&A']
  }
  return [false, 'no G&A signal in the name']
}

export function gaPeriod(pl: PlTable, months: string[], gaIds: Set<string>, revenueMap: Dict): Dict {
  const r: Dict = { revenue: 0.0, ga: 0.0, by_account: {}, months: months.filter((m) => pl.has(m)).length }
  for (const m of months) {
    const snap = pl.get(m)
    for (const [sec, aid, , amt] of snap?.rc_lines ?? []) if (sec === 'income' && revenueMap[aid] !== 'Exclude') r.revenue += amt
    for (const [, aid, name, amt] of snap?.lines ?? []) {
      if (gaIds.has(aid)) {
        r.ga += amt
        const a = (r.by_account[aid] ??= { name, amount: 0.0 })
        a.amount += amt
      }
    }
  }
  r.pct = r.revenue ? (100 * r.ga) / r.revenue : null
  return r
}

// ---------------------------------------------------------------------------
// EBITDA margin (VC-10)
// ---------------------------------------------------------------------------
export const EBITDA_CATEGORIES: Dict = { revenue: 'Revenue', cogs: 'COGS', opex: 'Opex', below: 'Below EBITDA (interest, FX, tax)', exclude: 'Exclude' }

export function suggestEbitdaAccount(name: string, section: string, numberedChart: boolean): [string, boolean, string] {
  const n = accountNumber(name)
  const low = (name || '').toLowerCase()
  if (n === null && numberedChart && !(section === 'expenses' && low.includes('insurance'))) return ['exclude', false, 'no account number - QuickBooks sandbox/demo account']
  if (section === 'income') return ['revenue', false, 'income']
  if (section === 'cogs') {
    const da = n === 5040 || low.includes('amortization') || low.includes('depreciation')
    return ['cogs', da, 'COGS' + (da ? ' - D&A added back' : '')]
  }
  if (section === 'otherExpenses' || (n !== null && n >= 7000)) return ['below', false, 'interest / FX / tax - below EBITDA']
  if (n === 6510 || n === 6520 || low.includes('depreciation') || low.includes('amortization')) return ['opex', true, 'D&A - in opex and added back']
  if (n === 6490) return ['opex', false, 'deal fees - in opex, not added back']
  return ['opex', false, 'operating expense']
}

export function ebitdaPeriod(pl: PlTable, months: string[], catMap: Dict, daIds: Set<string>, plan?: Dict | null): Dict {
  const r: Dict = { revenue: 0.0, cogs: 0.0, opex: 0.0, da: 0.0, below: 0.0, months: months.filter((m) => pl.has(m)).length }
  for (const m of months) {
    const snap = pl.get(m)
    for (const [, aid, , amt] of [...(snap?.rc_lines ?? []), ...(snap?.lines ?? [])]) {
      const cat = catMap[aid] ?? 'exclude'
      if (cat === 'exclude') continue
      r[cat] = (r[cat] ?? 0) + amt
      if (daIds.has(aid) && (cat === 'cogs' || cat === 'opex')) r.da += amt
    }
  }
  r.ebitda = r.revenue - r.cogs - r.opex + r.da
  r.margin = r.revenue ? (100 * r.ebitda) / r.revenue : null
  r.net_income = r.ebitda - r.da - r.below
  let pe = 0.0, pr = 0.0, have = 0
  for (const m of months) {
    if (plan && truthy(plan) && m in plan) {
      pe += plan[m][0]; pr += plan[m][1]; have += 1
    }
  }
  r.plan_margin = have === months.length && pr ? (100 * pe) / pr : null
  r.plan_ebitda = have === months.length ? pe : null
  r.vs_plan = r.margin !== null && r.plan_margin !== null ? r.margin - r.plan_margin : null
  return r
}

// ---------------------------------------------------------------------------
// LTV / CAC (VC-07)
// ---------------------------------------------------------------------------
export function ltvCacRow(cacRow: Dict, grr: number | null, capMonths: number): Dict {
  const r: Dict = { ...cacRow }
  r.grr = grr
  if (grr === null || !truthy(r.new_logos) || !truthy(r.cac) || r.gm === null || r.gm === undefined) {
    Object.assign(r, { churn: null, lifetime: null, capped: null, gp_month: null, ltv: null, ltv_cac: null })
    return r
  }
  const c = 1 - (Math.max(grr, 0.0) / 100) ** (1 / 12)
  const raw = c > 0 ? 1 / c : Infinity
  r.churn = c
  r.lifetime_raw = raw
  r.lifetime = Math.min(raw, capMonths)
  r.capped = raw >= capMonths
  r.gp_month = (r.new_logo_arr / (r.new_logos * 12)) * r.gm
  r.ltv = r.gp_month * r.lifetime
  r.ltv_cac = r.ltv / r.cac
  return r
}

// ---------------------------------------------------------------------------
// Recurring revenue % (VC-12)
// ---------------------------------------------------------------------------
export function suggestRecurringTag(name: string, section: string): [boolean, string] {
  if (section !== 'income') return [false, 'not income']
  const n = accountNumber(name)
  if (n === 4010 || n === 4015) return [true, 'subscription revenue account']
  if (n === null && (name || '').toLowerCase().includes('subscription')) return [true, "name contains 'subscription'"]
  return [false, 'not a subscription revenue account']
}

export function recurringPeriod(mrr: MrrTable, pl: PlTable, months: string[], revenueMap: Dict, tagIds: Set<string>): Dict {
  const r: Dict = { sub: 0.0, ret: 0.0, revenue: 0.0, tagged: 0.0, customers: 0 }
  for (const m of months) {
    for (const v of (mrr.get(m) ?? new Map()).values()) {
      r.sub += v.subscription
      r.ret += v.retainer
    }
    for (const [sec, aid, , amt] of pl.get(m)?.rc_lines ?? []) {
      if (sec === 'income' && revenueMap[aid] !== 'Exclude') {
        r.revenue += amt
        if (tagIds.has(aid)) r.tagged += amt
      }
    }
  }
  r.mrr = r.sub + r.ret
  const p = (a: number) => (r.revenue ? (100 * a) / r.revenue : null)
  r.pct = p(r.mrr); r.sub_pct = p(r.sub); r.ret_pct = p(r.ret); r.tagged_pct = p(r.tagged)
  r.gap = r.pct !== null ? r.pct - r.tagged_pct : null
  return r
}

// ---------------------------------------------------------------------------
// Revenue growth (VC-13)
// ---------------------------------------------------------------------------
export function growthPeriod(mrr: MrrTable, pl: PlTable, months: string[], revenueMap: Dict, plan?: Dict | null): Dict {
  const prior = months.map((m) => addMonths(m, -12))
  const cur = recurringPeriod(mrr, pl, months, revenueMap, new Set())
  const old = recurringPeriod(mrr, pl, prior, revenueMap, new Set())
  const g = (a: number, b: number | null) => (b ? 100 * (a / b - 1) : null)
  const r: Dict = {
    revenue: cur.revenue, prev_revenue: old.revenue, mrr: cur.mrr, prev_mrr: old.mrr,
    nonrec: cur.revenue - cur.mrr, prev_nonrec: old.revenue - old.mrr, prior
  }
  r.growth = g(r.revenue, r.prev_revenue)
  r.rec_growth = g(r.mrr, r.prev_mrr)
  r.nonrec_growth = r.prev_nonrec > 0 ? g(r.nonrec, r.prev_nonrec) : null
  r.added = r.revenue - r.prev_revenue
  const have = months.filter((m) => plan && truthy(plan) && m in plan)
  r.plan_revenue = plan && truthy(plan) && have.length === months.length ? sum(have.map((m) => plan[m][1])) : null
  r.vs_plan = r.plan_revenue ? g(r.revenue, r.plan_revenue) : null
  return r
}

export function ltvBaseFields(row: Dict, arr: number, customers: number): Dict {
  row.arr = arr
  row.customers = customers
  if (!customers || row.lifetime === null || row.lifetime === undefined || row.gm === null || row.gm === undefined || !truthy(row.cac)) {
    Object.assign(row, { base_avg_mrr: null, base_gp_month: null, base_ltv: null, base_ltv_cac: null })
    return row
  }
  row.base_avg_mrr = arr / (customers * 12)
  row.base_gp_month = row.base_avg_mrr * row.gm
  row.base_ltv = row.base_gp_month * row.lifetime
  row.base_ltv_cac = row.base_ltv / row.cac
  return row
}

// ---------------------------------------------------------------------------
// Cash position and runway (CB-05)
// ---------------------------------------------------------------------------
const RESTRICTED_WORDS = ['restricted', 'collateral', 'escrow', 'letter of credit', 'pledged']
const DEMO_BANK_NAMES = new Set(['checking', 'savings'])
export const CASH_CATEGORIES: Dict = { unrestricted: 'Unrestricted cash', restricted: 'Restricted cash (not in runway)', exclude: 'Exclude (not cash)' }

export function suggestCashCategory(name: string, section: string | null, hasNamedBanks: boolean): [string, string] {
  const low = (name || '').toLowerCase()
  if (section === 'BankAccounts' && (RESTRICTED_WORDS.some((w) => low.includes(w)) || accountNumber(name) === 1030)) {
    return ['restricted', 'restricted / collateral cash (1030) - not counted in cash or runway']
  }
  const [ok, reason] = suggestCashAccount(name, section, hasNamedBanks)
  return [ok ? 'unrestricted' : 'exclude', reason]
}

export function suggestCashAccount(name: string, section: string | null, hasNamedBanks: boolean): [boolean, string] {
  const low = (name || '').toLowerCase()
  const n = accountNumber(name)
  if (section !== 'BankAccounts') return [false, 'not a bank account']
  if (RESTRICTED_WORDS.some((w) => low.includes(w)) || n === 1030) return [false, 'restricted cash - excluded (spec CB-05)']
  if (hasNamedBanks && DEMO_BANK_NAMES.has(low.trim())) return [false, 'QuickBooks sandbox sample account']
  if (n !== null && n >= 1010 && n <= 1029) return [true, 'unrestricted cash (1010-1029)']
  return [true, 'bank account - unrestricted']
}

export function bsAccounts(snaps: Dict[]): Dict[] {
  const acc = new Map<string, Dict>()
  for (const d of sortedBy(snaps, (x) => [x.month])) {
    for (const a of (or(d.accounts, []) as Dict[])) {
      const x = getOr(acc, pyStr(a.id), () => ({ id: pyStr(a.id), name: or(a.name, ''), section: a.section ?? null }))
      x.name = or(a.name, x.name)
      x.section = or(a.section, x.section)
      x.latest = num(a.amount)
      x.latest_month = d.month
    }
  }
  return Array.from(acc.values())
}

export function cashSeries(snaps: Dict[], sections: string[], lookback: number, lastClosed: string | null,
  accountIds: Set<string> | null = null, restrictedAdjust = 0.0, restrictedIds: Set<string> | null = null): Dict[] {
  const by = new Map<string, Dict>()
  for (const d of snaps) {
    const st = (or(d.sectionTotals, {}) as Dict)
    const accts = (or(d.accounts, []) as Dict[])
    const bankTotal = num((or(st.BankAccounts, {}) as Dict).Total)
    let cash: number, restricted: number, mode: string
    if (truthy(accts) && accountIds !== null) {
      cash = sum(accts.filter((a) => accountIds.has(pyStr(a.id))).map((a) => num(a.amount)))
      restricted = sum(accts.filter((a) => (restrictedIds ?? new Set()).has(pyStr(a.id))).map((a) => num(a.amount)))
      mode = 'accounts'
    } else {
      cash = sum(sections.map((k) => num((or(st[k], {}) as Dict).Total))) - (restrictedAdjust || 0)
      restricted = restrictedAdjust || 0.0
      mode = 'sections'
    }
    const ar = (or(st.AR, {}) as Dict).Total
    by.set(d.month, {
      month: d.month, as_of: d.asOfDate ?? null, cash, mode, restricted,
      bank_total: bankTotal, other_bank: bankTotal - cash,
      accounts: accts, ar: ar !== null && ar !== undefined ? Number(ar) : null, raw: st
    })
  }
  const months = sortedStr(by.keys())
  const rows: Dict[] = []
  for (const m of months) {
    const r: Dict = { ...by.get(m)! }
    const prev = by.get(addMonths(m, -1))
    const back = by.get(addMonths(m, -lookback))
    r.change = prev ? r.cash - prev.cash : null
    r.avg_decline = back ? (back.cash - r.cash) / lookback : null
    r.self_funding = r.avg_decline !== null && r.avg_decline <= 0
    r.runway = r.avg_decline && r.avg_decline > 0 ? r.cash / r.avg_decline : null
    r.ar_negative = r.ar !== null && r.ar < 0
    r.cash_ex_excess = r.ar_negative ? r.cash + r.ar : r.cash
    r.closed = truthy(lastClosed) && m <= lastClosed!
    r.stale = !!prev && deepEqual(r.raw, prev.raw)
    delete r.accounts
    rows.push(r)
  }
  return rows
}

// ---------------------------------------------------------------------------
// FCF conversion (CB-07)
// ---------------------------------------------------------------------------
export const CAPEX_CATEGORIES: Dict = { capex: 'Capex (purchases)', accum: 'Accumulated depreciation / amortization', exclude: 'Exclude (not capex)' }
const CAPEX_SECTIONS = ['FixedAssets', 'OtherAssets']

export function suggestCapexCategory(name: string, section: string | null, numberedChart: boolean): [string, string] {
  const low = (name || '').toLowerCase()
  const n = accountNumber(name)
  if (['accumulated', 'depreciation', 'amortization'].some((w) => low.includes(w))) return ['accum', 'accumulated depreciation / amortization - moves with D&A, not purchases']
  if (numberedChart && n === null) return ['exclude', 'no account number - QuickBooks sandbox/demo asset']
  if (section === 'FixedAssets') return ['capex', 'fixed asset cost - purchases are capex' + (n && n >= 1500 && n < 1590 ? ' (1510-1589)' : '')]
  return ['exclude', 'other asset (intangibles, deposits) - not capex by default']
}

export function capexAccounts(snaps: Dict[]): Dict[] {
  return bsAccounts(snaps).filter((a) => CAPEX_SECTIONS.includes(a.section))
}

export function suggestFaDa(name: string): boolean {
  return !(name || '').toLowerCase().includes('intangible') && accountNumber(name) !== 6520
}

export const WC_CATEGORIES: Dict = {
  ar: 'AR (accounts receivable)', prepaid: 'Prepaid', inventory: 'Inventory',
  ap: 'AP (accounts payable)', credit_card: 'Credit card', accrued: 'Accrued',
  deferred_revenue: 'Deferred revenue', exclude: 'Exclude (not working capital)'
}
export const WC_ASSET_CATS = ['ar', 'prepaid', 'inventory']
export const WC_LIAB_CATS = ['ap', 'credit_card', 'accrued', 'deferred_revenue']
export const WC_SECTIONS = ['AR', 'OtherCurrentAssets', 'AP', 'CreditCards', 'OtherCurrentLiabilities']

export function suggestWcCategory(name: string, section: string | null): [string, string] {
  const low = (name || '').toLowerCase()
  if (section === 'AR') return ['ar', 'accounts receivable']
  if (section === 'AP') return ['ap', 'accounts payable']
  if (section === 'CreditCards') return ['credit_card', 'credit card']
  if (section === 'OtherCurrentAssets') {
    if (low.includes('prepaid')) return ['prepaid', 'prepaid expenses']
    if (low.includes('inventory')) return ['inventory', 'inventory']
    if (low.includes('receivable') && !low.includes('undeposited')) return ['ar', 'other receivable']
    return ['exclude', "other current asset - not in the spec's working capital (e.g. undeposited funds)"]
  }
  if (section === 'OtherCurrentLiabilities') {
    if (low.includes('deferred revenue') || low.includes('unearned') || low.includes('deferred income')) return ['deferred_revenue', 'deferred revenue']
    if (low.includes('accrued') || low.includes('accrual')) return ['accrued', 'accrued expenses']
    return ['exclude', "sales tax, loans, payroll and other liabilities - not in the spec's working capital"]
  }
  return ['exclude', 'not a current asset / liability']
}

export function fcfSeries(pl: PlTable, snaps: Dict[], catMap: Dict, daIds: Set<string>, lastClosed: string | null,
  capexIds: Set<string> | null, capexSections: string[], faDaIds: Set<string>,
  wcMap: Dict | null, wcSectionMap: Dict): Dict[] {
  const bs = new Map<string, Dict>()
  for (const d of snaps) bs.set(d.month, d)
  const ok = (m: string) => bs.has(m) && (!lastClosed || m <= lastClosed)
  const hasAccts = bs.size > 0 && Array.from(bs.values()).every((d) => truthy(d.accounts))
  const perAccount = capexIds !== null && hasAccts
  const wcAccounts = wcMap !== null && hasAccts

  const sec = (m: string, keys: string[]) => {
    const st = (or(bs.get(m)!.sectionTotals, {}) as Dict)
    return sum(keys.map((k) => num((or(st[k], {}) as Dict).Total)))
  }
  const acc = (m: string): Map<string, number> => {
    const out = new Map<string, number>()
    for (const a of (or(bs.get(m)!.accounts, []) as Dict[])) out.set(pyStr(a.id), num(a.amount))
    return out
  }
  const wcParts = (m: string): Dict => {
    const parts: Dict = {}
    for (const k of Object.keys(WC_CATEGORIES)) if (k !== 'exclude') parts[k] = 0.0
    if (wcAccounts) {
      for (const [i, v] of acc(m)) {
        const c = wcMap![i]
        if (c in parts) parts[c] += v
      }
    } else {
      for (const [k, c] of Object.entries(wcSectionMap)) if (c in parts) parts[c] += sec(m, [k])
    }
    return parts
  }
  const wcTotal = (parts: Dict) => sum(WC_ASSET_CATS.map((c) => parts[c])) - sum(WC_LIAB_CATS.map((c) => parts[c]))

  const monthly = new Map<string, Dict>()
  for (const m of sortedStr(bs.keys())) {
    const p = addMonths(m, -1)
    if (!ok(m) || !bs.has(p) || !pl.has(m)) continue
    if (deepEqual(or(bs.get(m)!.sectionTotals, {}), or(bs.get(p)!.sectionTotals, {}))) continue
    const e = ebitdaPeriod(pl, [m], catMap, daIds)
    const w1 = wcParts(m), w0 = wcParts(p)
    const dparts: Dict = {}
    for (const k of Object.keys(w1)) dparts[k] = w1[k] - w0[k]
    const dwc = wcTotal(w1) - wcTotal(w0)
    const dar = dparts.ar
    let capex: number
    let lines: Dict
    if (perAccount) {
      const a1 = acc(m), a0 = acc(p)
      lines = {}
      for (const i of capexIds!) lines[i] = (a1.get(i) ?? 0.0) - (a0.get(i) ?? 0.0)
      capex = sum(Object.values(lines) as number[])
    } else {
      lines = {}
      const plm = pl.get(m)!
      const faDa = sum([...plm.rc_lines, ...plm.lines].filter(([, aid]) => faDaIds.has(aid)).map(([, , , amt]) => amt))
      capex = sec(m, capexSections) - sec(p, capexSections) + faDa
    }
    const ocf = e.net_income + e.da - dwc
    monthly.set(m, {
      month: m, ni: e.net_income, da: e.da, ebitda: e.ebitda, revenue: e.revenue, dwc, dar, ocf, capex,
      fcf: ocf - capex, capex_lines: lines, dwc_parts: dparts, wc: w1
    })
  }
  const rows: Dict[] = []
  for (const m of sortedStr(monthly.keys())) {
    const r: Dict = { ...monthly.get(m)! }
    const win: string[] = []
    for (let k = 0; k < 12; k++) win.push(addMonths(m, -k))
    r.window = [...win].reverse()
    r.ttm_ok = win.every((w) => monthly.has(w))
    if (r.ttm_ok) {
      const t: Dict = {}
      for (const k of ['ni', 'da', 'ebitda', 'revenue', 'dwc', 'dar', 'ocf', 'capex', 'fcf']) t[k] = sum(win.map((w) => monthly.get(w)![k]))
      for (const [k, v] of Object.entries(t)) r['t_' + k] = v
      const tp: Dict = {}
      for (const k of Object.keys(r.dwc_parts)) tp[k] = sum(win.map((w) => monthly.get(w)!.dwc_parts[k]))
      r.t_dwc_parts = tp
      r.fcf_pct = t.ebitda ? (100 * t.fcf) / t.ebitda : null
      r.t_ocf_x_ar = t.ocf + t.dar
      r.fcf_pct_x_ar = t.ebitda ? (100 * (r.t_ocf_x_ar - t.capex)) / t.ebitda : null
    }
    r.m_fcf_pct = r.ebitda ? (100 * r.fcf) / r.ebitda : null
    r.mode = perAccount ? 'accounts' : 'sections'
    r.wc_mode = wcAccounts ? 'accounts' : 'sections'
    rows.push(r)
  }
  return rows
}

// ---------------------------------------------------------------------------
// Cash conversion cycle (CB-10)
// ---------------------------------------------------------------------------
export const CCC_CATEGORIES: Dict = { ar: 'AR (accounts receivable)', inventory: 'Inventory', ap: 'AP (accounts payable)', exclude: 'Exclude' }
export const CCC_SECTIONS = ['AR', 'OtherCurrentAssets', 'AP', 'CreditCards', 'OtherCurrentLiabilities']

export function suggestCccCategory(name: string, section: string | null): [string, string] {
  const low = (name || '').toLowerCase()
  const n = accountNumber(name)
  if (section === 'AR' || n === 1100 || n === 1105) return ['ar', 'accounts receivable (1100 / 1105)']
  if (low.includes('inventory') || n === 1300) return ['inventory', 'inventory (1300)']
  if (section === 'AP' || n === 2000) return ['ap', 'accounts payable (2000)']
  return ['exclude', 'not AR, inventory or AP']
}

const daysInMonth = (m: string) => new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 0)).getUTCDate()

export function cccSeries(pl: PlTable, snaps: Dict[], catMap: Dict, daIds: Set<string>, lastClosed: string | null,
  cccMap: Dict | null, sectionMap: Dict, includeDa = true): Dict[] {
  const bs = new Map<string, Dict>()
  for (const d of snaps) bs.set(d.month, d)
  const hasAccts = bs.size > 0 && Array.from(bs.values()).every((d) => truthy(d.accounts))
  const perAccount = cccMap !== null && hasAccts

  const bal = (m: string): Dict => {
    const out: Dict = { ar: 0.0, inventory: 0.0, ap: 0.0 }
    if (perAccount) {
      for (const a of (or(bs.get(m)!.accounts, []) as Dict[])) {
        const c = cccMap![pyStr(a.id)]
        if (c in out) out[c] += num(a.amount)
      }
    } else {
      const st = (or(bs.get(m)!.sectionTotals, {}) as Dict)
      for (const [k, c] of Object.entries(sectionMap)) if (c in out) out[c] += num((or(st[k], {}) as Dict).Total)
    }
    return out
  }

  const hasInv = perAccount ? Object.values(cccMap!).includes('inventory') : Object.values(sectionMap).includes('inventory')
  const rows: Dict[] = []
  for (const e of sortedStr(bs.keys())) {
    if (lastClosed && e > lastClosed) continue
    const p = addMonths(e, -1)
    if (bs.has(p) && deepEqual(or(bs.get(e)!.sectionTotals, {}), or(bs.get(p)!.sectionTotals, {}))) continue
    const win = [addMonths(e, -2), addMonths(e, -1), e]
    if (!win.every((m) => pl.has(m) && truthy(pl.get(m)!.revenue))) continue
    const r = ebitdaPeriod(pl, win, catMap, daIds)
    let cogsDa = 0.0
    for (const m of win) for (const [, aid, , amt] of pl.get(m)!.rc_lines) if (catMap[aid] === 'cogs' && daIds.has(aid)) cogsDa += amt
    const cogs = includeDa ? r.cogs : r.cogs - cogsDa
    const D = sum(win.map(daysInMonth))
    const b = bal(e)
    const dso = r.revenue ? (b.ar / r.revenue) * D : null
    const dio = cogs && hasInv ? (b.inventory / cogs) * D : null
    const dpo = cogs ? (b.ap / cogs) * D : null
    const ccc = dso !== null && dpo !== null ? (dso || 0) + (dio || 0) - (dpo || 0) : null
    const mo = Number(e.slice(5, 7))
    rows.push({
      month: e, window: win, days: D, revenue: r.revenue, cogs,
      cogs_total: r.cogs, cogs_da: cogsDa, ar: b.ar, inventory: b.inventory,
      ap: b.ap, dso, dio, dpo, ccc,
      wc: b.ar + b.inventory - b.ap, quarter_end: mo % 3 === 0,
      label: mo % 3 === 0 ? `Q${Math.floor(mo / 3)}-${e.slice(0, 4)}` : e,
      has_inv: hasInv, mode: perAccount ? 'accounts' : 'sections',
      ar_negative: b.ar < 0
    })
  }
  return rows
}

// ---------------------------------------------------------------------------
// Customer concentration (CM-02)
// ---------------------------------------------------------------------------
export function customerGroups(qboCustomers: Dict[], sfAccounts: Dict[], links: Map<string, Dict>, groupParent: boolean): Map<string, Dict> {
  const sf = new Map<string, Dict>()
  for (const a of sfAccounts) sf.set(pyStr(a.providerRecordId), a)
  const qb = new Map<string, Dict>()
  for (const c of qboCustomers) qb.set(pyStr(c.providerRecordId), c)

  const sfTop = (a: Dict): Dict => {
    const seen = new Set<unknown>()
    while (truthy(a.parentRecordId) && sf.has(pyStr(a.parentRecordId)) && !seen.has(a.providerRecordId)) {
      seen.add(a.providerRecordId)
      a = sf.get(pyStr(a.parentRecordId))!
    }
    return a
  }
  const qbTop = (c: Dict): Dict => {
    const seen = new Set<unknown>()
    while (truthy(c.parentRecordId) && qb.has(pyStr(c.parentRecordId)) && !seen.has(c.providerRecordId)) {
      seen.add(c.providerRecordId)
      c = qb.get(pyStr(c.parentRecordId))!
    }
    return c
  }

  const out = new Map<string, Dict>()
  for (const cid of new Set([...qb.keys(), ...links.keys()])) {
    const c = qb.get(cid) ?? {}
    const name = or(or(c.displayName, (links.get(cid) ?? {}).customer_name), `Customer ${cid}`)
    out.set(cid, { key: 'qb:' + cid, name, how: 'itself' })
    if (!groupParent) continue
    const acct = (links.get(cid) ?? {}).account
    if (truthy(acct)) {
      const top = sfTop(acct)
      out.set(cid, { key: 'sf:' + pyStr(top.providerRecordId), name: or(top.name, name), how: top !== acct ? 'Salesforce parent' : 'Salesforce account' })
    } else if (truthy(c.parentRecordId) && qb.has(pyStr(c.parentRecordId))) {
      const top = qbTop(c)
      out.set(cid, { key: 'qb:' + pyStr(top.providerRecordId), name: or(top.displayName, name), how: 'QuickBooks parent' })
    }
  }
  return out
}

export const NO_CLASS = 'No class'

export function invoiceClasses(invoices: Dict[]): string[] {
  const found = new Set<string>()
  let blank = false
  for (const inv of invoices) {
    for (const l of (or(inv.lines, []) as Dict[])) {
      if (truthy(l.className)) found.add(l.className)
      else if (truthy(l.amount)) blank = true
    }
  }
  return [...sortedStr(found), ...(blank ? [NO_CLASS] : [])]
}

export function concentrationSeries(invoices: Dict[], mapping: Dict, settings: Dict, groups: Map<string, Dict>,
  topN = 10, line: string | null = null): Dict[] {
  const earlyDay = Math.trunc(Number(or(settings.early_invoice_day, 16)))
  const cad = new Set<string>((or(settings.cad_countries, []) as string[]).map((c) => c.toUpperCase()))
  const rates = (or(settings.fx_cad_usd, {}) as Dict)
  const rec = new Map<string, Map<string, number>>()
  const billed = new Map<string, Map<string, number>>()
  let first = null as string | null
  for (const inv of invoices) {
    const cust = String(or(inv.customerRecordId, ''))
    const date = toDateStr(inv.txnDate)
    if (!cust || date.length < 10) continue
    const m = date.slice(0, 7)
    if (first === null || m < (first as string)) first = m
    const country = String(or((or(inv.billingAddress, {}) as Dict).country, '')).toUpperCase()
    const fx = cad.has(country) ? fxFor(m, rates) : 1.0
    const g = (groups.get(cust) ?? { key: 'qb:' + cust }).key
    if (line === null) {
      let total = inv.totalAmount
      if (total === null || total === undefined) total = sum((or(inv.lines, []) as Dict[]).map((l) => num(l.amount)))
      add2(billed, m, g, num(total) * fx)
    }
    for (const l of (or(inv.lines, []) as Dict[])) {
      const item = String(or(l.itemId, ''))
      const amt = num(l.amount) * fx
      if (!amt || (line && or(l.className, NO_CLASS) !== line)) continue
      if (mapping[item] === 'subscription_yearly') {
        const start = Number(date.slice(8, 10)) >= earlyDay ? addMonths(m, 1) : m
        for (let k = 0; k < 12; k++) add2(rec, addMonths(start, k), g, amt / 12)
      } else {
        add2(rec, m, g, amt)
      }
    }
  }
  if (!first) return []
  const last = maxStr(billed.size ? billed.keys() : rec.keys())!
  const names = new Map<string, string>()
  for (const x of groups.values()) if (!names.has(x.key)) names.set(x.key, x.name)
  const nameOf = (g: string) => names.get(g) ?? 'Customer ' + g.split(':').slice(1).join(':')
  const rows: Dict[] = []
  for (const e of monthRange(addMonths(first, 11), last)) {
    const win: string[] = []
    for (let k = 0; k < 12; k++) win.push(addMonths(e, -k))
    const tot = new Map<string, number>()
    const invTot = new Map<string, number>()
    for (const m of win) {
      for (const [g, v] of rec.get(m) ?? []) tot.set(g, (tot.get(g) ?? 0) + v)
      for (const [g, v] of billed.get(m) ?? []) invTot.set(g, (invTot.get(g) ?? 0) + v)
    }
    const T = sum(tot.values())
    if (T <= 0) continue
    // Python: sorted(((v, g) ...), reverse=True) -> by value desc, then group key desc
    const ranked = Array.from(tot.entries()).filter(([, v]) => v > 0).map(([g, v]) => [v, g] as [number, string])
      .sort((a, b) => (b[0] - a[0]) || (b[1] > a[1] ? 1 : b[1] < a[1] ? -1 : 0))
    const bt = Array.from(invTot.values()).filter((v) => v > 0).sort((a, b) => b - a)
    const BT = sum(invTot.values())
    const top = sum(ranked.slice(0, topN).map(([v]) => v))
    rows.push({
      month: e, window: [...win].reverse(), total: T, groups: ranked.length, top_n: topN,
      top, share: (100 * top) / T,
      largest: ranked.length ? (100 * ranked[0][0]) / T : null,
      largest_name: ranked.length ? nameOf(ranked[0][1]) : null,
      inv_share: BT && line === null ? (100 * sum(bt.slice(0, topN))) / BT : null,
      ranking: ranked.slice(0, Math.max(topN, 25)).map(([v, g]) => ({ key: g, name: nameOf(g), revenue: v, share: (100 * v) / T }))
    })
  }
  return rows
}

// ---------------------------------------------------------------------------
// Win rate vs tracked competitor (CM-03)
// ---------------------------------------------------------------------------
export const STD_COMPETITOR = '@competitor'
export const STD_COMPETITORS = '@competitors'

export function dealField(deal: Dict, field: string | null | undefined): unknown {
  if (!field) return null
  if (field === STD_COMPETITOR) return or(deal.competitor, null)
  if (field === STD_COMPETITORS) {
    const xs = ((or(deal.competitors, []) as unknown[]).filter((c) => truthy(c)))
    return xs.length ? xs : null
  }
  const want = field.trim().toLowerCase()
  for (const f of (or(deal.customFields, []) as Dict[])) {
    if (String(or(f.label, '')).trim().toLowerCase() === want) {
      const v = f.value
      return v === null || v === undefined || v === '' ? null : v
    }
  }
  return null
}

export function suggestCompetitorField(labels: string[], hasStd: boolean, hasMulti: boolean): string | null {
  for (const l of labels) if (l.toLowerCase().includes('competitor')) return l
  return hasStd ? STD_COMPETITOR : hasMulti ? STD_COMPETITORS : null
}

export function suggestLossReasonField(labels: string[]): string | null {
  for (const l of labels) {
    const low = l.toLowerCase()
    if ((low.includes('loss') && low.includes('reason')) || low === 'reason lost' || low === 'closed lost reason') return l
  }
  return null
}

export function suggestNewBusinessTypes(types: string[]): string[] {
  return types.filter((t) => truthy(t) && ['newbusiness', 'new', 'newlogo'].includes(t.replace(/ /g, '').replace(/_/g, '').toLowerCase()))
}

export function dealOutcome(deal: Dict, wonKeys: Set<string>, closedKeys: Set<string>): string | null {
  const stage = String(or(deal.dealstage, ''))
  const key = `${pyStr(deal.pipeline)}::${stage}`
  if (closedKeys.size) {
    if (!closedKeys.has(key)) return null
    return wonKeys.has(key) ? 'won' : 'lost'
  }
  const low = stage.replace(/ /g, '').toLowerCase()
  if (low === 'closedwon' || low === 'won') return 'won'
  if (low === 'closedlost' || low === 'lost') return 'lost'
  return null
}

export function winRateSeries(deals: Dict[], compField: string | null, lossField: string | null, excludeReasons: string[],
  nbTypes: Set<string>, wonKeys: Set<string>, closedKeys: Set<string>, window = 6,
  segmentOf: ((d: Dict) => unknown) | null = null, segment: string | null = null): [Dict[], string[]] {
  const excl = new Set(excludeReasons.filter((r) => r.trim()).map((r) => r.trim().toLowerCase()))
  const closed: Dict[] = []
  for (const d of deals) {
    if (!nbTypes.has(String(or(d.type, '')))) continue
    const out = dealOutcome(d, wonKeys, closedKeys)
    if (!out) continue
    const m = toDateStr(d.closedate).slice(0, 7)
    if (m.length < 7) continue
    if (segment && (segmentOf ? segmentOf(d) : null) !== segment) continue
    const comp = dealField(d, compField)
    const comps = Array.isArray(comp) ? (comp as unknown[]).map((c) => c as string) : truthy(comp) ? [pyStr(comp)] : []
    const reason = lossField ? dealField(d, lossField) : null
    const noDecision = out === 'lost' && reason !== null && excl.has(pyStr(reason).trim().toLowerCase())
    closed.push({ m, won: out === 'won', comps, no_decision: noDecision, name: d.dealname, account: d.accountName, reason })
  }
  if (!closed.length) return [[], []]
  const count = new Map<string, number>()
  for (const x of closed) for (const c of x.comps) count.set(c, (count.get(c) ?? 0) + 1)
  const competitors = sortedBy(count.keys(), (c) => [-count.get(c)!, c])
  const months = sortedStr(new Set(closed.map((x) => x.m)))
  const rows: Dict[] = []
  for (const e of monthRange(addMonths(months[0], window - 1), months[months.length - 1])) {
    const win = new Set<string>()
    for (let k = 0; k < window; k++) win.add(addMonths(e, -k))
    const w = closed.filter((x) => win.has(x.m))
    if (!w.length) continue
    const r: Dict = { month: e, window: [addMonths(e, -(window - 1)), e], closed: w.length, logged_n: w.filter((x) => x.comps.length).length, comp: {} }
    r.logged = (100 * r.logged_n) / w.length
    for (const c of competitors) {
      const cx = w.filter((x) => x.comps.includes(c))
      const dec = cx.filter((x) => !x.no_decision)
      const won = dec.filter((x) => x.won).length
      r.comp[c] = { deals: cx.length, decided: dec.length, won, no_decision: cx.length - dec.length, rate: dec.length ? (100 * won) / dec.length : null }
    }
    rows.push(r)
  }
  return [rows, competitors]
}

// ---------------------------------------------------------------------------
// Funnel conversion (CM-06)
// ---------------------------------------------------------------------------
export const FUNNEL_STEPS: Dict = { m2s: 'MQL to SQL', l2m: 'Lead to MQL', s2w: 'SQL to won', s2o: 'SQL to opportunity', o2w: 'Opportunity to won' }
const NON_MARKETING_SOURCES = ['OFFLINE']

export function suggestMarketingSources(sources: string[]): string[] {
  return sources.filter((x) => truthy(x) && !NON_MARKETING_SOURCES.includes(x.toUpperCase()))
}

export function funnelContacts(contacts: Dict[], leadStage: string, mqlStage: string, sqlStage: string, wonIds: Set<string>,
  oppStage = 'opportunity'): Dict[] {
  const out: Dict[] = []
  for (const c of contacts) {
    const hist = (or(c.lifecycleStageHistory, []) as Dict[]).filter((h) => truthy(h.value) && truthy(h.timestamp))
    const dates = new Map<string, string>()
    for (const h of hist) {
      const t = toDateStr(h.timestamp)
      if (!dates.has(h.value) || t < dates.get(h.value)!) dates.set(h.value, t)
    }
    const created = String(or(or(toDateStr(c.leadCreatedAt), dates.get(leadStage)), dates.size ? minStr(dates.values()) : ''))
    const id = pyStr(c.providerRecordId)
    out.push({
      id, email: String(or(c.email, '')).trim().toLowerCase(),
      src: c.analyticsSource ?? null, created: created.slice(0, 10), mql: String(or(dates.get(mqlStage), '')).slice(0, 10),
      sql: String(or(dates.get(sqlStage), '')).slice(0, 10), opp: String(or(dates.get(oppStage), '')).slice(0, 10),
      won: wonIds.has(id)
    })
  }
  return out
}

export function funnelSeries(rows: Dict[], marketing: Set<string>, dedupe: boolean, cutoff: string, matureDays: number[],
  start: string, end: string, sqlViaMql = true): Dict[] {
  const defaults = [60, 90, 180, 60, 180]
  const md = [...matureDays, ...defaults.slice(matureDays.length)].slice(0, 5)
  const seen = new Set<string>()
  const leads: Dict[] = []
  for (const r of sortedBy(rows, (x) => [or(x.created, '9999')])) {
    if (!r.created || !marketing.has(r.src)) continue
    if (dedupe && r.email) {
      if (seen.has(r.email)) continue
      seen.add(r.email)
    }
    leads.push(r)
  }
  const by = new Map<string, Dict>()
  const bucket = (m: string) => getOr(by, m, () => ({ mql: 0, m2s: 0, lead: 0, l2m: 0, sql: 0, s2w: 0, s2o: 0, opp: 0, o2w: 0 }))
  for (const r of rows) {
    if (r.mql) {
      const b = bucket(r.mql.slice(0, 7))
      b.mql += 1
      b.m2s += r.sql ? 1 : 0
    }
    if (r.sql && (sqlViaMql ? !!r.mql : marketing.has(r.src))) {
      const b = bucket(r.sql.slice(0, 7))
      b.sql += 1
      b.s2w += r.won ? 1 : 0
      if (r.opp) {
        b.s2o += 1
        b.opp += 1
        b.o2w += r.won ? 1 : 0
      }
    }
  }
  for (const r of leads) {
    const b = bucket(r.created.slice(0, 7))
    b.lead += 1
    b.l2m += r.mql ? 1 : 0
  }
  const cut = Date.UTC(Number(cutoff.slice(0, 4)), Number(cutoff.slice(5, 7)) - 1, Number(cutoff.slice(8, 10)))
  const out: Dict[] = []
  for (const m of monthRange(start, end)) {
    const monthEnd = Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 0)
    const age = Math.round((cut - monthEnd) / 86400000)
    out.push({
      month: m, ...bucket(m), age,
      immature: { m2s: age < md[0], l2m: age < md[1], s2w: age < md[2], s2o: age < md[3], o2w: age < md[4] }
    })
  }
  return out
}

export function funnelRate(rows: Dict[]): Dict {
  const t: Dict = {}
  for (const k of ['mql', 'm2s', 'lead', 'l2m', 'sql', 's2w', 's2o', 'opp', 'o2w']) t[k] = sum(rows.map((r) => r[k]))
  t.m2s_pct = t.mql ? (100 * t.m2s) / t.mql : null
  t.l2m_pct = t.lead ? (100 * t.l2m) / t.lead : null
  t.s2w_pct = t.sql ? (100 * t.s2w) / t.sql : null
  t.s2o_pct = t.sql ? (100 * t.s2o) / t.sql : null
  t.o2w_pct = t.opp ? (100 * t.o2w) / t.opp : null
  const imm: Dict = {}
  for (const k of Object.keys(FUNNEL_STEPS)) imm[k] = rows.some((r) => r.immature[k])
  t.immature = imm
  return t
}

// ---------------------------------------------------------------------------
// Lead volume vs plan (CM-08)
// ---------------------------------------------------------------------------
export const quarterKey = (month: string): string => `${month.slice(0, 4)}-Q${Math.floor((Number(month.slice(5, 7)) - 1) / 3) + 1}`

export function mqlVsPlan(mqlMonths: string[], planQuarters: Dict, months: string[], grain: string, view: string): Dict[] {
  const count = new Map<string, number>()
  for (const m of mqlMonths) count.set(m.slice(0, 7), (count.get(m.slice(0, 7)) ?? 0) + 1)
  const monthPlan = new Map<string, number | null>()
  for (const m of months) {
    const q = planQuarters[quarterKey(m)]
    monthPlan.set(m, q !== null && q !== undefined ? q / 3 : null)
  }
  const rows: Dict[] = []
  for (const m of months) {
    if (grain === 'quarter' && Number(m.slice(5, 7)) % 3) continue
    const k = view === 'ttm' ? 12 : grain === 'quarter' ? 3 : 1
    const win: string[] = []
    for (let i = k - 1; i >= 0; i--) win.push(addMonths(m, -i))
    if (win.some((w) => !monthPlan.has(w))) continue
    const plans = win.map((w) => monthPlan.get(w)!)
    const mqls = sum(win.map((w) => count.get(w) ?? 0))
    const plan = plans.every((p) => p !== null) ? sum(plans as number[]) : null
    rows.push({
      month: m, window: [win[0], win[win.length - 1]], mqls, plan,
      diff: plan !== null ? mqls - plan : null,
      pct: plan ? 100 * (mqls / plan - 1) : null,
      label: grain === 'quarter' ? `Q${Math.floor(Number(m.slice(5, 7)) / 3)}-${m.slice(0, 4)}` : m,
      months: win.map((w) => ({ month: w, mqls: count.get(w) ?? 0, plan: monthPlan.get(w) }))
    })
  }
  return rows
}

// ---------------------------------------------------------------------------
// Marketing ROI by channel (CM-07)
// ---------------------------------------------------------------------------
const ROI_SOURCE_WORDS = ['paid', 'organic', 'review', 'webinar', 'web', 'trade show', 'event', 'social', 'content',
  'seo', 'ppc', 'advert', 'email', 'download', 'search', 'conference', 'ad ']
const ROI_NOT_MARKETING = ['outbound', 'partner', 'referral', 'sdr', 'prospect', 'existing', 'customer']

export function suggestRoiSources(sources: string[]): string[] {
  const out: string[] = []
  for (const s of sources) {
    const low = (s || '').toLowerCase()
    if (!low || ROI_NOT_MARKETING.some((w) => low.includes(w))) continue
    if (ROI_DEFAULT_SOURCES.includes(s) || ROI_SOURCE_WORDS.some((w) => low.includes(w))) out.push(s)
  }
  return out
}

function acctNo(name: string): string {
  const m = /^\s*(\d{3,6})(?![\p{L}\p{N}_])/u.exec(name || '')
  return m ? m[1] : ''
}

export function suggestRoiAccounts(accounts: [string, string][]): [string[], string[]] {
  const blended: string[] = []
  const programs: string[] = []
  const numbered = accounts.some(([, n]) => acctNo(n).slice(0, 2) === '61' && acctNo(n).length === 4)
  for (const [aid, name] of accounts) {
    const low = (name || '').toLowerCase()
    const no = acctNo(name)
    const mk = numbered
      ? no.slice(0, 2) === '61' && no.length === 4
      : ['marketing', 'advertis', 'sponsorship', 'content & creative', 'demand gen'].some((w) => low.includes(w))
    if (mk && !low.includes('sales')) {
      blended.push(aid)
      if (!['salar', 'payroll', 'wage', 'benefit', 'bonus', 'commission', 'headcount'].some((w) => low.includes(w))) programs.push(aid)
    }
  }
  return [blended, programs]
}

export function roiAccountMatch(aid: string, name: string, keys: unknown[]): boolean {
  for (const k0 of keys || []) {
    const k = String(k0).trim()
    if (k && (k === aid || k === name || k === acctNo(name))) return true
  }
  return false
}

export function roiDealRows(deals: Dict[], valueField: string, nbTypes: Set<string>, sources: Set<string>): Dict[] {
  const rows: Dict[] = []
  for (const d of deals) {
    if (!nbTypes.has(d.type)) continue
    const src = String(or(d.leadSource, ''))
    if (!sources.has(src)) continue
    const created = toDateStr(or(d.dealCreatedAt, d.createdDate))
    if (!created) continue
    let v = d[valueField]
    if ((v === null || v === undefined) && valueField !== 'amount') v = d.amount
    rows.push({
      month: created.slice(0, 7), date: created, value: num(v), source: src,
      campaign: or(d.campaignName, ''), name: or(d.dealname, ''),
      stage: or(d.dealstage, ''), account: or(d.accountName, ''),
      has_value_field: d[valueField] !== null && d[valueField] !== undefined
    })
  }
  return rows
}

export const roiChannelOf = (row: Dict, channel: Dict): boolean => ((or(channel.sources, []) as string[]).includes(row.source))

export function roiSeries(rows: Dict[], gl: Map<string, [string, string, number][]>, blendedIds: Set<string>, programsIds: Set<string>,
  channels: Dict[], months: string[], grain: string, view: string): Dict[] {
  const byM = new Map<string, Dict[]>()
  for (const r of rows) getOr(byM, r.month, () => []).push(r)
  const glSum = (m: string, pred: (aid: string, name: string) => boolean): number | null =>
    gl.has(m) ? sum(gl.get(m)!.filter(([aid, name]) => pred(aid, name)).map(([, , a]) => a)) : null
  const monthSet = new Set(months)
  const out: Dict[] = []
  for (const m of months) {
    if (grain === 'quarter' && Number(m.slice(5, 7)) % 3) continue
    const k = view === 'ttm' ? 12 : grain === 'quarter' ? 3 : 1
    const win: string[] = []
    for (let i = k - 1; i >= 0; i--) win.push(addMonths(m, -i))
    if (win.some((w) => !monthSet.has(w))) continue
    const deals = win.flatMap((w) => byM.get(w) ?? [])
    const pipe = sum(deals.map((r) => r.value))
    const haveGl = win.every((w) => gl.has(w))
    const bl = haveGl ? sum(win.map((w) => glSum(w, (a) => blendedIds.has(a)) || 0)) : null
    const pr = haveGl ? sum(win.map((w) => glSum(w, (a) => programsIds.has(a)) || 0)) : null
    const chans: Dict[] = []
    for (const c of channels) {
      const cd = deals.filter((r) => roiChannelOf(r, c))
      const cp = sum(cd.map((r) => r.value))
      const keys = (or(c.gl_accounts, []) as string[])
      const sp = haveGl && keys.length ? sum(win.map((w) => glSum(w, (a, n) => roiAccountMatch(a, n, keys)) || 0)) : null
      chans.push({ name: c.name, pipeline: cp, deals: cd.length, spend: sp, roi: sp ? cp / sp : null })
    }
    out.push({
      month: m, window: [win[0], win[win.length - 1]], pipeline: pipe, deals: deals.length,
      blended_spend: bl, programs_spend: pr,
      blended: bl ? pipe / bl : null, programs: pr ? pipe / pr : null,
      channels: chans,
      label: grain === 'quarter' ? `Q${Math.floor(Number(m.slice(5, 7)) / 3)}-${m.slice(0, 4)}` : m
    })
  }
  return out
}

// ---------------------------------------------------------------------------
// Marketing-sourced pipeline (CM-05)
// ---------------------------------------------------------------------------
function acctBase(name: unknown): string {
  const n = String(or(name, '')).toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9 ]/g, ' ')
  return n.split(/\s+/).filter(Boolean).join(' ')
}

export function duplicateAccounts(deals: Dict[]): Map<string, string> {
  const names = new Map<string, string>()
  for (const d of deals) if (truthy(d.accountId) && truthy(d.accountName)) names.set(pyStr(d.accountId), d.accountName)
  const base = new Map<string, string>()
  for (const [a, n] of names) base.set(a, acctBase(n))
  const byBase = new Map<string, string>()
  for (const [a, b] of base) if (!byBase.has(b)) byBase.set(b, a)
  const out = new Map<string, string>()
  for (const [a, b] of base) {
    const words = b.split(' ').filter((w) => w.length > 0)
    for (let k = words.length - 1; k > 0; k--) {
      const pre = words.slice(0, k).join(' ')
      if (pre.length >= 8 && byBase.has(pre) && byBase.get(pre) !== a) {
        out.set(a, names.get(byBase.get(pre)!)!)
        break
      }
    }
  }
  return out
}

export function mspRows(deals: Dict[], valueField: string, nbTypes: Set<string>, mkSources: Set<string>, dup: Set<string>,
  outcome: (d: Dict) => string | null, trueNewOnly: boolean): [Dict[], Dict[]] {
  const firstWon = new Map<string, string>()
  for (const d of deals) {
    if (outcome(d) === 'won') {
      const c = toDateStr(d.closedate)
      const a = String(or(d.accountId, ''))
      if (c && a && (!firstWon.has(a) || c < firstWon.get(a)!)) firstWon.set(a, c)
    }
  }
  const created: Dict[] = []
  const won: Dict[] = []
  for (const d of deals) {
    if (!nbTypes.has(d.type)) continue
    const a = String(or(d.accountId, ''))
    let v = d[valueField]
    if ((v === null || v === undefined) && valueField !== 'amount') v = d.amount
    const row: Dict = {
      value: num(v), source: or(d.leadSource, ''), mk: mkSources.has(String(or(d.leadSource, ''))),
      name: or(d.dealname, ''), account: or(d.accountName, ''), stage: or(d.dealstage, ''),
      dup: dup.has(a), has_value_field: d[valueField] !== null && d[valueField] !== undefined
    }
    const cr = toDateStr(or(d.dealCreatedAt, d.createdDate))
    if (cr) created.push({ ...row, date: cr, month: cr.slice(0, 7) })
    if (outcome(d) === 'won') {
      const c = toDateStr(d.closedate)
      if (c) {
        const repeat = truthy(firstWon.get(a)) && firstWon.get(a)! < c
        won.push({ ...row, date: c, month: c.slice(0, 7), repeat: repeat && trueNewOnly })
      }
    }
  }
  return [created, won]
}

export function mspSeries(created: Dict[], won: Dict[], months: string[], grain: string, view: string, excludeDups: boolean): Dict[] {
  const keep = (r: Dict) => !(excludeDups && r.dup)
  const cBy = new Map<string, Dict[]>()
  const wBy = new Map<string, Dict[]>()
  for (const r of created) if (keep(r)) getOr(cBy, r.month, () => []).push(r)
  for (const r of won) if (keep(r) && !r.repeat) getOr(wBy, r.month, () => []).push(r)
  const monthSet = new Set(months)
  const out: Dict[] = []
  for (const m of months) {
    if (grain === 'quarter' && Number(m.slice(5, 7)) % 3) continue
    const k = view === 'ttm' ? 12 : grain === 'quarter' ? 3 : 1
    const win: string[] = []
    for (let i = k - 1; i >= 0; i--) win.push(addMonths(m, -i))
    if (win.some((w) => !monthSet.has(w))) continue
    const cd = win.flatMap((w) => cBy.get(w) ?? [])
    const mk = sum(cd.filter((r) => r.mk).map((r) => r.value))
    const tot = sum(cd.map((r) => r.value))
    const ttm: string[] = []
    for (let i = 0; i < 12; i++) ttm.push(addMonths(m, -i))
    const wd = ttm.flatMap((w) => wBy.get(w) ?? [])
    const wmk = sum(wd.filter((r) => r.mk).map((r) => r.value))
    const wtot = sum(wd.map((r) => r.value))
    out.push({
      month: m, window: [win[0], win[win.length - 1]], mk, total: tot, n: cd.length,
      n_mk: cd.filter((r) => r.mk).length, pct: tot ? (100 * mk) / tot : null,
      won_mk: wmk, won_total: wtot, won_n: wd.length, won_pct: wtot ? (100 * wmk) / wtot : null,
      ttm_window: [ttm[ttm.length - 1], ttm[0]],
      label: grain === 'quarter' ? `Q${Math.floor(Number(m.slice(5, 7)) / 3)}-${m.slice(0, 4)}` : m
    })
  }
  return out
}
