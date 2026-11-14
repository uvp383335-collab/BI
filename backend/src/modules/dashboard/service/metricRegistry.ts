import { MetricResult } from '../../metrics/metrics.types'
import { computeVC01, computeVC02, computeVC03 } from '../../metrics/service/metrics.service'
import { computeVC04, computeVC06, computeVC07, computeVC10, computeVC13, computeVC14 } from '../../metrics/service/plMetrics.service'
import { computeCB05, computeCB07, computeCB10 } from '../../metrics/service/cbMetrics.service'
import { computeCM02, computeCM03, computeCM04, computeCM05, computeCM06, computeCM07, computeCM08 } from '../../metrics/service/cmMetrics.service'
import { latestClosedQuarterStart } from '../../metrics/service/revenueRollForward.service'
import { organizationsRepository } from '../../organizations/repository/organizations.repository'

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

/**
 * CM-07 runs CM-05 for three quarters before it checks whether marketing-spend accounts are
 * configured (~4 s per period). Same answer as computeCM07's own "not configured" result, without
 * that work, since the portfolio screens evaluate it at many periods.
 */
async function cm07(orgId: string, month: string): Promise<MetricResult> {
  const org = await organizationsRepository.findById(orgId)
  if (!org?.settings?.marketingSpendAccountIds?.length) {
    return {
      id: 'CM-07', period: latestClosedQuarterStart(month), computable: false, value: null, unit: 'multiple',
      data: { configured: false, blockedOn: 'marketing-spend-accounts' }, flag: null, asOf: new Date().toISOString()
    }
  }
  return computeCM07(orgId, month)
}

export const FAMILIES: Record<Family, string> = {
  VC: 'Value creation',
  CB: 'Capital & balance sheet',
  CM: 'Customer & market'
}

export const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const sub = (d: Data, key: string, label: string, unit: DashUnit): Sub => ({ key, label, unit, value: num(d[key]) })

export const METRICS: MetricDef[] = [
  {
    id: 'VC-01', family: 'VC', name: 'Gross revenue retention', source: 'QuickBooks', unit: '%', dir: 'up', threshold: null, grain: 'MQ',
    definition: 'Recurring revenue kept from existing customers in the month, before any expansion (monthly cohort roll-forward).',
    compute: (o, m) => computeVC01(o, m),
    subs: (d) => [sub(d, 'startingRevenue', 'Starting recurring revenue', 'USD'), sub(d, 'cancellations', 'Cancellations', 'USD'), sub(d, 'downgrades', 'Downgrades', 'USD'), sub(d, 'currentQuarterGrr', 'Quarter GRR', '%')]
  },
  {
    id: 'VC-02', family: 'VC', name: 'Net revenue retention', source: 'QuickBooks', unit: '%', dir: 'up', threshold: null, grain: 'MQ',
    definition: 'Recurring revenue from existing customers including expansion, against where it started (monthly cohort roll-forward).',
    compute: (o, m) => computeVC02(o, m),
    subs: (d) => [sub(d, 'expansion', 'Expansion', 'USD'), sub(d, 'cancellations', 'Cancellations', 'USD'), sub(d, 'downgrades', 'Downgrades', 'USD'), sub(d, 'currentQuarterNrr', 'Quarter NRR', '%')]
  },
  {
    id: 'VC-03', family: 'VC', name: 'New-logo revenue growth', source: 'QuickBooks', unit: '%', dir: 'up', threshold: null, grain: 'Q',
    definition: 'Quarter-over-quarter growth in revenue from customers billed for the first time. Win-backs are reported separately.',
    compute: (o, m) => computeVC03(o, m),
    subs: (d) => [sub(d, 'newLogoRevenue', 'New-logo revenue', 'USD'), sub(d, 'newLogoCustomerCount', 'New logos', 'count'), sub(d, 'winBackRevenue', 'Win-back revenue', 'USD'), sub(d, 'previousQuarterNewLogoRevenue', 'Prior quarter', 'USD')],
    abs: (d) => ({ label: 'New-logo revenue', unit: 'USD', value: num(d.newLogoRevenue) })
  },
  {
    id: 'VC-04', family: 'VC', name: 'COGS % and mix', source: 'QuickBooks (P&L by Class)', unit: '%', dir: 'down', threshold: null, grain: 'Q',
    definition: 'Cost of goods sold as a share of revenue for the quarter, with the change split into rate and mix effects by product line.',
    filters: 'P',
    compute: (o, m, _p, item) => computeVC04(o, m, item),
    subs: (d) => [sub(d, 'revenue', 'Revenue', 'USD'), sub(d, 'cogsTotal', 'COGS', 'USD'), sub(d, 'rateEffect', 'Rate effect', 'pts'), sub(d, 'mixEffect', 'Mix effect', 'pts')],
    abs: (d) => ({ label: 'COGS', unit: 'USD', value: num(d.cogsTotal) })
  },
  {
    id: 'VC-06', family: 'VC', name: 'CAC payback', source: 'QuickBooks', unit: 'months', dir: 'down', threshold: null, grain: 'Q',
    definition: 'Months of gross margin needed to earn back the sales and marketing cost of winning a new customer.',
    compute: (o, m) => computeVC06(o, m),
    subs: (d) => [sub(d, 'cac', 'CAC', 'USD'), sub(d, 'smSpend', 'S&M spend', 'USD'), sub(d, 'newCustomersWon', 'New customers', 'count'), sub(d, 'grossMarginPct', 'Gross margin', '%')]
  },
  {
    id: 'VC-07', family: 'VC', name: 'LTV / CAC, new customers', source: 'Derived (VC-01, VC-04, VC-06)', unit: 'x', dir: 'up', threshold: null, grain: 'Q',
    definition: 'Lifetime value of a new customer divided by what it cost to win.',
    compute: (o, m) => computeVC07(o, m),
    subs: (d) => [sub(d, 'ltv', 'LTV', 'USD'), sub(d, 'cac', 'CAC', 'USD'), sub(d, 'monthlyChurnRate', 'Monthly churn', '%'), sub(d, 'previousQuarterRatio', 'Prior quarter', 'x')]
  },
  {
    id: 'VC-10', family: 'VC', name: 'EBITDA margin', source: 'QuickBooks', unit: '%', dir: 'up', threshold: null, grain: 'Q',
    definition: 'EBITDA (revenue - COGS - opex + D&A) as a share of revenue for the quarter.',
    filters: 'P',
    compute: (o, m, _p, item) => computeVC10(o, m, item),
    subs: (d) => [sub(d, 'ebitda', 'EBITDA', 'USD'), sub(d, 'revenue', 'Revenue', 'USD'), sub(d, 'previousQuarterMarginPct', 'Prior quarter', '%')],
    abs: (d) => ({ label: 'EBITDA', unit: 'USD', value: num(d.ebitda) })
  },
  {
    id: 'VC-13', family: 'VC', name: 'Revenue growth', source: 'QuickBooks', unit: '%', dir: 'up', threshold: null, grain: 'Q',
    definition: 'Quarter revenue growth against the same quarter last year, recurring and non-recurring.',
    filters: 'P',
    compute: (o, m, _p, item) => computeVC13(o, m, item),
    subs: (d) => [sub(d, 'revenue', 'Revenue', 'USD'), sub(d, 'recurringYoY', 'Recurring YoY', '%'), sub(d, 'nonRecurringYoY', 'Non-recurring YoY', '%'), sub(d, 'totalQoQ', 'Total QoQ', '%')],
    abs: (d) => ({ label: 'Revenue', unit: 'USD', value: num(d.revenue) })
  },
  {
    id: 'VC-14', family: 'VC', name: 'LTV / CAC, whole base', source: 'Derived (VC-01, VC-06)', unit: 'x', dir: 'up', threshold: null, grain: 'Q',
    definition: 'Lifetime value of the average current customer divided by acquisition cost.',
    compute: (o, m) => computeVC14(o, m),
    subs: (d) => [sub(d, 'ltv', 'LTV', 'USD'), sub(d, 'avgMonthlyRevenuePerCustomer', 'Avg revenue / customer', 'USD/month'), sub(d, 'activeCustomerCount', 'Active customers', 'count')]
  },
  {
    id: 'CB-05', family: 'CB', name: 'Cash position and runway', source: 'QuickBooks', unit: 'USD', dir: 'up', threshold: null, grain: 'MQ', latestOnly: true,
    definition: 'Unrestricted cash at the latest sync, and months of runway at the recent burn rate (blank = self-funding).',
    compute: (o) => computeCB05(o),
    value: (r) => num(r.data.unrestrictedCash),
    // Runway is the service's headline `value`; null means self-funding (the UI prints "Self-funding").
    subs: (d, r) => [{ key: 'runway', label: 'Runway', unit: 'months', value: num(r.value) }, sub(d, 'avgMonthlyBurn', 'Avg monthly burn', 'USD/month')]
  },
  {
    id: 'CB-07', family: 'CB', name: 'Free cash flow conversion', source: 'QuickBooks', unit: '%', dir: 'up', threshold: null, grain: 'Q',
    definition: '(Operating cash flow - capex) / EBITDA for the quarter.',
    compute: (o, m) => computeCB07(o, m),
    subs: (d) => [sub(d, 'fcf', 'Free cash flow', 'USD'), sub(d, 'operatingCashFlow', 'Operating cash flow', 'USD'), sub(d, 'capEx', 'Capex', 'USD'), sub(d, 'ebitda', 'EBITDA', 'USD')]
  },
  {
    id: 'CB-10', family: 'CB', name: 'Cash conversion cycle', source: 'QuickBooks (AR, AP, inventory)', unit: 'days', dir: 'down', threshold: null, grain: 'Q',
    definition: 'Days to collect + days in inventory - days to pay, on quarter-end balances.',
    compute: (o, m) => computeCB10(o, m),
    subs: (d) => [sub(d, 'daysToCollect', 'Days to collect', 'days'), sub(d, 'daysInInventory', 'Days in inventory', 'days'), sub(d, 'daysToPay', 'Days to pay', 'days')]
  },
  {
    id: 'CM-02', family: 'CM', name: 'Customer concentration', source: 'QuickBooks', unit: '%', dir: 'down', threshold: null, grain: 'MQ',
    definition: 'Share of trailing-twelve-month revenue from the ten largest customer groups.',
    compute: (o, m) => computeCM02(o, m),
    subs: (d) => [sub(d, 'top5Pct', 'Top 5 share', '%'), sub(d, 'top1Pct', 'Largest customer', '%'), sub(d, 'customerGroupCount', 'Customer groups', 'count'), sub(d, 'totalRevenue', 'TTM revenue', 'USD')]
  },
  {
    id: 'CM-03', family: 'CM', name: 'Win rate vs tracked competitor', source: 'Salesforce', unit: '%', dir: 'up', threshold: null, grain: 'MQ',
    definition: 'New-business win rate on decided deals where the tracked competitor is logged.',
    compute: (o, m) => computeCM03(o, m),
    subs: (d) => [sub(d, 'blendedWinRatePct', 'Blended win rate', '%'), sub(d, 'decidedDealsCurrent', 'Decided deals', 'count'), sub(d, 'decidedDealsWithCompetitorCurrent', 'With competitor', 'count'), sub(d, 'recordedSharePct', 'Competitor recorded', '%')]
  },
  {
    id: 'CM-04', family: 'CM', name: 'Pipeline coverage', source: 'CRM; operating plan', unit: 'x', dir: 'up', threshold: 3, grain: 'Q',
    definition: 'Qualified new-business pipeline closing next quarter divided by next quarter’s new-business target.',
    compute: (o, m, p) => computeCM04(o, p, m),
    subs: (d) => [sub(d, 'qualifiedPipelineAmount', 'Qualified pipeline', 'USD'), sub(d, 'nextQuarterTarget', 'Target', 'USD'), sub(d, 'qualifiedDealCount', 'Qualified deals', 'count')],
    abs: (d) => ({ label: 'Qualified pipeline', unit: 'USD', value: num(d.qualifiedPipelineAmount) })
  },
  {
    id: 'CM-05', family: 'CM', name: 'Marketing-sourced pipeline', source: 'CRM', unit: '%', dir: 'up', threshold: null, grain: 'Q',
    definition: 'Share of qualified new-business pipeline that marketing originated.',
    compute: (o, m, p) => computeCM05(o, p, m),
    subs: (d) => [sub(d, 'revenuePct', 'Share of revenue', '%'), sub(d, 'marketingQualifiedPipeline', 'Marketing pipeline', 'USD'), sub(d, 'totalQualifiedPipeline', 'Total pipeline', 'USD')],
    abs: (d) => ({ label: 'Marketing pipeline', unit: 'USD', value: num(d.marketingQualifiedPipeline) })
  },
  {
    id: 'CM-06', family: 'CM', name: 'Funnel conversion', source: 'CRM', unit: '%', dir: 'up', threshold: null, grain: 'Q',
    definition: 'Share of MQLs that sales accepts as SQLs, by MQL cohort quarter; other stages by their own cohorts.',
    compute: (o, m, p) => computeCM06(o, p, m),
    subs: (d) =>
      (Array.isArray(d.stages) ? (d.stages as Data[]) : []).map((s) => ({ key: String(s.key), label: String(s.label), unit: '%' as DashUnit, value: num(s.ratePct) }))
  },
  {
    id: 'CM-07', family: 'CM', name: 'Marketing ROI', source: 'CRM; QuickBooks', unit: 'x', dir: 'up', threshold: null, grain: 'Q',
    definition: 'Marketing-sourced pipeline per dollar of marketing spend.',
    compute: cm07,
    subs: (d) => [sub(d, 'profitRoi', 'Profit ROI', 'x'), sub(d, 'marketingSpend', 'Marketing spend', 'USD'), sub(d, 'marketingSourcedPipeline', 'Sourced pipeline', 'USD'), sub(d, 'marketingSourcedRevenue', 'Sourced revenue', 'USD')]
  },
  {
    id: 'CM-08', family: 'CM', name: 'MQL volume', source: 'CRM; operating plan', unit: 'count', dir: 'up', threshold: null, grain: 'MQ',
    definition: 'MQLs in the month (first MQL date), against the operating plan.',
    compute: (o, m, p) => computeCM08(o, p, m),
    subs: (d) => [sub(d, 'plannedMqls', 'Planned MQLs', 'count'), sub(d, 'variancePct', 'Vs plan', '%'), sub(d, 'growthPct', 'Vs prior month', '%'), sub(d, 'quarterMqlCount', 'Quarter MQLs', 'count')]
  }
]

export const METRIC_BY_ID = new Map(METRICS.map((m) => [m.id, m]))
