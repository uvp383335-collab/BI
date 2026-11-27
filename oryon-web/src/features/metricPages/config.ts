/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * One entry per Oryon metric page, mirroring the reference Python app's pages
 * (mrr_app/templates/*.html): view switches, KPI cards, charts, the table,
 * the drill-down behind a row and the "how it's calculated" text.
 * Row keys are the backend's (metrics/oryon/oryonPages.ts), which are the
 * Python app's own.
 */
import type { ChartCfg, Column, Kpi, Row } from './components/Blocks'

export interface Control {
  key: string
  label: string
  options: Array<[string, string]> | ((p: Row) => Array<[string, string]>)
  default: string
}

export interface DetailSection {
  title: string
  rows: (d: Row) => Row[]
  columns: Column[] | ((d: Row) => Column[])
}

export interface PageCfg {
  page: string
  codes: string[]
  title: string
  subtitle: string
  controls: Control[]
  kpis: (p: Row, q: Record<string, string>) => Kpi[]
  charts: ChartCfg[]
  /** table rows (default p.rows) */
  rows?: (p: Row) => Row[]
  columns: Column[] | ((p: Row, q: Record<string, string>) => Column[])
  /** the period key of a row passed to the drill-down; omit = no drill-down */
  period?: (r: Row) => string | undefined
  detailTitle?: (period: string) => string
  detailSummary?: (d: Row) => Kpi[]
  detail?: DetailSection[]
  method: string[]
  note?: (p: Row) => string | null
}

const GRAIN = (d = 'quarter'): Control => ({ key: 'grain', label: 'Grain', options: [['month', 'Monthly'], ['quarter', 'Quarterly']], default: d })
const WINDOW = (key = 'window', d = 'period'): Control => ({ key, label: 'Window', options: [['period', 'Period'], ['ttm', 'Trailing 12 months']], default: d })
const yoy = (a: number | null | undefined, b: number | null | undefined) => (a != null && b ? (100 * (a - b)) / b : null)
const rowsOf = (p: Row): Row[] => p.rows ?? []
const ACCT: Column = { label: 'Account', value: (r) => r.name }

// ------------------------------------------------------------------------------------------------ pages

const mrr: PageCfg = {
  page: 'mrr', codes: ['MRR'], title: 'MRR / ARR', subtitle: 'Monthly recurring revenue from the invoices and the product mapping, ARR = MRR × 12.',
  controls: [],
  kpis: (p) => {
    const l = p.latest ?? {}
    return [
      { label: `MRR · ${l.month ?? '-'}`, value: l.total_mrr, fmt: 'usd' },
      { label: 'ARR', value: l.arr, fmt: 'usd' },
      { label: 'Active customers', value: l.active_customers, fmt: 'int' },
      { label: 'ARR per customer', value: l.active_customers ? l.arr / l.active_customers : null, fmt: 'usd' },
      { label: 'Subscription MRR', value: l.subscription_mrr, fmt: 'usd' },
      { label: 'MoM', value: l.mom_pct, fmt: 'pct', tone: l.mom_pct < 0 ? 'bad' : 'good' }
    ]
  },
  charts: [{
    title: 'MRR (subscription + retainer) and active customers', x: (r) => r.month, yFmt: 'usd', rightFmt: 'int', height: 300,
    series: () => [
      { label: 'Subscription MRR', value: (r) => r.subscription_mrr, type: 'bar', stack: 'm' },
      { label: 'Retainer MRR', value: (r) => r.retainer_mrr, type: 'bar', stack: 'm' },
      { label: 'Active customers', value: (r) => r.active_customers, type: 'line', axis: 'right' }
    ]
  }],
  columns: [
    { label: 'Month', value: (r) => r.month }, { label: 'Subscription MRR', value: (r) => r.subscription_mrr, fmt: 'usd2' },
    { label: 'Retainer MRR', value: (r) => r.retainer_mrr, fmt: 'usd2' }, { label: 'Total MRR', value: (r) => r.total_mrr, fmt: 'usd2' },
    { label: 'ARR', value: (r) => r.arr, fmt: 'usd2' }, { label: 'Active customers', value: (r) => r.active_customers, fmt: 'int' },
    { label: 'MoM %', value: (r) => r.mom_pct, fmt: 'pct', tone: (r) => (r.mom_pct < 0 ? 'bad' : undefined) }
  ],
  period: (r) => r.month, detailTitle: (m) => `Customers · ${m}`,
  detailSummary: (d) => [{ label: 'MRR', value: d.total, fmt: 'usd2' }, { label: 'Customers', value: d.rows?.length, fmt: 'int' }],
  detail: [{
    title: 'MRR by customer', rows: (d) => d.rows,
    columns: [
      { label: 'Customer', value: (r) => r.name }, { label: 'QuickBooks id', value: (r) => r.customer }, { label: 'Currency', value: (r) => r.currency },
      { label: 'Subscription', value: (r) => r.subscription, fmt: 'usd2' }, { label: 'Retainer', value: (r) => r.retainer, fmt: 'usd2' },
      { label: 'Total MRR', value: (r) => r.total, fmt: 'usd2' }, { label: 'ARR', value: (r) => r.arr, fmt: 'usd2' }
    ]
  }],
  method: [
    'MRR(customer, month) = monthly lines + annual lines ÷ 12 + quarterly lines ÷ 3 + retainers, converted to USD at the month\'s CAD rate for Canadian customers.',
    'Quarterly / annual invoices dated on or after the early-invoice day start the next month (renewals are invoiced early).',
    '"Retainer - only when repeated" counts only when the same customer is billed the same amount in an adjacent month.',
    'MRR(month) = Σ customers · Active customers = customers with MRR > 0 · ARR = MRR × 12.'
  ]
}

const retention: PageCfg = {
  page: 'retention', codes: ['VC-01', 'VC-02'], title: 'Retention (GRR, NRR)', subtitle: 'Revenue kept from the customers paying at the start of the window, before (GRR) and after (NRR) expansion.',
  controls: [GRAIN(), { key: 'window', label: 'Window', options: [['ttm', 'TTM (vs 12 months earlier)'], ['period', 'Period (vs prior period end)']], default: 'ttm' },
    { key: 'scope', label: 'Scope', options: [['all', 'All recurring'], ['subscription', 'Subscription only']], default: 'all' }],
  kpis: (p, q) => {
    const l = p.latest ?? {}
    const ttm = (q.window ?? 'ttm') === 'ttm'
    return [
      { label: `GRR · ${l.label ?? '-'}`, value: l.grr, fmt: 'pct', tone: ttm && l.grr < 90 ? 'bad' : undefined },
      { label: `NRR · ${l.label ?? '-'}`, value: l.nrr, fmt: 'pct', tone: ttm && l.nrr < 100 ? 'bad' : undefined },
      { label: 'Starting ARR', value: l.S != null ? l.S * 12 : null, fmt: 'usd', sub: `${l.cohort ?? '-'} customers` },
      { label: `Churn ARR · ${l.churn ?? 0} cust.`, value: l.C != null ? -l.C * 12 : null, fmt: 'usd', tone: 'bad' },
      { label: `Downgrade ARR · ${l.downgrade ?? 0}`, value: l.Dn != null ? -l.Dn * 12 : null, fmt: 'usd', tone: 'bad' },
      { label: `Upgrade ARR · ${l.upgrade ?? 0}`, value: l.U != null ? l.U * 12 : null, fmt: 'usd', tone: 'good' }
    ]
  },
  charts: [
    { title: 'GRR and NRR', x: (r) => r.label, yFmt: 'pct', series: () => [{ label: 'GRR', value: (r) => r.grr }, { label: 'NRR', value: (r) => r.nrr }],
      refs: () => [{ y: 90, label: 'GRR 90%' }, { y: 100, label: 'NRR 100%' }] },
    {
      title: 'ARR bridge of the starting cohort', sub: 'Latest period: starting ARR → kept → ending ARR', yFmt: 'usd', x: (r) => r.step,
      rows: (p) => {
        const l = p.latest
        if (!l) return []
        return [
          { step: 'Starting ARR', v: l.S * 12 }, { step: 'Churn', v: -l.C * 12 }, { step: 'Downgrades', v: -l.Dn * 12 },
          { step: 'Kept ARR', v: l.K * 12 }, { step: 'Upgrades', v: l.U * 12 }, { step: 'Ending ARR', v: l.E * 12 }
        ]
      },
      series: () => [{ label: 'ARR', value: (r) => r.v, type: 'bar' }]
    }
  ],
  columns: [
    { label: 'Period', value: (r) => r.label }, { label: 'Start', value: (r) => r.m0 }, { label: 'End', value: (r) => r.m1 },
    { label: 'Cohort', value: (r) => r.cohort, fmt: 'int' }, { label: 'Starting MRR (S)', value: (r) => r.S, fmt: 'usd2' },
    { label: 'Churn (C)', value: (r) => r.C, fmt: 'usd2' }, { label: 'Downgrades (Dn)', value: (r) => r.Dn, fmt: 'usd2' },
    { label: 'Upgrades (U)', value: (r) => r.U, fmt: 'usd2' }, { label: 'Kept (K)', value: (r) => r.K, fmt: 'usd2' },
    { label: 'Ending (E)', value: (r) => r.E, fmt: 'usd2' }, { label: 'GRR %', value: (r) => r.grr, fmt: 'pct', tone: (r) => (r.grr < 90 ? 'bad' : undefined) },
    { label: 'NRR %', value: (r) => r.nrr, fmt: 'pct', tone: (r) => (r.nrr < 100 ? 'bad' : undefined) },
    { label: 'Churned', value: (r) => r.churn, fmt: 'int' }, { label: 'Downgraded', value: (r) => r.downgrade, fmt: 'int' },
    { label: 'Upgraded', value: (r) => r.upgrade, fmt: 'int' }, { label: 'Flat', value: (r) => r.flat, fmt: 'int' },
    { label: 'Reliable', value: (r) => r.reliable, fmt: 'bool' }
  ],
  period: (r) => r.m1, detailTitle: (m) => `Customers in the cohort · ending ${m}`,
  detailSummary: (d) => [
    { label: 'GRR', value: d.grr, fmt: 'pct' }, { label: 'NRR', value: d.nrr, fmt: 'pct' }, { label: 'Cohort start', value: d.m0, fmt: 'text' },
    { label: 'CAD rate used', value: d.rate, fmt: 'rate' }
  ],
  detail: [{
    title: 'Per customer (most lost first)', rows: (d) => d.customers ?? [],
    columns: [
      { label: 'Customer', value: (r) => r.name }, { label: 'Currency', value: (r) => r.currency }, { label: 'Start MRR', value: (r) => r.start, fmt: 'usd2' },
      { label: 'End MRR', value: (r) => r.end, fmt: 'usd2' }, { label: 'Change', value: (r) => r.change, fmt: 'usd2', tone: (r) => (r.change < 0 ? 'bad' : r.change > 0 ? 'good' : undefined) },
      { label: 'Bucket', value: (r) => r.bucket }
    ]
  }],
  method: [
    'Cohort = customers with MRR > 0 in the start month m0 (TTM: 12 months back; period: prior month or prior quarter end). Both ends at m0\'s CAD rate.',
    'Churn: end MRR = 0 → C += a · downgrade: 0 < b < a → Dn += a − b · upgrade: b > a → U += b − a.',
    'S = Σa, K = S − C − Dn, E = K + U · GRR = K / S × 100 · NRR = E / S × 100.',
    'Cohorts starting in the first 11 months of MRR data are not shown (annual invoices from before the data began aren\'t captured).'
  ]
}

const SEG = ['SMB', 'Mid-Market', 'Upper Mid-Market', 'Enterprise', 'Unlinked']
const newLogos: PageCfg = {
  page: 'new_logos', codes: ['VC-03'], title: 'New logos', subtitle: 'New-logo ARR (first-month MRR × 12) by Salesforce close month and segment.',
  controls: [GRAIN()],
  kpis: (p) => {
    const t = p.ttm ?? {}
    const pr = p.prev ?? {}
    return [
      { label: `New-logo ARR · ${t.lo ?? ''} → ${t.hi ?? ''}`, value: t.arr, fmt: 'usd' },
      { label: `Prior 12 months · ${pr.lo ?? ''} → ${pr.hi ?? ''}`, value: pr.arr, fmt: 'usd' },
      { label: 'Growth (12 months)', value: pr.arr && pr.full ? yoy(t.arr, pr.arr) : null, fmt: 'pct1', tone: t.arr >= pr.arr ? 'good' : 'bad' },
      { label: 'New logos (now / before)', value: `${t.n ?? '-'} / ${pr.n ?? '-'}`, fmt: 'text' },
      { label: 'Avg ARR per new logo', value: t.n ? t.arr / t.n : null, fmt: 'usd' }
    ]
  },
  note: (p) => (p.prev && !p.prev.full ? 'The prior 12-month window starts before new logos are reliable, so growth isn\'t shown.' : null),
  charts: [
    { title: 'New-logo ARR by segment', x: (r) => r.period, yFmt: 'usd', series: () => SEG.map((s) => ({ label: s, value: (r: Row) => r[s], type: 'bar' as const, stack: 'seg' })) },
    { title: 'Growth vs the same period last year', x: (r) => r.period, yFmt: 'pct', series: () => [{ label: 'YoY growth', value: (r) => r.yoy_pct }], refs: () => [{ y: 0, label: '0%' }] }
  ],
  columns: [
    { label: 'Period', value: (r) => r.period }, { label: 'Complete', value: (r) => r.complete, fmt: 'bool' }, { label: 'New logos', value: (r) => r.n, fmt: 'int' },
    { label: 'New-logo ARR', value: (r) => r.arr, fmt: 'usd' }, ...SEG.map((s): Column => ({ label: s, value: (r) => r[s], fmt: 'usd' })),
    { label: 'vs prior period', value: (r) => r.pop_pct, fmt: 'pct1' }, { label: 'vs year ago', value: (r) => r.yoy_pct, fmt: 'pct1' }
  ],
  period: (r) => r.period, detailTitle: (p) => `New customers · ${p}`,
  detailSummary: (d) => [{ label: 'New-logo ARR', value: d.total, fmt: 'usd' }, { label: 'New logos', value: d.n, fmt: 'int' }],
  detail: [{
    title: 'New logos', rows: (d) => d.logos,
    columns: [
      { label: 'Close month', value: (r) => r.close_month }, { label: 'First billed', value: (r) => r.billing_month }, { label: 'QuickBooks customer', value: (r) => r.customer_name },
      { label: 'Salesforce account', value: (r) => r.account_name }, { label: 'Segment', value: (r) => r.segment }, { label: 'Linked by', value: (r) => r.link_method },
      { label: 'First-month MRR', value: (r) => r.first_mrr, fmt: 'usd2' }, { label: 'ARR', value: (r) => r.arr, fmt: 'usd2' }, { label: 'Counted', value: (r) => r.counted, fmt: 'bool' }
    ]
  }],
  method: [
    'A new logo is a QuickBooks customer whose MRR is above $0 for the first time (win-backs excluded).',
    'Close month = first billing month − the new-logo billing lag. New-logo ARR = first-month MRR × 12.',
    'Segment comes from the Salesforce account (QBO_Customer_Id__c, else a normalized name match).',
    'New logos count from 12 months after MRR data begins; periods whose deals haven\'t billed yet are incomplete.'
  ]
}

const cac: PageCfg = {
  page: 'cac', codes: ['VC-06'], title: 'CAC & payback', subtitle: 'Trailing 12 months of sales & marketing spend against the new logos won in the same window.',
  controls: [],
  kpis: (p) => {
    const l = p.latest ?? {}
    const y = p.year_ago ?? {}
    const th = p.info?.threshold ?? 18
    return [
      { label: `CAC payback · TTM to ${l.month ?? '-'}`, value: l.payback, fmt: 'months', tone: l.payback > th ? 'bad' : 'good', sub: `threshold ${th} · year ago ${y.payback != null ? y.payback.toFixed(1) : '-'}` },
      { label: 'CAC', value: l.cac, fmt: 'usd', sub: `year ago ${y.cac != null ? `$${Math.round(y.cac).toLocaleString()}` : '-'}` },
      { label: 'S&M per $1 of new ARR', value: l.sm_per_arr, fmt: 'num' },
      { label: 'S&M spend (TTM)', value: l.sm, fmt: 'usd' },
      { label: 'New logos (TTM)', value: l.new_logos, fmt: 'int' },
      { label: 'Gross margin', value: l.gm != null ? l.gm * 100 : null, fmt: 'pct1' }
    ]
  },
  charts: [
    { title: 'CAC payback (months) vs the threshold', x: (r) => r.month, yFmt: 'num', series: () => [{ label: 'Payback (months)', value: (r) => r.payback }], refs: (p) => [{ y: p.info?.threshold ?? 18, label: `${p.info?.threshold ?? 18}-month threshold` }] },
    { title: 'CAC and S&M per $1 of new ARR', x: (r) => r.month, yFmt: 'usd', rightFmt: 'num', series: () => [{ label: 'CAC', value: (r) => r.cac, type: 'bar' }, { label: 'S&M per $1 new ARR', value: (r) => r.sm_per_arr, axis: 'right' }] }
  ],
  columns: [
    { label: 'TTM end', value: (r) => r.month }, { label: 'TTM start', value: (r) => r.start }, { label: 'Complete', value: (r) => r.complete, fmt: 'bool' },
    { label: 'S&M', value: (r) => r.sm, fmt: 'usd' }, { label: 'New logos', value: (r) => r.new_logos, fmt: 'int' }, { label: 'New-logo ARR', value: (r) => r.new_logo_arr, fmt: 'usd' },
    { label: 'Avg ARR', value: (r) => r.avg_arr, fmt: 'usd' }, { label: 'Revenue', value: (r) => r.revenue, fmt: 'usd' }, { label: 'COGS', value: (r) => r.cogs, fmt: 'usd' },
    { label: 'GM', value: (r) => (r.gm != null ? r.gm * 100 : null), fmt: 'pct1' }, { label: 'CAC', value: (r) => r.cac, fmt: 'usd' },
    { label: 'Payback (mo)', value: (r) => r.payback, fmt: 'num', tone: (r) => (r.payback > 18 ? 'bad' : undefined) }, { label: 'S&M / $1 ARR', value: (r) => r.sm_per_arr, fmt: 'num' }
  ],
  period: (r) => r.month, detailTitle: (m) => `CAC inputs · TTM to ${m}`,
  detailSummary: (d) => [
    { label: 'S&M', value: d.r?.sm, fmt: 'usd' }, { label: 'New logos', value: d.r?.new_logos, fmt: 'int' }, { label: 'CAC', value: d.r?.cac, fmt: 'usd' },
    { label: 'Payback', value: d.r?.payback, fmt: 'months' }, { label: 'Gross margin', value: d.r?.gm != null ? d.r.gm * 100 : null, fmt: 'pct1' }
  ],
  detail: [
    {
      title: 'S&M by account and month', rows: (d) => [...(d.accounts ?? []), { name: 'S&M total', months: d.month_totals, total: d.r?.sm }],
      columns: (d) => [ACCT, ...(d.window as string[]).map((m): Column => ({ label: m, value: (r) => r.months?.[m] ?? 0, fmt: 'usd' })), { label: 'Total', value: (r) => r.total, fmt: 'usd' }]
    },
    {
      title: 'New logos in the window', rows: (d) => d.logos ?? [],
      columns: [{ label: 'Close month', value: (r) => r.close_month }, { label: 'Customer', value: (r) => r.customer_name }, { label: 'Segment', value: (r) => r.segment }, { label: 'ARR', value: (r) => r.arr, fmt: 'usd' }]
    }
  ],
  method: [
    'For each month e, over the 12 months ending at e: S&M = the selected expense accounts; new logos and new-logo ARR by close month (New logos page).',
    'GM = (income − COGS) ÷ income · CAC = S&M ÷ new logos.',
    'CAC payback (months) = CAC ÷ ((new-logo ARR ÷ new logos ÷ 12) × GM) — above 18 months is a warning.',
    'S&M per $1 of new ARR = S&M ÷ new-logo ARR.'
  ]
}

const LINES = ['Platform', 'Services', 'Hardware']
const plPeriodControls = (dg: string): Control[] => [GRAIN(dg), WINDOW()]

const cogs: PageCfg = {
  page: 'cogs', codes: ['VC-04'], title: 'COGS % and mix', subtitle: 'COGS as a share of revenue, total and by product line.',
  controls: plPeriodControls('month'),
  kpis: (p) => {
    const l = p.latest ?? {}
    const pr = p.prev ?? {}
    return [
      { label: `COGS % · ${l.label ?? '-'}`, value: l.pct, fmt: 'pct', sub: pr.pct != null ? `year ago ${pr.pct.toFixed(2)}%` : undefined },
      { label: 'Excl. capitalized software', value: l.pct_ex_da, fmt: 'pct' },
      ...LINES.map((x): Kpi => ({ label: `${x} COGS %`, value: l.lines?.[x]?.pct, fmt: 'pct', sub: l.lines?.[x]?.share != null ? `${l.lines[x].share.toFixed(1)}% of revenue` : undefined })),
      { label: 'COGS', value: l.cogs, fmt: 'usd' }
    ]
  },
  charts: [
    { title: 'COGS % of revenue', x: (r) => r.label, yFmt: 'pct', series: () => [{ label: 'COGS %', value: (r) => r.pct }, { label: 'Excl. capitalized software', value: (r) => r.pct_ex_da, dashed: true }] },
    { title: 'COGS % by product line', x: (r) => r.label, yFmt: 'pct', series: () => LINES.map((x) => ({ label: x, value: (r: Row) => r.lines?.[x]?.pct })) },
    { title: 'COGS dollars by product line', x: (r) => r.label, yFmt: 'usd', series: () => [...LINES, 'Unassigned'].map((x) => ({ label: x, value: (r: Row) => r.lines?.[x]?.cogs, type: 'bar' as const, stack: 'c' })) }
  ],
  columns: [
    { label: 'Period', value: (r) => r.label }, { label: 'Complete', value: (r) => r.complete, fmt: 'bool' }, { label: 'Revenue', value: (r) => r.revenue, fmt: 'usd' },
    { label: 'COGS', value: (r) => r.cogs, fmt: 'usd' }, { label: 'COGS D&A', value: (r) => r.da, fmt: 'usd' }, { label: 'COGS %', value: (r) => r.pct, fmt: 'pct' },
    { label: 'Excl. cap. software', value: (r) => r.pct_ex_da, fmt: 'pct' },
    ...LINES.flatMap((x): Column[] => [{ label: `${x} COGS %`, value: (r) => r.lines?.[x]?.pct, fmt: 'pct' }, { label: `${x} share`, value: (r) => r.lines?.[x]?.share, fmt: 'pct' }])
  ],
  period: (r) => r.label, detailTitle: (p) => `Accounts · ${p}`,
  detailSummary: (d) => [{ label: 'Revenue', value: d.r?.revenue, fmt: 'usd' }, { label: 'COGS', value: d.r?.cogs, fmt: 'usd' }, { label: 'COGS %', value: d.r?.pct, fmt: 'pct' }],
  detail: [{
    title: 'Income and COGS accounts', rows: (d) => d.accounts,
    columns: [{ label: 'Section', value: (r) => r.section }, ACCT, { label: 'Product line', value: (r) => r.line }, { label: 'Cap. software D&A', value: (r) => r.da, fmt: 'bool' }, { label: 'Amount', value: (r) => r.amount, fmt: 'usd2' }]
  }],
  method: [
    'COGS % = 100 × COGS ÷ revenue for the window (month, quarter or trailing 12 months); COGS includes capitalized-software amortization.',
    'Excl. capitalized software = 100 × (COGS − amortization) ÷ revenue.',
    'Product-line COGS % = 100 × line COGS ÷ line revenue; line share = 100 × line revenue ÷ revenue. Product lines come from the account mapping.'
  ]
}

const ga: PageCfg = {
  page: 'ga', codes: ['VC-09'], title: 'G&A % of revenue', subtitle: 'G&A accounts as a share of revenue.',
  controls: plPeriodControls('month'),
  kpis: (p) => {
    const l = p.latest ?? {}
    const pr = p.prev ?? {}
    return [
      { label: `G&A % · ${l.label ?? '-'}`, value: l.pct, fmt: 'pct', sub: pr.pct != null ? `year ago ${pr.pct.toFixed(2)}%` : undefined },
      { label: 'G&A', value: l.ga, fmt: 'usd' }, { label: 'Revenue', value: l.revenue, fmt: 'usd' },
      { label: 'Change vs year ago', value: l.pct != null && pr.pct != null ? l.pct - pr.pct : null, fmt: 'num', sub: 'percentage points' }
    ]
  },
  charts: [
    { title: 'G&A % of revenue', x: (r) => r.label, yFmt: 'pct', series: () => [{ label: 'G&A %', value: (r) => r.pct }] },
    {
      title: 'G&A expense by account', yFmt: 'usd', x: (r) => r.label,
      rows: (p) => rowsOf(p).map((r, i) => ({ label: r.label, ...Object.fromEntries((p.stacks ?? []).map((s: Row, j: number) => [`a${j}`, s.data[i]])) })),
      series: (p) => (p.stacks ?? []).map((s: Row, j: number) => ({ label: s.name, value: (r: Row) => r[`a${j}`], type: 'bar' as const, stack: 'g' }))
    }
  ],
  columns: [
    { label: 'Period', value: (r) => r.label }, { label: 'Complete', value: (r) => r.complete, fmt: 'bool' }, { label: 'Revenue', value: (r) => r.revenue, fmt: 'usd' },
    { label: 'G&A', value: (r) => r.ga, fmt: 'usd' }, { label: 'G&A %', value: (r) => r.pct, fmt: 'pct' }
  ],
  period: (r) => r.label, detailTitle: (p) => `G&A accounts · ${p}`,
  detailSummary: (d) => [{ label: 'G&A', value: d.r?.ga, fmt: 'usd' }, { label: 'Revenue', value: d.r?.revenue, fmt: 'usd' }, { label: 'G&A %', value: d.r?.pct, fmt: 'pct' }],
  detail: [{
    title: 'G&A by account and month',
    rows: (d) => [...(d.accounts ?? []), { name: 'G&A total', months: d.month_totals, total: d.r?.ga }, { name: 'Revenue', months: d.month_revenue, total: d.r?.revenue }],
    columns: (d) => [ACCT, ...(d.months as string[]).map((m): Column => ({ label: m, value: (r) => r.months?.[m] ?? 0, fmt: 'usd' })), { label: 'Total', value: (r) => r.total, fmt: 'usd' }]
  }],
  method: [
    'G&A % = 100 × Σ selected G&A accounts ÷ revenue for the window; TTM = 12 months\' G&A ÷ 12 months\' revenue.',
    'Revenue = income accounts not excluded on the COGS % mapping. One-time deal fees (6490) and D&A (6510 / 6520) are left out by default.'
  ]
}

const ebitda: PageCfg = {
  page: 'ebitda', codes: ['VC-10'], title: 'EBITDA margin', subtitle: 'EBITDA = revenue − COGS − opex + D&A, as a share of revenue.',
  controls: plPeriodControls('quarter'),
  kpis: (p) => {
    const l = p.latest ?? {}
    const pr = p.prev ?? {}
    return [
      { label: `EBITDA margin · ${l.label ?? '-'}`, value: l.margin, fmt: 'pct', sub: pr.margin != null ? `year ago ${pr.margin.toFixed(2)}%` : undefined },
      { label: 'EBITDA', value: l.ebitda, fmt: 'usd' }, { label: 'Revenue', value: l.revenue, fmt: 'usd' },
      { label: 'Plan margin', value: l.plan_margin, fmt: 'pct' }, { label: 'vs plan', value: l.vs_plan, fmt: 'num', sub: 'percentage points', tone: l.vs_plan < 0 ? 'bad' : undefined },
      { label: 'Net income', value: l.net_income, fmt: 'usd' }
    ]
  },
  charts: [
    { title: 'EBITDA margin (and plan)', x: (r) => r.label, yFmt: 'pct', series: () => [{ label: 'EBITDA margin', value: (r) => r.margin }, { label: 'Plan margin', value: (r) => r.plan_margin, dashed: true }] },
    { title: 'EBITDA dollars', x: (r) => r.label, yFmt: 'usd', series: () => [{ label: 'EBITDA', value: (r) => r.ebitda, type: 'bar' }, { label: 'Plan EBITDA', value: (r) => r.plan_ebitda, dashed: true }] }
  ],
  columns: [
    { label: 'Period', value: (r) => r.label }, { label: 'Revenue', value: (r) => r.revenue, fmt: 'usd' }, { label: '− COGS', value: (r) => r.cogs, fmt: 'usd' },
    { label: '− Opex', value: (r) => r.opex, fmt: 'usd' }, { label: '+ D&A', value: (r) => r.da, fmt: 'usd' }, { label: '= EBITDA', value: (r) => r.ebitda, fmt: 'usd' },
    { label: 'Margin', value: (r) => r.margin, fmt: 'pct' }, { label: 'Plan EBITDA', value: (r) => r.plan_ebitda, fmt: 'usd' }, { label: 'Plan margin', value: (r) => r.plan_margin, fmt: 'pct' },
    { label: 'vs plan (pts)', value: (r) => r.vs_plan, fmt: 'num' }, { label: 'Below EBITDA', value: (r) => r.below, fmt: 'usd' }
  ],
  period: (r) => r.label, detailTitle: (p) => `EBITDA accounts · ${p}`,
  detailSummary: (d) => ['revenue', 'cogs', 'opex', 'da', 'ebitda'].map((k): Kpi => ({ label: k.toUpperCase() === 'DA' ? 'D&A' : k[0].toUpperCase() + k.slice(1), value: d.r?.[k], fmt: 'usd' })),
  detail: [{
    title: 'Accounts by category', rows: (d) => (d.accounts ?? []).map((a: Row) => ({ ...a, catLabel: d.categories?.[a.cat] ?? a.cat })),
    columns: [{ label: 'Category', value: (r) => r.catLabel }, ACCT, { label: 'D&A added back', value: (r) => r.da, fmt: 'bool' }, { label: 'Amount', value: (r) => r.amount, fmt: 'usd2' }]
  }],
  method: [
    'EBITDA = revenue − COGS − opex + D&A; margin = 100 × EBITDA ÷ revenue.',
    'Interest, FX and tax are below EBITDA; capitalized-software amortization (5040) and D&A (6510 / 6520) are added back; one-time deal fees (6490) are not.',
    'vs plan = margin − plan margin, plan margin = Σ plan EBITDA ÷ Σ plan revenue over the period\'s months.'
  ]
}

const ltv: PageCfg = {
  page: 'ltv', codes: ['VC-07', 'VC-14'], title: 'LTV / CAC', subtitle: 'Lifetime gross profit of a customer against what it cost to win — new customers (VC-07) and the whole base (VC-14).',
  controls: [GRAIN()],
  kpis: (p) => {
    const l = p.latest ?? {}
    const pr = p.prev ?? {}
    const th = p.info?.threshold ?? 3
    return [
      { label: `LTV / CAC, new · TTM to ${l.month ?? '-'}`, value: l.ltv_cac, fmt: 'x', tone: l.ltv_cac < th ? 'bad' : 'good', sub: `threshold ${th}x${pr.ltv_cac ? ` · year ago ${pr.ltv_cac.toFixed(2)}x` : ''}` },
      { label: 'LTV / CAC, whole base', value: l.base_ltv_cac, fmt: 'x', tone: l.base_ltv_cac < th ? 'bad' : 'good' },
      { label: 'LTV (new)', value: l.ltv, fmt: 'usd' }, { label: 'CAC', value: l.cac, fmt: 'usd' },
      { label: 'Expected lifetime', value: l.lifetime, fmt: 'months', sub: l.capped ? 'capped' : undefined },
      { label: 'TTM GRR', value: l.grr, fmt: 'pct' }
    ]
  },
  charts: [
    { title: 'LTV / CAC vs the threshold', x: (r) => r.label, yFmt: 'x', series: () => [{ label: 'New customers', value: (r) => r.ltv_cac }, { label: 'Whole base', value: (r) => r.base_ltv_cac }], refs: (p) => [{ y: p.info?.threshold ?? 3, label: `${p.info?.threshold ?? 3}x` }] },
    { title: 'LTV (new customers and whole base) and CAC', x: (r) => r.label, yFmt: 'usd', series: () => [{ label: 'LTV new', value: (r) => r.ltv, type: 'bar' }, { label: 'LTV whole base', value: (r) => r.base_ltv, type: 'bar' }, { label: 'CAC', value: (r) => r.cac, type: 'bar' }] },
    { title: 'Expected lifetime (months) and TTM GRR', x: (r) => r.label, yFmt: 'num', rightFmt: 'pct', series: () => [{ label: 'Lifetime (months)', value: (r) => r.lifetime, type: 'bar' }, { label: 'TTM GRR', value: (r) => r.grr, axis: 'right' }] }
  ],
  columns: [
    { label: 'Period', value: (r) => r.label }, { label: 'Complete', value: (r) => r.complete, fmt: 'bool' }, { label: 'GRR', value: (r) => r.grr, fmt: 'pct' },
    { label: 'Monthly churn', value: (r) => (r.churn != null ? r.churn * 100 : null), fmt: 'pct' }, { label: 'Lifetime', value: (r) => r.lifetime, fmt: 'num' },
    { label: 'Capped', value: (r) => r.capped, fmt: 'bool' }, { label: 'GM', value: (r) => (r.gm != null ? r.gm * 100 : null), fmt: 'pct1' },
    { label: 'GP per logo / month', value: (r) => r.gp_month, fmt: 'usd' }, { label: 'LTV', value: (r) => r.ltv, fmt: 'usd' }, { label: 'CAC', value: (r) => r.cac, fmt: 'usd' },
    { label: 'LTV / CAC', value: (r) => r.ltv_cac, fmt: 'x', tone: (r) => (r.ltv_cac < 3 ? 'bad' : undefined) }, { label: 'Whole-base LTV', value: (r) => r.base_ltv, fmt: 'usd' },
    { label: 'Whole-base LTV / CAC', value: (r) => r.base_ltv_cac, fmt: 'x' }, { label: 'Active customers', value: (r) => r.customers, fmt: 'int' }
  ],
  period: (r) => r.month, detailTitle: (m) => `LTV / CAC step by step · ${m}`,
  detailSummary: (d) => {
    const r = d.r ?? {}
    return [
      { label: '1. TTM GRR', value: r.grr, fmt: 'pct' }, { label: '2. Monthly churn = 1 − GRR^(1/12)', value: r.churn != null ? r.churn * 100 : null, fmt: 'pct' },
      { label: `3. Lifetime = min(1/churn, ${d.cap})`, value: r.lifetime, fmt: 'months' }, { label: '4. GP per logo / month', value: r.gp_month, fmt: 'usd2' },
      { label: '5. LTV = GP × lifetime', value: r.ltv, fmt: 'usd' }, { label: '6. CAC', value: r.cac, fmt: 'usd' }, { label: '7. LTV / CAC', value: r.ltv_cac, fmt: 'x' },
      { label: 'Whole base: avg MRR', value: r.base_avg_mrr, fmt: 'usd2' }, { label: 'Whole base LTV / CAC', value: r.base_ltv_cac, fmt: 'x' }
    ]
  },
  detail: [],
  method: [
    'c = 1 − (GRR_TTM ÷ 100)^(1/12) · lifetime = min(1 ÷ c, cap).',
    'LTV = new-logo ARR ÷ (new logos × 12) × GM_TTM × lifetime · LTV/CAC = LTV ÷ CAC (= lifetime ÷ CAC payback).',
    'Whole base (VC-14): the average MRR of all active customers (ARR ÷ customers ÷ 12) in place of new-logo MRR.'
  ]
}

const recurring: PageCfg = {
  page: 'recurring', codes: ['VC-12'], title: 'Recurring revenue %', subtitle: 'Customer MRR summed over the window as a share of GL revenue.',
  controls: plPeriodControls('quarter'),
  kpis: (p) => {
    const l = p.latest ?? {}
    const pr = p.prev ?? {}
    return [
      { label: `Recurring % · ${l.label ?? '-'}`, value: l.pct, fmt: 'pct', sub: pr.pct != null ? `year ago ${pr.pct.toFixed(2)}%` : undefined },
      { label: 'Account-tagged %', value: l.tagged_pct, fmt: 'pct' }, { label: 'Gap (pts)', value: l.gap, fmt: 'num' },
      { label: 'Subscription MRR', value: l.sub, fmt: 'usd' }, { label: 'Retainer MRR', value: l.ret, fmt: 'usd' }, { label: 'GL revenue', value: l.revenue, fmt: 'usd' }
    ]
  },
  charts: [
    { title: 'Recurring revenue % — MRR basis vs account-tagged', x: (r) => r.label, yFmt: 'pct', series: () => [{ label: 'MRR basis', value: (r) => r.pct }, { label: 'Account-tagged', value: (r) => r.tagged_pct, dashed: true }] },
    { title: 'Revenue split', x: (r) => r.label, yFmt: 'usd', series: () => [{ label: 'Subscription MRR', value: (r) => r.sub, type: 'bar', stack: 'r' }, { label: 'Retainer MRR', value: (r) => r.ret, type: 'bar', stack: 'r' }, { label: 'Non-recurring', value: (r) => r.revenue - r.mrr, type: 'bar', stack: 'r' }] }
  ],
  columns: [
    { label: 'Period', value: (r) => r.label }, { label: 'Complete', value: (r) => r.complete, fmt: 'bool' }, { label: 'Subscription MRR', value: (r) => r.sub, fmt: 'usd' },
    { label: 'Retainer MRR', value: (r) => r.ret, fmt: 'usd' }, { label: 'Total MRR', value: (r) => r.mrr, fmt: 'usd' }, { label: 'GL revenue', value: (r) => r.revenue, fmt: 'usd' },
    { label: 'Tagged revenue', value: (r) => r.tagged, fmt: 'usd' }, { label: 'Recurring %', value: (r) => r.pct, fmt: 'pct' }, { label: 'Account-tagged %', value: (r) => r.tagged_pct, fmt: 'pct' },
    { label: 'Gap (pts)', value: (r) => r.gap, fmt: 'num' }
  ],
  period: (r) => r.label, detailTitle: (p) => `Recurring revenue · ${p}`,
  detail: [
    { title: 'By month', rows: (d) => d.per_month, columns: [{ label: 'Month', value: (r) => r.month }, { label: 'Subscription', value: (r) => r.sub, fmt: 'usd' }, { label: 'Retainer', value: (r) => r.ret, fmt: 'usd' }, { label: 'MRR', value: (r) => r.mrr, fmt: 'usd' }, { label: 'GL revenue', value: (r) => r.revenue, fmt: 'usd' }, { label: 'Recurring %', value: (r) => r.pct, fmt: 'pct' }] },
    { title: 'GL revenue by account', rows: (d) => d.accounts, columns: [ACCT, { label: 'Tagged recurring', value: (r) => r.tagged, fmt: 'bool' }, { label: 'Amount', value: (r) => r.amount, fmt: 'usd2' }] }
  ],
  method: [
    'Recurring % = 100 × Σ months Σ customers MRR (USD at each month\'s rate) ÷ GL revenue.',
    'Account-tagged % = 100 × revenue on the tagged accounts (4010 + 4015) ÷ GL revenue — a data-quality contrast.'
  ]
}

const growth: PageCfg = {
  page: 'growth', codes: ['VC-13'], title: 'Revenue growth', subtitle: 'GL revenue against the same window a year earlier, split recurring / non-recurring.',
  controls: plPeriodControls('quarter'),
  kpis: (p) => {
    const l = p.latest ?? {}
    return [
      { label: `Growth · ${l.label ?? '-'}`, value: l.growth, fmt: 'pct1', tone: l.growth < 0 ? 'bad' : 'good', sub: l.growth_change != null ? `${l.growth_change >= 0 ? '+' : ''}${l.growth_change.toFixed(1)} pts vs last year's growth` : undefined },
      { label: 'Revenue added', value: l.added, fmt: 'usd' }, { label: 'Recurring YoY', value: l.rec_growth, fmt: 'pct1' }, { label: 'Non-recurring YoY', value: l.nonrec_growth, fmt: 'pct1' },
      { label: 'Revenue', value: l.revenue, fmt: 'usd' }, { label: 'vs plan', value: l.vs_plan, fmt: 'pct1' }
    ]
  },
  charts: [
    { title: 'Revenue growth vs a year earlier', x: (r) => r.label, yFmt: 'pct', series: () => [{ label: 'Total', value: (r) => r.growth }, { label: 'Recurring', value: (r) => r.rec_growth }, { label: 'Non-recurring', value: (r) => r.nonrec_growth, dashed: true }], refs: () => [{ y: 0, label: '0%' }] },
    { title: 'Revenue: this window vs a year earlier', x: (r) => r.label, yFmt: 'usd', series: () => [{ label: 'This year', value: (r) => r.revenue, type: 'bar' }, { label: 'Year earlier', value: (r) => r.prev_revenue, type: 'bar' }] }
  ],
  columns: [
    { label: 'Period', value: (r) => r.label }, { label: 'Revenue', value: (r) => r.revenue, fmt: 'usd' }, { label: 'Year earlier', value: (r) => r.prev_revenue, fmt: 'usd' },
    { label: 'Added', value: (r) => r.added, fmt: 'usd' }, { label: 'Growth', value: (r) => r.growth, fmt: 'pct1', tone: (r) => (r.growth < 0 ? 'bad' : undefined) },
    { label: 'Growth last year', value: (r) => r.growth_ly, fmt: 'pct1' }, { label: 'Recurring YoY', value: (r) => r.rec_growth, fmt: 'pct1' },
    { label: 'Non-recurring YoY', value: (r) => r.nonrec_growth, fmt: 'pct1' }, { label: 'Plan revenue', value: (r) => r.plan_revenue, fmt: 'usd' }, { label: 'vs plan', value: (r) => r.vs_plan, fmt: 'pct1' }
  ],
  period: (r) => r.label, detailTitle: (p) => `Revenue by account · ${p}`,
  detail: [
    { title: 'Revenue by account', rows: (d) => d.accounts, columns: [ACCT, { label: 'This window', value: (r) => r.cur, fmt: 'usd' }, { label: 'Year earlier', value: (r) => r.old, fmt: 'usd' }, { label: 'Change', value: (r) => r.change, fmt: 'usd' }, { label: 'Growth', value: (r) => r.growth, fmt: 'pct1' }] },
    { title: 'By month', rows: (d) => d.per_month, columns: [{ label: 'Month', value: (r) => r.month }, { label: 'Revenue', value: (r) => r.revenue, fmt: 'usd' }, { label: 'Year earlier', value: (r) => r.prev_revenue, fmt: 'usd' }, { label: 'Growth', value: (r) => r.growth, fmt: 'pct1' }] }
  ],
  method: [
    'Growth(W) = 100 × (Revenue(W) ÷ Revenue(W − 1 year) − 1); revenue added = Revenue(W) − Revenue(W − 1 year).',
    'Recurring YoY on summed MRR; non-recurring YoY on revenue − MRR. vs plan = 100 × (Revenue(W) ÷ plan revenue(W) − 1).'
  ]
}

const cash: PageCfg = {
  page: 'cash', codes: ['CB-05'], title: 'Cash & runway', subtitle: 'Unrestricted cash at month end and months of runway at the recent burn rate.',
  controls: [GRAIN('month')],
  kpis: (p) => {
    const l = p.latest ?? {}
    const y = p.year_ago ?? {}
    return [
      { label: `Cash · ${l.label ?? '-'}`, value: l.cash, fmt: 'usd', sub: y.cash != null ? `year ago $${Math.round(y.cash).toLocaleString()}` : undefined },
      { label: 'Runway', value: l.self_funding ? 'Self-funding' : l.runway, fmt: l.self_funding ? 'text' : 'months', tone: l.self_funding ? 'good' : l.runway < 18 ? 'bad' : undefined },
      { label: 'Avg monthly change', value: l.avg_decline != null ? -l.avg_decline : null, fmt: 'usd', tone: l.avg_decline <= 0 ? 'good' : 'bad' },
      { label: 'Change vs prior month', value: l.change, fmt: 'usd', tone: l.change >= 0 ? 'good' : 'bad' },
      { label: 'Accounts receivable', value: l.ar, fmt: 'usd', tone: l.ar_negative ? 'bad' : undefined }
    ]
  },
  note: (p) => (p.stale?.length ? `Months identical to the month before (not synced yet) are hidden: ${p.stale.join(', ')}.` : null),
  charts: [
    { title: 'Cash at period end', x: (r) => r.label, yFmt: 'usd', series: () => [{ label: 'Cash', value: (r) => r.cash, type: 'area' }, { label: 'Cash + negative A/R (data check)', value: (r) => r.cash_ex_excess, dashed: true }] },
    { title: 'Monthly change in cash', x: (r) => r.label, yFmt: 'usd', series: () => [{ label: 'Change', value: (r) => r.change, type: 'bar' }] }
  ],
  columns: [
    { label: 'Month', value: (r) => r.label }, { label: 'As of', value: (r) => r.as_of }, { label: 'Cash', value: (r) => r.cash, fmt: 'usd' },
    { label: 'Change', value: (r) => r.change, fmt: 'usd', tone: (r) => (r.change < 0 ? 'bad' : undefined) }, { label: 'Avg monthly decline', value: (r) => r.avg_decline, fmt: 'usd' },
    { label: 'Runway (months)', value: (r) => (r.self_funding ? 'Self-funding' : r.runway), fmt: 'num' }, { label: 'A/R', value: (r) => r.ar, fmt: 'usd' },
    { label: 'Cash + negative A/R', value: (r) => r.cash_ex_excess, fmt: 'usd' }
  ],
  period: (r) => r.month, detailTitle: (m) => `Cash · ${m}`,
  detailSummary: (d) => [{ label: 'Cash', value: d.r?.cash, fmt: 'usd' }, { label: `Cash ${d.lookback} months earlier`, value: d.back?.cash, fmt: 'usd' }, { label: 'Runway', value: d.r?.self_funding ? 'Self-funding' : d.r?.runway, fmt: d.r?.self_funding ? 'text' : 'months' }],
  detail: [{ title: 'Bank accounts', rows: (d) => d.accounts, columns: [ACCT, { label: 'Balance', value: (r) => r.amount, fmt: 'usd2' }, { label: 'Counted as cash', value: (r) => r.chosen, fmt: 'bool' }, { label: 'Restricted', value: (r) => r.restricted, fmt: 'bool' }] }],
  method: [
    'Cash(e) = month-end balances of the unrestricted cash accounts (restricted / collateral cash excluded).',
    'Runway = Cash(e) ÷ ((Cash(e − n) − Cash(e)) ÷ n), n = the look-back (3); "Self-funding" when cash did not fall.'
  ]
}

const fcf: PageCfg = {
  page: 'fcf', codes: ['CB-07'], title: 'FCF conversion', subtitle: '(Operating cash flow − capex) ÷ EBITDA.',
  controls: [{ key: 'view', label: 'View', options: [['ttm', 'Trailing 12 months'], ['month', 'Single month']], default: 'ttm' }],
  kpis: (p, q) => {
    const l = p.latest ?? {}
    const t = (q.view ?? 'ttm') === 'ttm'
    const k = (x: string) => (t ? l[`t_${x}`] : l[x])
    return [
      { label: `FCF conversion · ${l.month ?? '-'}`, value: t ? l.fcf_pct : l.m_fcf_pct, fmt: 'pct1' },
      { label: 'Free cash flow', value: k('fcf'), fmt: 'usd', tone: k('fcf') < 0 ? 'bad' : undefined }, { label: 'Operating cash flow', value: k('ocf'), fmt: 'usd' },
      { label: 'Capex', value: k('capex'), fmt: 'usd' }, { label: 'EBITDA', value: k('ebitda'), fmt: 'usd' },
      { label: 'FCF % without the A/R swing', value: t ? l.fcf_pct_x_ar : null, fmt: 'pct1' }
    ]
  },
  charts: [
    { title: 'FCF conversion %', x: (r) => r.month, yFmt: 'pct', series: () => [{ label: 'FCF % (TTM)', value: (r) => r.fcf_pct }, { label: 'Without the A/R swing', value: (r) => r.fcf_pct_x_ar, dashed: true }, { label: 'Single month', value: (r) => r.m_fcf_pct, dashed: true }] },
    { title: 'Operating cash flow, capex, EBITDA and FCF (TTM)', x: (r) => r.month, yFmt: 'usd', series: () => [{ label: 'OCF', value: (r) => r.t_ocf ?? r.ocf, type: 'bar' }, { label: 'Capex', value: (r) => r.t_capex ?? r.capex, type: 'bar' }, { label: 'EBITDA', value: (r) => r.t_ebitda ?? r.ebitda }, { label: 'FCF', value: (r) => r.t_fcf ?? r.fcf }] }
  ],
  columns: (_p, q) => {
    const t = (q.view ?? 'ttm') === 'ttm'
    const k = (x: string) => (r: Row) => (t ? r[`t_${x}`] : r[x])
    return [
      { label: 'Month', value: (r) => r.month }, { label: 'Net income', value: k('ni'), fmt: 'usd' }, { label: '+ D&A', value: k('da'), fmt: 'usd' },
      { label: '− Δ working capital', value: k('dwc'), fmt: 'usd' }, { label: '= OCF', value: k('ocf'), fmt: 'usd' }, { label: 'Capex', value: k('capex'), fmt: 'usd' },
      { label: 'FCF', value: k('fcf'), fmt: 'usd' }, { label: 'EBITDA', value: k('ebitda'), fmt: 'usd' },
      { label: 'FCF %', value: (r) => (t ? r.fcf_pct : r.m_fcf_pct), fmt: 'pct1' }
    ]
  },
  period: (r) => r.month, detailTitle: (m) => `FCF · 12 months to ${m}`,
  detail: [
    { title: 'Months in the window', rows: (d) => d.months, columns: [{ label: 'Month', value: (r) => r.month }, { label: 'Net income', value: (r) => r.ni, fmt: 'usd' }, { label: 'D&A', value: (r) => r.da, fmt: 'usd' }, { label: 'Δ WC', value: (r) => r.dwc, fmt: 'usd' }, { label: 'OCF', value: (r) => r.ocf, fmt: 'usd' }, { label: 'Capex', value: (r) => r.capex, fmt: 'usd' }, { label: 'FCF', value: (r) => r.fcf, fmt: 'usd' }, { label: 'EBITDA', value: (r) => r.ebitda, fmt: 'usd' }] },
    { title: 'Capex by account', rows: (d) => d.capex_by_account, columns: [ACCT, { label: 'Capex', value: (r) => r.amount, fmt: 'usd' }] }
  ],
  method: [
    'OCF_TTM = net income_TTM + D&A_TTM − ΔWC; ΔWC = [(AR + prepaid + inventory) − (AP + cards + accrued + deferred revenue)] at e minus the same at e − 12.',
    'Capex = increase in the month-end balances of the capex accounts.',
    'FCF conversion % = (OCF − capex) ÷ EBITDA, each summed over the trailing 12 months.'
  ]
}

const ccc: PageCfg = {
  page: 'ccc', codes: ['CB-10'], title: 'Cash conversion cycle', subtitle: 'Days to collect + days in inventory − days to pay, on quarter-end balances.',
  controls: [{ key: 'view', label: 'View', options: [['quarter', 'Quarter ends'], ['month', 'Every month (3 months ending)']], default: 'quarter' }],
  kpis: (p) => {
    const l = p.latest ?? {}
    return [
      { label: `CCC · ${l.label ?? '-'}`, value: l.ccc, fmt: 'days', sub: 'Quarterly' }, { label: 'DSO', value: l.dso, fmt: 'days' }, { label: 'DIO', value: l.dio, fmt: 'days' },
      { label: 'DPO', value: l.dpo, fmt: 'days' }, { label: 'Working capital', value: l.wc, fmt: 'usd', tone: l.wc < 0 ? 'bad' : undefined }
    ]
  },
  charts: [
    { title: 'Cash conversion cycle and its parts (days)', x: (r) => r.label, yFmt: 'num', series: () => [{ label: 'CCC', value: (r) => r.ccc }, { label: 'DSO', value: (r) => r.dso, dashed: true }, { label: 'DIO', value: (r) => r.dio, dashed: true }, { label: 'DPO', value: (r) => r.dpo, dashed: true }] },
    { title: 'Working capital: AR + inventory − AP', x: (r) => r.label, yFmt: 'usd', series: () => [{ label: 'AR', value: (r) => r.ar, type: 'bar' }, { label: 'Inventory', value: (r) => r.inventory, type: 'bar' }, { label: 'AP', value: (r) => -r.ap, type: 'bar' }, { label: 'Working capital', value: (r) => r.wc }] }
  ],
  columns: [
    { label: 'Period', value: (r) => r.label }, { label: 'Days', value: (r) => r.days, fmt: 'int' }, { label: 'Revenue (3 mo)', value: (r) => r.revenue, fmt: 'usd' },
    { label: 'COGS (3 mo)', value: (r) => r.cogs, fmt: 'usd' }, { label: 'AR', value: (r) => r.ar, fmt: 'usd' }, { label: 'Inventory', value: (r) => r.inventory, fmt: 'usd' },
    { label: 'AP', value: (r) => r.ap, fmt: 'usd' }, { label: 'DSO', value: (r) => r.dso, fmt: 'num' }, { label: 'DIO', value: (r) => r.dio, fmt: 'num' },
    { label: 'DPO', value: (r) => r.dpo, fmt: 'num' }, { label: 'CCC', value: (r) => r.ccc, fmt: 'num' }, { label: 'Working capital', value: (r) => r.wc, fmt: 'usd' }
  ],
  period: (r) => r.month, detailTitle: (m) => `Cash conversion cycle · ${m}`,
  detailSummary: (d) => [{ label: 'DSO', value: d.r?.dso, fmt: 'days' }, { label: 'DIO', value: d.r?.dio, fmt: 'days' }, { label: 'DPO', value: d.r?.dpo, fmt: 'days' }, { label: 'CCC', value: d.r?.ccc, fmt: 'days' }, { label: 'Days in window', value: d.r?.days, fmt: 'int' }],
  detail: [{ title: 'AR / inventory / AP accounts', rows: (d) => (d.lines ?? []).map((l: Row) => ({ ...l, catLabel: d.categories?.[l.cat] ?? l.cat })), columns: [{ label: 'Category', value: (r) => r.catLabel }, ACCT, { label: 'Balance', value: (r) => r.amount, fmt: 'usd2' }] }],
  method: [
    'DSO = AR(e) ÷ revenue_q × D, DIO = inventory(e) ÷ COGS_q × D, DPO = AP(e) ÷ COGS_q × D; D = calendar days in the 3 months (92 for Q3).',
    'CCC = DSO + DIO − DPO. Revenue and COGS from the EBITDA classification; working capital $ = AR + inventory − AP.'
  ]
}

const rankingDetail: DetailSection = {
  title: 'Largest customer groups (TTM recognized revenue)', rows: (d) => d.r?.ranking ?? [],
  columns: [{ label: '#', value: (r) => r.rank, fmt: 'int' }, { label: 'Group', value: (r) => r.name }, { label: 'Revenue', value: (r) => r.revenue, fmt: 'usd' }, { label: 'Share', value: (r) => r.share, fmt: 'pct' }]
}
const withRank = (d: Row) => ({ ...d, r: d.r ? { ...d.r, ranking: (d.r.ranking ?? []).map((x: Row, i: number) => ({ ...x, rank: i + 1 })) } : d.r })

const concentration: PageCfg = {
  page: 'concentration', codes: ['CM-02'], title: 'Customer concentration', subtitle: 'Share of trailing-12-month revenue from the largest customer groups.',
  controls: [{ key: 'line', label: 'Product line', options: (p) => [['All', 'All classes'], ...Object.keys(p.by_line ?? {}).map((k): [string, string] => [k, k])], default: 'All' }],
  kpis: (p) => {
    const l = p.latest ?? {}
    const y = p.year_ago ?? {}
    return [
      { label: `Top-${l.top_n ?? 10} share · TTM ${l.month ?? '-'}`, value: l.share, fmt: 'pct', sub: y.share != null ? `year ago ${y.share.toFixed(2)}%` : undefined },
      { label: 'Largest customer', value: l.largest, fmt: 'pct', sub: l.largest_name }, { label: `Top-${l.top_n ?? 10} on invoice totals`, value: l.inv_share, fmt: 'pct' },
      { label: `Top-${l.top_n ?? 10} revenue`, value: l.top, fmt: 'usd' }, { label: 'TTM revenue', value: l.total, fmt: 'usd' }, { label: 'Customer groups', value: l.groups, fmt: 'int' }
    ]
  },
  charts: [
    { title: 'Top-N and largest-customer share', x: (r) => r.month, yFmt: 'pct', series: () => [{ label: 'Top-N share', value: (r) => r.share }, { label: 'Largest customer', value: (r) => r.largest }, { label: 'Top-N on invoice totals', value: (r) => r.inv_share, dashed: true }] },
    {
      title: 'Top-N share by QuickBooks class (product line)', x: (r) => r.month, yFmt: 'pct',
      rows: (p) => rowsOf(p).map((r) => ({ month: r.month, ...Object.fromEntries(Object.entries(p.by_line ?? {}).map(([k, v]) => [k, (v as Row[]).find((x) => x.month === r.month)?.share])) })),
      series: (p) => Object.keys(p.by_line ?? {}).map((k) => ({ label: k, value: (r: Row) => r[k] }))
    }
  ],
  columns: [
    { label: 'Month', value: (r) => r.month }, { label: 'Top-N share', value: (r) => r.share, fmt: 'pct' }, { label: 'Largest', value: (r) => r.largest, fmt: 'pct' },
    { label: 'Largest customer', value: (r) => r.largest_name }, { label: 'Invoiced basis', value: (r) => r.inv_share, fmt: 'pct' }, { label: 'Top-N revenue', value: (r) => r.top, fmt: 'usd' },
    { label: 'TTM revenue', value: (r) => r.total, fmt: 'usd' }, { label: 'Groups', value: (r) => r.groups, fmt: 'int' }
  ],
  period: (r) => r.month, detailTitle: (m) => `Top customers · TTM ${m}`,
  detailSummary: (d0) => {
    const d = withRank(d0)
    return [{ label: 'Top-N share', value: d.r?.share, fmt: 'pct' }, { label: 'TTM revenue', value: d.r?.total, fmt: 'usd' }, { label: 'Groups', value: d.r?.groups, fmt: 'int' }]
  },
  detail: [{ ...rankingDetail, rows: (d) => withRank(d).r?.ranking ?? [] }],
  method: [
    'Top-N share = 100 × Σ revenue of the N largest customer groups ÷ Σ revenue of all groups, over the 12 months ending at e.',
    'Groups = top Salesforce parent, else QuickBooks parent, else the customer. Annual subscriptions are spread 1/12 per month from the service start; CAD → USD.',
    'Invoiced basis: top-N on invoice totals by invoice date.'
  ]
}

const diversification: PageCfg = {
  page: 'diversification', codes: ['ER-05'], title: 'Customer & revenue diversification', subtitle: 'Share of trailing-12-month revenue from the 5 largest customer groups.',
  controls: [],
  kpis: (p) => {
    const l = p.latest ?? {}
    const y = p.year_ago ?? {}
    const thr = p.cfg?.threshold ?? 0
    return [
      { label: `Top-${l.top_n ?? 5} share · TTM ${l.month ?? '-'}`, value: l.share, fmt: 'pct', tone: thr > 0 && l.share > thr ? 'bad' : undefined, sub: y.share != null ? `year ago ${y.share.toFixed(2)}%` : undefined },
      { label: 'Largest group', value: l.largest, fmt: 'pct', sub: l.largest_name }, { label: `Top-${l.top_n ?? 5} revenue`, value: l.top, fmt: 'usd' },
      { label: 'TTM revenue', value: l.total, fmt: 'usd' }, { label: 'Customer groups', value: l.groups, fmt: 'int' }
    ]
  },
  charts: [{ title: 'Top-N and largest-group share (rolling monthly)', x: (r) => r.month, yFmt: 'pct', series: () => [{ label: 'Top-N share', value: (r) => r.share }, { label: 'Largest group', value: (r) => r.largest }], refs: (p) => (p.cfg?.threshold > 0 ? [{ y: p.cfg.threshold, label: 'threshold' }] : []) }],
  columns: concentration.columns,
  period: (r) => r.month, detailTitle: (m) => `Top groups · TTM ${m}`,
  detail: [{ ...rankingDetail, rows: (d) => withRank(d).r?.ranking ?? [] }],
  method: ['Top-5 share = 100 × Σ revenue of the 5 largest customer groups ÷ Σ all groups, TTM recognized revenue, rolling monthly — CM-02 with N = 5.']
}

const winRate: PageCfg = {
  page: 'win_rate', codes: ['CM-03'], title: 'Competitive win rate', subtitle: 'Won ÷ decided New Business deals naming each tracked competitor.',
  controls: [{ key: 'view', label: 'Window', options: [['period', 'Trailing 6 months'], ['ttm', 'Trailing 12 months']], default: 'period' }, GRAIN('month')],
  kpis: (p) => {
    const l = p.latest ?? {}
    const comps: string[] = p.info?.competitors ?? []
    return [
      { label: 'Competitor logged', value: l.logged, fmt: 'pct1', sub: `${l.logged_n ?? 0} of ${l.closed ?? 0} closed deals` },
      ...comps.slice(0, 5).map((c): Kpi => ({ label: `${c === p.info?.headline ? '★ ' : ''}vs ${c}`, value: l.comp?.[c]?.rate, fmt: 'pct1', sub: `${l.comp?.[c]?.won ?? 0} won of ${l.comp?.[c]?.decided ?? 0} decided` }))
    ]
  },
  note: (p) => (!(p.info?.competitors ?? []).length ? 'No competitor is recorded on the synced deals, so there is nothing to show yet. Pick the competitor field in Settings → Metric settings (Oryon) → Competitor win rate.' : null),
  charts: [
    { title: 'Win rate by competitor', x: (r) => r.label, yFmt: 'pct', series: (p) => (p.info?.competitors ?? []).map((c: string) => ({ label: c, value: (r: Row) => r.comp?.[c]?.rate })) },
    { title: 'Competitor logging rate and decided deals vs the headline competitor', x: (r) => r.label, yFmt: 'int', rightFmt: 'pct', series: (p) => [{ label: `Decided vs ${p.info?.headline ?? '-'}`, value: (r) => r.comp?.[p.info?.headline]?.decided, type: 'bar' }, { label: 'Logged %', value: (r) => r.logged, axis: 'right' }] }
  ],
  columns: (p) => [
    { label: 'Period', value: (r) => r.label }, { label: 'Closed NB deals', value: (r) => r.closed, fmt: 'int' }, { label: 'Logged %', value: (r) => r.logged, fmt: 'pct1' },
    ...(p.info?.competitors ?? []).flatMap((c: string): Column[] => [{ label: `${c} decided`, value: (r) => r.comp?.[c]?.decided, fmt: 'int' }, { label: `${c} win rate`, value: (r) => r.comp?.[c]?.rate, fmt: 'pct1' }])
  ],
  period: (r) => r.month, detailTitle: (m) => `Win rate · window ending ${m}`,
  detail: [{
    title: 'Per competitor', rows: (d) => Object.entries(d.r?.comp ?? {}).map(([name, v]) => ({ name, ...(v as Row) })),
    columns: [{ label: 'Competitor', value: (r) => r.name }, { label: 'Deals', value: (r) => r.deals, fmt: 'int' }, { label: 'No decision (dropped)', value: (r) => r.no_decision, fmt: 'int' }, { label: 'Decided', value: (r) => r.decided, fmt: 'int' }, { label: 'Won', value: (r) => r.won, fmt: 'int' }, { label: 'Win rate', value: (r) => r.rate, fmt: 'pct1' }]
  }],
  method: [
    'Deals = closed (won or lost) New Business deals with a close date in the trailing 6 months (12 on TTM).',
    'Win rate vs c = 100 × won ÷ decided, decided = deals naming c minus losses with a "no decision" loss reason.',
    'Competitor logged = deals with a competitor ÷ all closed New Business deals in the window.'
  ]
}

const STEPS: Array<[string, string, string, string]> = [['l2m', 'Lead → MQL', 'lead', 'l2m'], ['m2s', 'MQL → SQL', 'mql', 'm2s'], ['s2o', 'SQL → opportunity', 'sql', 's2o'], ['o2w', 'Opportunity → won', 'opp', 'o2w'], ['s2w', 'SQL → won', 'sql', 's2w']]
const funnel: PageCfg = {
  page: 'funnel', codes: ['CM-06'], title: 'Funnel conversion', subtitle: 'Conversion between lifecycle stages, by cohort month.',
  controls: [GRAIN('month'), WINDOW('view')],
  kpis: (p) => {
    const l = p.latest ?? {}
    return STEPS.map(([k, label, base, conv]): Kpi => ({ label: `${label}${l.immature?.[k] ? ' · immature' : ''}`, value: l[`${k}_pct`], fmt: 'pct1', sub: `${l[conv] ?? 0} of ${l[base] ?? 0}` }))
  },
  charts: [
    { title: 'Conversion rates', x: (r) => r.label, yFmt: 'pct', series: () => STEPS.map(([k, label]) => ({ label, value: (r: Row) => r[`${k}_pct`] })) },
    { title: 'Cohort sizes', x: (r) => r.label, yFmt: 'int', series: () => [{ label: 'Leads', value: (r) => r.lead, type: 'bar' }, { label: 'MQLs', value: (r) => r.mql, type: 'bar' }, { label: 'SQLs', value: (r) => r.sql, type: 'bar' }, { label: 'Opportunities', value: (r) => r.opp, type: 'bar' }] }
  ],
  columns: [
    { label: 'Period', value: (r) => r.label },
    ...STEPS.flatMap(([k, label, base, conv]): Column[] => [{ label: `${label} cohort`, value: (r) => r[base], fmt: 'int' }, { label: `${label} converted`, value: (r) => r[conv], fmt: 'int' }, { label: `${label} %`, value: (r) => r[`${k}_pct`], fmt: 'pct1' }])
  ],
  period: (r) => r.month, detailTitle: (m) => `Funnel cohorts · ${m}`,
  detail: [{ title: 'By cohort month', rows: (d) => d.months, columns: [{ label: 'Month', value: (r) => r.month }, { label: 'Leads', value: (r) => r.lead, fmt: 'int' }, { label: '→ MQL', value: (r) => r.l2m, fmt: 'int' }, { label: 'MQLs', value: (r) => r.mql, fmt: 'int' }, { label: '→ SQL', value: (r) => r.m2s, fmt: 'int' }, { label: 'SQLs', value: (r) => r.sql, fmt: 'int' }, { label: '→ opportunity', value: (r) => r.s2o, fmt: 'int' }, { label: '→ won', value: (r) => r.s2w, fmt: 'int' }, { label: 'Age (days)', value: (r) => r.age, fmt: 'int' }] }],
  method: [
    'MQL → SQL = contacts with an MQL date in the cohort that have an SQL date ÷ those contacts (headline).',
    'Lead → MQL = marketing-sourced, non-duplicate contacts created in the cohort with an MQL date ÷ those.',
    'SQL cohort = contacts with an SQL date in the cohort that also have an MQL date; SQL → opportunity / won and opportunity → won from there.',
    'Stage dates from the lifecycle-stage history; TTM pools 12 cohort months; recent cohorts are marked immature.'
  ]
}

const mql: PageCfg = {
  page: 'mql', codes: ['CM-08'], title: 'Lead volume vs plan (MQLs)', subtitle: 'MQLs (first MQL date) against the budgeted MQL target.',
  controls: [GRAIN('month'), WINDOW('view')],
  kpis: (p) => {
    const l = p.latest ?? {}
    const thr = p.info?.threshold ?? 0
    return [
      { label: `MQLs vs plan · ${l.label ?? '-'}`, value: l.pct, fmt: 'pct1', tone: l.pct != null && l.pct < thr ? 'bad' : 'good' },
      { label: 'MQLs', value: l.mqls, fmt: 'int' }, { label: 'Plan', value: l.plan, fmt: 'int' }, { label: 'MQLs − plan', value: l.diff, fmt: 'int', tone: l.diff < 0 ? 'bad' : 'good' }
    ]
  },
  charts: [
    { title: 'MQLs and plan', x: (r) => r.label, yFmt: 'int', series: () => [{ label: 'MQLs', value: (r) => r.mqls, type: 'bar' }, { label: 'Plan', value: (r) => r.plan, dashed: true }] },
    { title: 'MQLs vs plan (%)', x: (r) => r.label, yFmt: 'pct', series: () => [{ label: 'vs plan', value: (r) => r.pct, type: 'bar' }], refs: () => [{ y: 0, label: 'plan' }] }
  ],
  columns: [
    { label: 'Period', value: (r) => r.label }, { label: 'MQLs', value: (r) => r.mqls, fmt: 'int' }, { label: 'Plan', value: (r) => r.plan, fmt: 'num' },
    { label: 'MQLs − plan', value: (r) => r.diff, fmt: 'num', tone: (r) => (r.diff < 0 ? 'bad' : undefined) }, { label: 'vs plan', value: (r) => r.pct, fmt: 'pct1' }
  ],
  period: (r) => r.month, detailTitle: (m) => `MQLs and plan by month · ${m}`,
  detail: [{ title: 'Months', rows: (d) => d.r?.months ?? [], columns: [{ label: 'Month', value: (r) => r.month }, { label: 'MQLs', value: (r) => r.mqls, fmt: 'int' }, { label: 'Plan', value: (r) => r.plan, fmt: 'num' }] }],
  method: [
    'MQLs vs plan = 100 × (MQLs ÷ plan − 1); MQLs = contacts whose first MQL date is in the window (recycled MQLs count once).',
    'Plan = the budgeted MQL targets in the window; a month carries a third of its quarter.'
  ]
}

const dealColumns = (value: string): Column[] => [
  { label: 'Date', value: (r) => r.date }, { label: 'Deal', value: (r) => r.name }, { label: 'Account', value: (r) => r.account }, { label: 'Lead source', value: (r) => r.source },
  { label: 'Stage', value: (r) => r.stage }, { label: value, value: (r) => r.value, fmt: 'usd' }
]

const roi: PageCfg = {
  page: 'roi', codes: ['CM-07'], title: 'Marketing ROI by channel', subtitle: 'New-business pipeline created from marketing sources ÷ marketing spend.',
  controls: [GRAIN('quarter'), WINDOW('view')],
  kpis: (p) => {
    const l = p.latest ?? {}
    const thr = p.cfg?.threshold ?? 1
    return [
      { label: `Blended ROI · ${l.label ?? '-'}`, value: l.blended, fmt: 'x', tone: l.blended != null && l.blended < thr ? 'bad' : 'good' },
      { label: 'Programs ROI', value: l.programs, fmt: 'x' }, { label: 'Pipeline created', value: l.pipeline, fmt: 'usd', sub: `${l.deals ?? 0} deals` },
      { label: 'Marketing spend', value: l.blended_spend, fmt: 'usd' },
      ...(l.channels ?? []).slice(0, 2).map((c: Row): Kpi => ({ label: c.name, value: c.roi, fmt: 'x', sub: `${c.deals} deals` }))
    ]
  },
  note: (p) => (p.latest && p.latest.blended == null ? 'No marketing spend found for the selected accounts — pick them in Settings → Metric settings (Oryon) → Marketing ROI by channel.' : null),
  charts: [
    { title: 'Blended and programs ROI', x: (r) => r.label, yFmt: 'x', series: () => [{ label: 'Blended', value: (r) => r.blended }, { label: 'Programs', value: (r) => r.programs }], refs: (p) => [{ y: p.cfg?.threshold ?? 1, label: 'threshold' }] },
    { title: 'ROI by channel', x: (r) => r.label, yFmt: 'x', series: (p) => ((p.latest?.channels ?? []) as Row[]).map((c, i) => ({ label: c.name, value: (r: Row) => r.channels?.[i]?.roi })) }
  ],
  columns: (p) => [
    { label: 'Period', value: (r) => r.label }, { label: 'Pipeline', value: (r) => r.pipeline, fmt: 'usd' }, { label: 'Deals', value: (r) => r.deals, fmt: 'int' },
    { label: 'Blended spend', value: (r) => r.blended_spend, fmt: 'usd' }, { label: 'Blended ROI', value: (r) => r.blended, fmt: 'x' },
    { label: 'Programs spend', value: (r) => r.programs_spend, fmt: 'usd' }, { label: 'Programs ROI', value: (r) => r.programs, fmt: 'x' },
    ...((p.latest?.channels ?? []) as Row[]).flatMap((c, i): Column[] => [{ label: `${c.name} pipeline`, value: (r) => r.channels?.[i]?.pipeline, fmt: 'usd' }, { label: `${c.name} spend`, value: (r) => r.channels?.[i]?.spend, fmt: 'usd' }, { label: `${c.name} ROI`, value: (r) => r.channels?.[i]?.roi, fmt: 'x' }])
  ],
  period: (r) => r.month, detailTitle: (m) => `Pipeline deals · period ending ${m}`,
  detail: [
    { title: 'By lead source', rows: (d) => d.by_source, columns: [{ label: 'Lead source', value: (r) => r.source }, { label: 'Deals', value: (r) => r.n, fmt: 'int' }, { label: 'Pipeline', value: (r) => r.value, fmt: 'usd' }] },
    { title: 'Deals created (marketing-sourced new business)', rows: (d) => (d.deals ?? []).map((x: Row) => ({ ...x, ch: (x.channels ?? []).join(', ') })), columns: [...dealColumns('Value'), { label: 'Channels', value: (r) => r.ch }] }
  ],
  method: [
    'ROI(W) = pipeline(W) ÷ spend(W); pipeline = value of new-business deals CREATED in W (any stage) with a marketing lead source.',
    'Blended ÷ all marketing accounts; programs ÷ non-people marketing accounts; a channel = its lead sources\' deals ÷ its own P&L accounts.'
  ]
}

const msp: PageCfg = {
  page: 'msp', codes: ['CM-05'], title: 'Marketing-sourced pipeline', subtitle: 'Share of new-business ARR created from marketing lead sources, and of new-logo ARR won.',
  controls: [GRAIN('quarter'), WINDOW('view')],
  kpis: (p) => {
    const l = p.latest ?? {}
    const y = p.year_ago ?? {}
    return [
      { label: `Marketing-sourced · ${l.label ?? '-'}`, value: l.pct, fmt: 'pct', sub: y.pct != null ? `year ago ${y.pct.toFixed(2)}%` : undefined },
      { label: 'New-logo ARR won (TTM)', value: l.won_pct, fmt: 'pct' }, { label: 'Marketing ARR created', value: l.mk, fmt: 'usd', sub: `${l.n_mk ?? 0} deals` },
      { label: 'All new-business ARR', value: l.total, fmt: 'usd', sub: `${l.n ?? 0} deals` }
    ]
  },
  charts: [
    { title: 'Marketing-sourced share', x: (r) => r.label, yFmt: 'pct', series: () => [{ label: 'Created', value: (r) => r.pct }, { label: 'Won new-logo ARR (TTM)', value: (r) => r.won_pct, dashed: true }] },
    { title: 'New-business ARR created by source type', x: (r) => r.label, yFmt: 'usd', series: () => [{ label: 'Marketing', value: (r) => r.mk, type: 'bar', stack: 's' }, { label: 'Other', value: (r) => r.total - r.mk, type: 'bar', stack: 's' }] }
  ],
  columns: [
    { label: 'Period', value: (r) => r.label }, { label: 'Marketing', value: (r) => r.mk, fmt: 'usd' }, { label: 'All', value: (r) => r.total, fmt: 'usd' },
    { label: 'Deals', value: (r) => r.n, fmt: 'int' }, { label: 'Marketing deals', value: (r) => r.n_mk, fmt: 'int' }, { label: 'Marketing-sourced %', value: (r) => r.pct, fmt: 'pct' },
    { label: 'Won marketing (TTM)', value: (r) => r.won_mk, fmt: 'usd' }, { label: 'Won all (TTM)', value: (r) => r.won_total, fmt: 'usd' }, { label: 'Won %', value: (r) => r.won_pct, fmt: 'pct' }
  ],
  period: (r) => r.month, detailTitle: (m) => `Deals · period ending ${m}`,
  detail: [
    { title: 'Created by lead source', rows: (d) => d.by_source, columns: [{ label: 'Lead source', value: (r) => r.source }, { label: 'Marketing', value: (r) => r.marketing, fmt: 'bool' }, { label: 'Deals', value: (r) => r.n, fmt: 'int' }, { label: 'ARR', value: (r) => r.value, fmt: 'usd' }] },
    { title: 'New-business deals created', rows: (d) => d.created, columns: [...dealColumns('ARR'), { label: 'Marketing', value: (r) => r.mk, fmt: 'bool' }, { label: 'Duplicate account', value: (r) => r.dup, fmt: 'bool' }] },
    { title: 'Won new logos (trailing 12 months)', rows: (d) => d.won, columns: [...dealColumns('ARR'), { label: 'Marketing', value: (r) => r.mk, fmt: 'bool' }, { label: 'Repeat win', value: (r) => r.repeat, fmt: 'bool' }] }
  ],
  method: [
    'Marketing-sourced % = 100 × Σ ARR (marketing lead source) ÷ Σ ARR (all) of New Business deals created in the window; duplicate-account deals excluded.',
    'Won share = the same split of won new-logo ARR with a close date in the trailing 12 months; accounts with an earlier win dropped.'
  ]
}

export const PAGES: PageCfg[] = [mrr, retention, newLogos, cogs, cac, ltv, ga, ebitda, recurring, growth, cash, fcf, ccc, concentration, winRate, msp, funnel, roi, mql, diversification]
export const PAGE_BY_KEY = new Map(PAGES.map((p) => [p.page, p]))

/** dashboard metric id -> its full page */
export const PAGE_FOR_METRIC: Record<string, string> = {
  'VC-01': 'retention', 'VC-02': 'retention', 'VC-03': 'new_logos', 'VC-04': 'cogs', 'VC-06': 'cac', 'VC-07': 'ltv', 'VC-14': 'ltv',
  'VC-09': 'ga', 'VC-10': 'ebitda', 'VC-12': 'recurring', 'VC-13': 'growth', 'CB-05': 'cash', 'CB-07': 'fcf', 'CB-10': 'ccc',
  'CM-02': 'concentration', 'ER-05': 'diversification', 'CM-03': 'win_rate', 'CM-05': 'msp', 'CM-06': 'funnel', 'CM-07': 'roi', 'CM-08': 'mql'
}

export const PAGE_GROUPS: Array<{ name: string; pages: string[] }> = [
  { name: 'Value creation', pages: ['mrr', 'retention', 'new_logos', 'cogs', 'cac', 'ltv', 'ga', 'ebitda', 'recurring', 'growth'] },
  { name: 'Capital & balance sheet', pages: ['cash', 'fcf', 'ccc'] },
  { name: 'Customer & market', pages: ['concentration', 'win_rate', 'msp', 'funnel', 'roi', 'mql'] },
  { name: 'Exit readiness', pages: ['diversification'] }
]
