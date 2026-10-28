import { httpClient } from '../../../shared/api/httpClient'

interface ApiEnvelope<T> {
  success: boolean
  data: T
}

export type MetricFlagLevel = 'watch' | 'act_now'
export type MetricUnit = 'percent' | 'months' | 'multiple' | 'usd' | 'days' | 'count'

export interface MetricFlag {
  level: MetricFlagLevel
  reason: string
}

export interface MetricResult {
  id: string
  period: string
  computable: boolean
  value: number | null
  unit: MetricUnit
  data: Record<string, unknown>
  flag: MetricFlag | null
  asOf: string
}

export type MetricId =
  | 'vc-01'
  | 'vc-02'
  | 'vc-03'
  | 'vc-04'
  | 'vc-06'
  | 'vc-07'
  | 'vc-10'
  | 'vc-13'
  | 'vc-14'
  | 'cb-05'
  | 'cb-07'
  | 'cb-10'
  | 'cm-02'
  | 'cm-03'
  | 'cm-04'
  | 'cm-05'
  | 'cm-06'
  | 'cm-07'
  | 'cm-08'

export async function getMetricRequest(id: MetricId, period?: string, provider?: 'hubspot' | 'salesforce', item?: string, state?: string, viewMode?: 'percentage' | 'absolute'): Promise<MetricResult> {
  const res = await httpClient.get<ApiEnvelope<MetricResult>>(`/metrics/${id}`, { params: { period, provider, item, state, viewMode } })
  return res.data.data
}

export type TrendMetricId = 'vc-04' | 'vc-10' | 'vc-13'

export interface TrendPoint {
  month: string
  value: number | null
  // VC-13 (Revenue Growth) additionally includes both metrics so the frontend
  // can toggle between percentage view mode and absolute revenue view mode.
  revenue?: number | null
  revenueGrowthPct?: number | null
}

export interface MetricTrend {
  id: TrendMetricId
  unit: MetricUnit
  points: TrendPoint[]
}

/** Monthly series from January of `fromYear` (default: current year) through the latest closed month. */
export async function getMetricTrendRequest(id: TrendMetricId, item?: string, fromYear?: string, state?: string, viewMode?: 'percentage' | 'absolute'): Promise<MetricTrend> {
  const res = await httpClient.get<ApiEnvelope<MetricTrend>>(`/metrics/trend/${id}`, { params: { item, fromYear, state, viewMode } })
  return res.data.data
}

export interface QualifiedPipelineTrendPoint {
  month: string
  actual: number
  qualifiedDealCount: number
  target: number | null
  ratio: number | null
}

export interface QualifiedPipelineTrendResult {
  unit: MetricUnit
  points: QualifiedPipelineTrendPoint[]
}

/** Qualified new-business pipeline created each month vs. that month's prorated CM-04 target. Defaults to the trailing 12 months. */
export async function getQualifiedPipelineTrendRequest(provider: 'hubspot' | 'salesforce', fromMonth?: string, toMonth?: string): Promise<QualifiedPipelineTrendResult> {
  const res = await httpClient.get<ApiEnvelope<QualifiedPipelineTrendResult>>('/metrics/qualified-pipeline-trend', { params: { provider, fromMonth, toMonth } })
  return res.data.data
}
