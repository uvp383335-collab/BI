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

export type StageConversionGranularity = 'monthly' | 'quarterly' | 'yearly'

export interface LeadToMqlTrendPoint {
  periodStart: string
  leadCount: number
  mqlCount: number
  conversionRatePct: number | null
}

export interface LeadToMqlTrendResult {
  granularity: StageConversionGranularity
  points: LeadToMqlTrendPoint[]
}

/** Lead -> MQL cohort conversion rate (CM-06's underlying cohort), reported at the given granularity. Defaults to quarterly, trailing window sized to the granularity. */
export async function getLeadToMqlTrendRequest(
  provider: 'hubspot' | 'salesforce',
  granularity: StageConversionGranularity = 'quarterly',
  from?: string,
  to?: string
): Promise<LeadToMqlTrendResult> {
  const res = await httpClient.get<ApiEnvelope<LeadToMqlTrendResult>>('/metrics/lead-to-mql-trend', { params: { provider, granularity, from, to } })
  return res.data.data
}

export interface MqlToSqlTrendPoint {
  periodStart: string
  mqlCount: number
  sqlCount: number
  conversionRatePct: number | null
}

export interface MqlToSqlTrendResult {
  granularity: StageConversionGranularity
  points: MqlToSqlTrendPoint[]
}

/** MQL -> SQL cohort conversion rate (CM-06's underlying cohort), reported at the given granularity. Defaults to quarterly, trailing window sized to the granularity. */
export async function getMqlToSqlTrendRequest(
  provider: 'hubspot' | 'salesforce',
  granularity: StageConversionGranularity = 'quarterly',
  from?: string,
  to?: string
): Promise<MqlToSqlTrendResult> {
  const res = await httpClient.get<ApiEnvelope<MqlToSqlTrendResult>>('/metrics/mql-to-sql-trend', { params: { provider, granularity, from, to } })
  return res.data.data
}

export interface StageConversionDetailEntry {
  providerRecordId: string
  fromEnteredAt: string
  toEnteredAt: string | null
  converted: boolean
  daysToAdvance: number | null
}

export interface StageConversionPeriodDetail {
  periodStart: string
  fromCount: number
  toCount: number
  conversionRatePct: number | null
  entries: StageConversionDetailEntry[]
}

export interface StageConversionTrendDetailResult {
  fromStage: string
  toStage: string
  granularity: StageConversionGranularity
  periods: StageConversionPeriodDetail[]
}

/** Record-level detail behind the Lead -> MQL trend chart — every record counted in each period's cohort, for the "export to Excel" verification button. Same params as the chart request. */
export async function getLeadToMqlTrendDetailRequest(
  provider: 'hubspot' | 'salesforce',
  granularity: StageConversionGranularity = 'quarterly',
  from?: string,
  to?: string
): Promise<StageConversionTrendDetailResult> {
  const res = await httpClient.get<ApiEnvelope<StageConversionTrendDetailResult>>('/metrics/lead-to-mql-trend/detail', { params: { provider, granularity, from, to } })
  return res.data.data
}

/** Record-level detail behind the MQL -> SQL trend chart — same shape as the Lead -> MQL detail request above, one transition over. */
export async function getMqlToSqlTrendDetailRequest(
  provider: 'hubspot' | 'salesforce',
  granularity: StageConversionGranularity = 'quarterly',
  from?: string,
  to?: string
): Promise<StageConversionTrendDetailResult> {
  const res = await httpClient.get<ApiEnvelope<StageConversionTrendDetailResult>>('/metrics/mql-to-sql-trend/detail', { params: { provider, granularity, from, to } })
  return res.data.data
}
