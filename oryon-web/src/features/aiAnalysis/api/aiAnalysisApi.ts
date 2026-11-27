import { httpClient } from '../../../shared/api/httpClient'

interface ApiEnvelope<T> {
  success: boolean
  data: T
}

/** Must match a key in the backend's aiAnalysis/service/chartDataRegistry.ts. */
export type AnalysisChartKey =
  | 'hubspot-lead-stage-funnel'
  | 'hubspot-lead-to-deal-funnel'
  | 'hubspot-deal-stage-funnel'
  | 'salesforce-lead-stage-funnel'
  | 'salesforce-lead-to-deal-funnel'
  | 'salesforce-deal-stage-funnel'
  | 'lead-to-mql-trend'
  | 'mql-to-sql-trend'
  | 'ga-expense-trend'
  | 'recurring-revenue-trend'
  | 'recurring-revenue-share'
  | 'invoice-revenue-growth-by-product'
  | 'invoice-revenue-growth-by-state'
  | 'new-customers-trend'
  | 'cac-trend'
  | 'customer-upgrades-trend'
  | 'customer-downgrades-trend'
  | 'customer-churn-trend'
  | 'customer-retention-trend'
  | 'qualified-pipeline-trend'
  | 'campaign-won-opportunities'
  | 'campaign-roi'
  | 'leads-by-month-by-campaign'
  | 'opportunities-by-lead-source'
  | 'opportunities-by-lead-source-by-month'
  | 'customer-revenue-concentration'
  | 'customer-revenue-concentration-by-month'
  | 'competitor-win-rate'
  | 'lead-volume-vs-target-mql'

/**
 * The metric code shown in the analysis header ("ORYONAI ANALYSIS · VC-09"),
 * for charts that trace a metric from the metrics guide. Charts without one
 * show the header without a code.
 */
export const ANALYSIS_METRIC_CODE: Partial<Record<AnalysisChartKey, string>> = {
  'lead-to-mql-trend': 'CM-06',
  'mql-to-sql-trend': 'CM-06',
  'ga-expense-trend': 'VC-09',
  'recurring-revenue-trend': 'VC-13',
  'recurring-revenue-share': 'VC-12',
  'customer-retention-trend': 'VC-01',
  'qualified-pipeline-trend': 'CM-04',
  'campaign-won-opportunities': 'CM-07',
  'campaign-roi': 'CM-07',
  'leads-by-month-by-campaign': 'CM-07',
  'opportunities-by-lead-source': 'CM-07',
  'opportunities-by-lead-source-by-month': 'CM-07',
  'customer-revenue-concentration': 'CM-02',
  'customer-revenue-concentration-by-month': 'CM-02',
  'competitor-win-rate': 'CM-03'
}

export type AnalysisStatus = 'Improving' | 'Stable' | 'Mixed' | 'Worsening' | 'Not enough data'

/** Mirrors the backend's aiAnalysis/service/analysisReportSchema.ts. */
export interface AnalysisReport {
  status: AnalysisStatus
  /** Latest period covered, e.g. "Oct 2026" or "Q3 2026". */
  periodLabel: string
  /** What that period's figure represents, e.g. "Latest month", "At quarter end". */
  basis: string
  headline: string
  /** The figure inside `headline` to highlight. */
  headlineFigure: string
  whatIsHappening: string[]
  /** May contain **bold** markers around key figures. */
  whatIsDrivingIt: string[]
  whyItMatters: string
  whatToDo: string[]
  askManagement: string
}

export interface ChartAnalysisResult {
  chartKey: AnalysisChartKey
  title: string
  report: AnalysisReport
  model: string
  /** Inclusive "YYYY-MM" range the analysis covered. */
  window: { from: string; to: string }
  /** What the analyzed data covers, e.g. "2024-11 to 2026-10" or "All time". */
  coverage: string
  generatedAt: string
  /** True when the server returned a previously generated report for unchanged data and prompt. */
  cached: boolean
}

export async function analyzeChartRequest(chartKey: AnalysisChartKey, refresh = false): Promise<ChartAnalysisResult> {
  const res = await httpClient.post<ApiEnvelope<ChartAnalysisResult>>(`/ai-analysis/${chartKey}`, { refresh })
  return res.data.data
}

/** The drawer's current selection, sent with a metric analysis so the readout matches what is on screen. */
export interface MetricAnalysisView {
  asOf?: string
  window?: 'P' | 'TTM'
  span?: '4' | '8' | '12'
  /** One QuickBooks item label, or omitted for all products. */
  product?: string
}

export interface MetricAnalysisResult extends Omit<ChartAnalysisResult, 'chartKey'> {
  chartKey: string
  metricId: string
}

export async function analyzeMetricRequest(metricId: string, view: MetricAnalysisView, refresh = false): Promise<MetricAnalysisResult> {
  const res = await httpClient.post<ApiEnvelope<MetricAnalysisResult>>(`/ai-analysis/metrics/${metricId}`, { refresh, view })
  return res.data.data
}
