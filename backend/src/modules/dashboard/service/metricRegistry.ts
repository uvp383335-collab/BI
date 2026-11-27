import { MetricResult } from '../../metrics/metrics.types'
import { computeCM04 } from '../../metrics/service/cmMetrics.service'
import * as O from '../../metrics/oryon/oryonMetrics.service'

/**
 * Adapter between the existing metric services (`modules/metrics`) and the
 * oryon-web dashboard contract. Each entry carries the UI metadata (family,
 * unit, direction, definition) plus how to read sub-measures out of the
 * metric's `data` payload. No metric math lives here — only presentation.
 */

export type DashUnit = '%' | 'x' | 'USD' | 'USD/month' | 'days' | 'months' | 'count' | 'pts'
export type Family = 'VC' | 'CB' | 'CM'
export type Grain = 'Q' | 'MQ'

export interface Sub {
  key: string
  label: string
  unit: DashUnit
  value: number | null
}

export interface Abs {
  label: string
  unit: DashUnit
  value: number | null
}

type Data = Record<string, unknown>

export interface MetricDef {
  id: string
  family: Family
  name: string
  source: string
  unit: DashUnit
  dir: 'up' | 'down' | 'none'
  threshold: number | null
  definition: string
  /** 'Q' = only meaningful per closed quarter; in the monthly view it shows the latest completed quarter. */
  grain: Grain
  /** Point-in-time metric with no historical `period` (CB-05): only computed for the latest period. */
  latestOnly?: boolean
  /** 'P' = responds to the product filter (a QuickBooks item, via the per-product P&L snapshot). */
  filters?: 'P'
  compute: (orgId: string, month: string, provider: string, item?: string) => Promise<MetricResult>
  /** Headline override when the UI headline differs from the service's `value`. */
  value?: (r: MetricResult) => number | null
  subs: (d: Data, r: MetricResult) => Sub[]
  abs?: (d: Data) => Abs
}

export const FAMILIES: Record<Family, string> = {
  VC: 'Value creation',
  CB: 'Capital & balance sheet',
  CM: 'Customer & market'
}

export const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const sub = (d: Data, key: string, label: string, unit: DashUnit): Sub => ({ key, label, unit, value: num(d[key]) })

/**
 * Every metric except CM-04 is computed by the Oryon port of the reference
 * Python app (modules/metrics/oryon, parity-checked against mrr_app/). CM-04
 * (pipeline coverage) has no reference implementation and keeps its service.
 */
export const METRICS: MetricDef[] = [
  {
    id: 'VC-01', family: 'VC', name: 'Gross revenue retention', source: 'QuickBooks', unit: '%', dir: 'up', threshold: 90, grain: 'MQ',
    definition: 'Trailing 12 months: MRR kept from the customers paying 12 months ago, before expansion (GRR = (S - churn - downgrades) / S, constant currency).',
    filters: 'P',
    compute: (o, m, _p, item) => O.oryonVC01(o, m, item),
    subs: (d) => [sub(d, 'S', 'Starting MRR', 'USD'), sub(d, 'C', 'Churned MRR', 'USD'), sub(d, 'Dn', 'Downgrades', 'USD'), sub(d, 'cohort', 'Cohort customers', 'count')]
  },
  {
    id: 'VC-02', family: 'VC', name: 'Net revenue retention', source: 'QuickBooks', unit: '%', dir: 'up', threshold: 100, grain: 'MQ',
    definition: 'Trailing 12 months: MRR from the customers paying 12 months ago, including expansion (NRR = (S - churn - downgrades + upgrades) / S).',
    filters: 'P',
    compute: (o, m, _p, item) => O.oryonVC02(o, m, item),
    subs: (d) => [sub(d, 'U', 'Upgrades', 'USD'), sub(d, 'C', 'Churned MRR', 'USD'), sub(d, 'Dn', 'Downgrades', 'USD'), sub(d, 'E', 'Ending MRR', 'USD')]
  },
  {
    id: 'VC-03', family: 'VC', name: 'New-logo revenue growth', source: 'QuickBooks; Salesforce', unit: '%', dir: 'up', threshold: null, grain: 'MQ',
    definition: 'New-logo ARR (first-month MRR x 12, by Salesforce close month) in the trailing 12 months against the 12 months before. Win-backs excluded.',
    filters: 'P',
    compute: (o, m, _p, item) => O.oryonVC03(o, m, item),
    subs: (d) => [sub(d, 'newLogoArr', 'New-logo ARR (12 mo)', 'USD'), sub(d, 'newLogos', 'New logos', 'count'), sub(d, 'priorNewLogoArr', 'Prior 12 months', 'USD'), sub(d, 'avgArrPerLogo', 'Avg ARR per logo', 'USD')],
    abs: (d) => ({ label: 'New-logo ARR', unit: 'USD', value: num(d.newLogoArr) })
  },
  {
    id: 'VC-04', family: 'VC', name: 'COGS % and mix', source: 'QuickBooks P&L', unit: '%', dir: 'down', threshold: null, grain: 'Q',
    definition: 'COGS (incl. capitalized-software amortization) as a share of revenue for the quarter; product lines from the account mapping.',
    compute: (o, m) => O.oryonVC04(o, m),
    subs: (d) => [sub(d, 'revenue', 'Revenue', 'USD'), sub(d, 'cogs', 'COGS', 'USD'), sub(d, 'pct_ex_da', 'Excl. capitalized software', '%'), sub(d, 'platformPct', 'Platform COGS %', '%')],
    abs: (d) => ({ label: 'COGS', unit: 'USD', value: num(d.cogs) })
  },
  {
    id: 'VC-06', family: 'VC', name: 'CAC payback', source: 'QuickBooks; Salesforce', unit: 'months', dir: 'down', threshold: 18, grain: 'Q',
    definition: 'Trailing 12 months: CAC / ((new-logo ARR / new logos / 12) x gross margin). Above 18 months is a warning.',
    compute: (o, m) => O.oryonVC06(o, m),
    subs: (d) => [sub(d, 'cac', 'CAC', 'USD'), sub(d, 'sm', 'S&M spend', 'USD'), sub(d, 'new_logos', 'New logos', 'count'), sub(d, 'gmPct', 'Gross margin', '%')]
  },
  {
    id: 'VC-07', family: 'VC', name: 'LTV / CAC, new customers', source: 'Derived (VC-01, VC-06)', unit: 'x', dir: 'up', threshold: 3, grain: 'Q',
    definition: 'LTV = new-logo MRR x gross margin x min(1 / monthly churn, cap); monthly churn = 1 - GRR^(1/12). LTV / CAC.',
    compute: (o, m) => O.oryonVC07(o, m),
    subs: (d) => [sub(d, 'ltv', 'LTV', 'USD'), sub(d, 'cac', 'CAC', 'USD'), sub(d, 'churnPct', 'Monthly churn', '%'), sub(d, 'lifetime', 'Lifetime', 'months')]
  },
  {
    id: 'VC-09', family: 'VC', name: 'G&A % of revenue', source: 'QuickBooks P&L', unit: '%', dir: 'down', threshold: null, grain: 'Q',
    definition: 'G&A accounts (6410-6485, 6495, insurance) as a share of revenue for the quarter.',
    compute: (o, m) => O.oryonVC09(o, m),
    subs: (d) => [sub(d, 'ga', 'G&A', 'USD'), sub(d, 'revenue', 'Revenue', 'USD')],
    abs: (d) => ({ label: 'G&A', unit: 'USD', value: num(d.ga) })
  },
  {
    id: 'VC-10', family: 'VC', name: 'EBITDA margin', source: 'QuickBooks P&L', unit: '%', dir: 'up', threshold: null, grain: 'Q',
    definition: 'EBITDA (revenue - COGS - opex + D&A) as a share of revenue for the quarter.',
    compute: (o, m) => O.oryonVC10(o, m),
    subs: (d) => [sub(d, 'ebitda', 'EBITDA', 'USD'), sub(d, 'revenue', 'Revenue', 'USD'), sub(d, 'previousQuarterMargin', 'Prior quarter', '%'), sub(d, 'vs_plan', 'Vs plan', 'pts')],
    abs: (d) => ({ label: 'EBITDA', unit: 'USD', value: num(d.ebitda) })
  },
  {
    id: 'VC-12', family: 'VC', name: 'Recurring revenue % of total', source: 'QuickBooks', unit: '%', dir: 'up', threshold: null, grain: 'Q',
    definition: 'Customer MRR summed over the quarter as a share of GL revenue (account-tagged 4010 + 4015 basis shown alongside).',
    compute: (o, m) => O.oryonVC12(o, m),
    subs: (d) => [sub(d, 'mrr', 'Recurring (MRR)', 'USD'), sub(d, 'revenue', 'GL revenue', 'USD'), sub(d, 'tagged_pct', 'Account-tagged %', '%')]
  },
  {
    id: 'VC-13', family: 'VC', name: 'Revenue growth', source: 'QuickBooks', unit: '%', dir: 'up', threshold: null, grain: 'Q',
    definition: 'Quarter revenue against the same quarter last year; recurring on summed MRR, non-recurring on revenue - MRR.',
    compute: (o, m) => O.oryonVC13(o, m),
    subs: (d) => [sub(d, 'revenue', 'Revenue', 'USD'), sub(d, 'rec_growth', 'Recurring YoY', '%'), sub(d, 'nonrec_growth', 'Non-recurring YoY', '%'), sub(d, 'added', 'Revenue added', 'USD')],
    abs: (d) => ({ label: 'Revenue', unit: 'USD', value: num(d.revenue) })
  },
  {
    id: 'VC-14', family: 'VC', name: 'LTV / CAC, whole base', source: 'Derived (VC-01, VC-06)', unit: 'x', dir: 'up', threshold: 3, grain: 'Q',
    definition: 'As VC-07 with the average MRR of all active customers (ARR / customers / 12).',
    compute: (o, m) => O.oryonVC14(o, m),
    subs: (d) => [sub(d, 'base_ltv', 'LTV', 'USD'), sub(d, 'base_avg_mrr', 'Avg MRR / customer', 'USD/month'), sub(d, 'customers', 'Active customers', 'count')]
  },
  {
    id: 'CB-05', family: 'CB', name: 'Cash position and runway', source: 'QuickBooks Balance Sheet', unit: 'USD', dir: 'up', threshold: null, grain: 'MQ',
    definition: 'Month-end unrestricted cash; runway = cash / average monthly decline over the look-back (blank = self-funding).',
    compute: (o, m) => O.oryonCB05(o, m),
    subs: (d) => [sub(d, 'runway', 'Runway', 'months'), sub(d, 'avg_decline', 'Avg monthly decline', 'USD/month'), sub(d, 'change', 'Change vs prior month', 'USD'), sub(d, 'ar', 'Accounts receivable', 'USD')]
  },
  {
    id: 'CB-07', family: 'CB', name: 'Free cash flow conversion', source: 'QuickBooks', unit: '%', dir: 'up', threshold: null, grain: 'MQ',
    definition: 'Trailing 12 months: (OCF - capex) / EBITDA; OCF = net income + D&A - change in working capital.',
    compute: (o, m) => O.oryonCB07(o, m),
    subs: (d) => [sub(d, 't_fcf', 'Free cash flow', 'USD'), sub(d, 't_ocf', 'Operating cash flow', 'USD'), sub(d, 't_capex', 'Capex', 'USD'), sub(d, 't_ebitda', 'EBITDA', 'USD')]
  },
  {
    id: 'CB-10', family: 'CB', name: 'Cash conversion cycle', source: 'QuickBooks (AR, AP, inventory)', unit: 'days', dir: 'down', threshold: null, grain: 'Q',
    definition: 'DSO + DIO - DPO on quarter-end balances, against the quarter revenue / COGS and its calendar days.',
    compute: (o, m) => O.oryonCB10(o, m),
    subs: (d) => [sub(d, 'dso', 'Days to collect', 'days'), sub(d, 'dio', 'Days in inventory', 'days'), sub(d, 'dpo', 'Days to pay', 'days'), sub(d, 'wc', 'Working capital', 'USD')]
  },
  {
    id: 'CM-02', family: 'CM', name: 'Customer concentration', source: 'QuickBooks; Salesforce', unit: '%', dir: 'down', threshold: null, grain: 'MQ',
    definition: 'Share of trailing-twelve-month recognized revenue from the ten largest customer groups (top Salesforce parent, else QuickBooks parent).',
    filters: 'P',
    compute: (o, m, _p, item) => O.oryonCM02(o, m, item),
    subs: (d) => [sub(d, 'top5Share', 'Top 5 share', '%'), sub(d, 'largest', 'Largest customer', '%'), sub(d, 'groups', 'Customer groups', 'count'), sub(d, 'total', 'TTM revenue', 'USD')]
  },
  {
    id: 'ER-05', family: 'CM', name: 'Customer & revenue diversification', source: 'QuickBooks; Salesforce', unit: '%', dir: 'down', threshold: null, grain: 'MQ',
    definition: 'Share of trailing-twelve-month recognized revenue from the five largest customer groups (CM-02 with N = 5).',
    filters: 'P',
    compute: (o, m, _p, item) => O.oryonER05(o, m, item),
    subs: (d) => [sub(d, 'largest', 'Largest group', '%'), sub(d, 'top', 'Top-5 revenue', 'USD'), sub(d, 'groups', 'Customer groups', 'count')]
  },
  {
    id: 'CM-03', family: 'CM', name: 'Win rate vs tracked competitor', source: 'Salesforce', unit: '%', dir: 'up', threshold: null, grain: 'MQ',
    definition: 'Trailing 6 months: won / decided New Business deals naming the headline competitor ("no decision" losses dropped).',
    compute: (o, m) => O.oryonCM03(o, m),
    subs: (d) => [sub(d, 'headlineDecided', 'Decided deals', 'count'), sub(d, 'headlineWon', 'Won', 'count'), sub(d, 'closed', 'Closed new business', 'count'), sub(d, 'logged', 'Competitor logged', '%')]
  },
  {
    id: 'CM-04', family: 'CM', name: 'Pipeline coverage', source: 'CRM; operating plan', unit: 'x', dir: 'up', threshold: 3, grain: 'Q',
    definition: 'Qualified new-business pipeline created this quarter divided by this quarter’s new-business target — same create-date logic as the monthly Pipeline Coverage Ratio chart.',
    compute: (o, m, p) => computeCM04(o, p, m),
    subs: (d) => [sub(d, 'qualifiedPipelineAmount', 'Qualified pipeline', 'USD'), sub(d, 'quarterTarget', 'Target', 'USD'), sub(d, 'qualifiedDealCount', 'Qualified deals', 'count')],
    abs: (d) => ({ label: 'Qualified pipeline', unit: 'USD', value: num(d.qualifiedPipelineAmount) })
  },
  {
    id: 'CM-05', family: 'CM', name: 'Marketing-sourced pipeline', source: 'Salesforce', unit: '%', dir: 'up', threshold: null, grain: 'Q',
    definition: 'Share of new-business ARR created in the quarter from marketing lead sources (duplicate-account deals excluded).',
    compute: (o, m) => O.oryonCM05(o, m),
    subs: (d) => [sub(d, 'won_pct', 'Won new-logo ARR (TTM)', '%'), sub(d, 'mk', 'Marketing ARR', 'USD'), sub(d, 'total', 'All new-business ARR', 'USD')],
    abs: (d) => ({ label: 'Marketing pipeline', unit: 'USD', value: num(d.mk) })
  },
  {
    id: 'CM-06', family: 'CM', name: 'Funnel conversion', source: 'HubSpot', unit: '%', dir: 'up', threshold: null, grain: 'Q',
    definition: 'MQL to SQL by MQL cohort quarter (headline); Lead to MQL, SQL to opportunity, opportunity to won and SQL to won by their own cohorts.',
    compute: (o, m) => O.oryonCM06(o, m),
    subs: (d) =>
      (Array.isArray(d.stages) ? (d.stages as Data[]) : []).map((s) => ({ key: String(s.key), label: String(s.label), unit: '%' as DashUnit, value: num(s.ratePct) }))
  },
  {
    id: 'CM-07', family: 'CM', name: 'Marketing ROI', source: 'Salesforce; QuickBooks', unit: 'x', dir: 'up', threshold: 1, grain: 'Q',
    definition: 'New-business pipeline created in the quarter from marketing sources per dollar of marketing spend (61xx accounts).',
    compute: (o, m) => O.oryonCM07(o, m),
    subs: (d) => [sub(d, 'programs', 'Programs ROI', 'x'), sub(d, 'blended_spend', 'Marketing spend', 'USD'), sub(d, 'pipeline', 'Sourced pipeline', 'USD'), sub(d, 'deals', 'Deals', 'count')]
  },
  {
    id: 'CM-08', family: 'CM', name: 'MQL volume', source: 'HubSpot; operating plan', unit: 'count', dir: 'up', threshold: null, grain: 'MQ',
    definition: 'MQLs in the month (first MQL date) against the budgeted MQL target (a month carries a third of its quarter).',
    compute: (o, m) => O.oryonCM08(o, m),
    subs: (d) => [sub(d, 'plan', 'Planned MQLs', 'count'), sub(d, 'pct', 'Vs plan', '%'), sub(d, 'diff', 'MQLs - plan', 'count')]
  }
]

export const METRIC_BY_ID = new Map(METRICS.map((m) => [m.id, m]))
