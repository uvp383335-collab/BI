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

export interface ChartAnalysisResult {
  chartKey: AnalysisChartKey
  title: string
  /** Markdown. */
  report: string
  model: string
  /** Inclusive "YYYY-MM" range the analysis covered. */
  window: { from: string; to: string }
  generatedAt: string
  /** True when the server returned a previously generated report for unchanged data and prompt. */
  cached: boolean
}

export async function analyzeChartRequest(chartKey: AnalysisChartKey, refresh = false): Promise<ChartAnalysisResult> {
  const res = await httpClient.post<ApiEnvelope<ChartAnalysisResult>>(`/ai-analysis/${chartKey}`, { refresh })
  return res.data.data
}
