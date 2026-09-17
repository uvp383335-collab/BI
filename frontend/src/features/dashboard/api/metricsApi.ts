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
  | 'vc-09'
  | 'vc-10'
  | 'vc-12'
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

export async function getMetricRequest(id: MetricId, period?: string, provider?: 'hubspot' | 'salesforce', item?: string): Promise<MetricResult> {
  const res = await httpClient.get<ApiEnvelope<MetricResult>>(`/metrics/${id}`, { params: { period, provider, item } })
  return res.data.data
}

export type TrendMetricId = 'vc-04' | 'vc-09' | 'vc-10' | 'vc-13'

export interface TrendPoint {
  month: string
  value: number | null
}

export interface MetricTrend {
  id: TrendMetricId
  unit: MetricUnit
  points: TrendPoint[]
}

/** Monthly series from January of `fromYear` (default: current year) through the latest closed month. */
export async function getMetricTrendRequest(id: TrendMetricId, item?: string, fromYear?: string): Promise<MetricTrend> {
  const res = await httpClient.get<ApiEnvelope<MetricTrend>>(`/metrics/trend/${id}`, { params: { item, fromYear } })
  return res.data.data
}
