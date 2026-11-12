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

export interface CampaignWonOpportunitiesRow {
  campaignId: string
  campaignName: string
  wonCount: number
  wonAmount: number
}

export interface CampaignWonOpportunitiesResult {
  rows: CampaignWonOpportunitiesRow[]
}

/** Closed-won Salesforce Opportunities grouped by Campaign — the "Opportunities Won by Campaign" chart below Pipeline Coverage Trend. Salesforce-only, no query params. */
export async function getCampaignWonOpportunitiesRequest(): Promise<CampaignWonOpportunitiesResult> {
  const res = await httpClient.get<ApiEnvelope<CampaignWonOpportunitiesResult>>('/metrics/salesforce/campaign-won-opportunities')
  return res.data.data
}

export interface CampaignWonOpportunitiesDetailDeal {
  dealId: string
  dealName: string | null
  campaignId: string
  campaignName: string
  pipeline: string
  dealstage: string
  amount: number
  /** "YYYY-MM-DD" */
  closeDate: string | null
}

export interface CampaignWonOpportunitiesDetailResult {
  rows: CampaignWonOpportunitiesRow[]
  /** Every closed-won Opportunity behind the rows above — sums to rows[].wonCount/wonAmount per campaign exactly. */
  deals: CampaignWonOpportunitiesDetailDeal[]
}

/** Record-level detail behind the chart above — every closed-won Opportunity attributed to a campaign, for the "export to Excel" verification button. */
export async function getCampaignWonOpportunitiesDetailRequest(): Promise<CampaignWonOpportunitiesDetailResult> {
  const res = await httpClient.get<ApiEnvelope<CampaignWonOpportunitiesDetailResult>>('/metrics/salesforce/campaign-won-opportunities/detail')
  return res.data.data
}

export interface CampaignRoiRow {
  campaignId: string
  campaignName: string
  wonAmount: number
  actualCost: number
  roi: number
}

export interface CampaignRoiResult {
  rows: CampaignRoiRow[]
}

/** ROI (won $ / actual cost) per Salesforce Campaign — the "Campaign ROI" chart below Opportunities Won by Campaign. Salesforce-only, no query params. */
export async function getCampaignRoiRequest(): Promise<CampaignRoiResult> {
  const res = await httpClient.get<ApiEnvelope<CampaignRoiResult>>('/metrics/salesforce/campaign-roi')
  return res.data.data
}

export interface CompetitorWinRateRow {
  competitor: string
  wins: number
  losses: number
  decided: number
  winRatePct: number
}

export interface CompetitorWinRateResult {
  rows: CompetitorWinRateRow[]
}

/** Won vs. lost Salesforce Opportunity counts per named competitor, read from each deal's "Primary Competitor" custom field (not the dedicated competitor/competitors fields CM-03 reads) — the "Competitor Win Rate" chart. Salesforce-only, no query params, all-time. */
export async function getCompetitorWinRateRequest(): Promise<CompetitorWinRateResult> {
  const res = await httpClient.get<ApiEnvelope<CompetitorWinRateResult>>('/metrics/salesforce/competitor-win-rate')
  return res.data.data
}

export interface LeadVolumeVsTargetPoint {
  /** "YYYY-MM" */
  month: string
  /** Contacts sitting at the Lead stage (reached it, not yet advanced past it) as of this month's first day — a snapshot, not an entry count. */
  leadVolume: number
  target: number | null
  /** leadVolume / target * 100 — null when no target is configured for this month. */
  ratioPct: number | null
}

export interface LeadVolumeVsTargetResult {
  points: LeadVolumeVsTargetPoint[]
  missingTargetMonths: string[]
}

/** How many HubSpot contacts were sitting at the Lead stage as of each month's start, vs. the "Lead Volume target (Target MQL)" set in Settings — the "Lead Volume vs. Target MQL" chart. HubSpot-only, no query params, trailing 12 months. */
export async function getLeadVolumeVsTargetRequest(): Promise<LeadVolumeVsTargetResult> {
  const res = await httpClient.get<ApiEnvelope<LeadVolumeVsTargetResult>>('/metrics/hubspot/lead-volume-vs-target-mql')
  return res.data.data
}

export interface LeadsByMonthPoint {
  month: string
  count: number
}

export interface LeadsByMonthCampaignRow {
  campaignId: string
  campaignName: string
  series: LeadsByMonthPoint[]
}

export interface LeadsByMonthByCampaignResult {
  campaigns: LeadsByMonthCampaignRow[]
}

/** Salesforce Lead-creation-date histogram per Campaign — the "Leads by Month" chart's campaign-picker dropdown and series data. Salesforce-only, no query params. */
export async function getLeadsByMonthByCampaignRequest(): Promise<LeadsByMonthByCampaignResult> {
  const res = await httpClient.get<ApiEnvelope<LeadsByMonthByCampaignResult>>('/metrics/salesforce/leads-by-month-by-campaign')
  return res.data.data
}

export interface OpportunitiesByLeadSourceRow {
  leadSource: string
  count: number
}

export interface OpportunitiesByLeadSourceResult {
  rows: OpportunitiesByLeadSourceRow[]
}

/** Every Salesforce Opportunity grouped by `LeadSource` — the "Opportunities by Lead Source" chart below Leads by Month. Salesforce-only, no query params. */
export async function getOpportunitiesByLeadSourceRequest(): Promise<OpportunitiesByLeadSourceResult> {
  const res = await httpClient.get<ApiEnvelope<OpportunitiesByLeadSourceResult>>('/metrics/salesforce/opportunities-by-lead-source')
  return res.data.data
}

export interface OpportunitiesByLeadSourceMonthPoint {
  periodStart: string
  count: number
}

export interface OpportunitiesByLeadSourceMonthRow {
  leadSource: string
  series: OpportunitiesByLeadSourceMonthPoint[]
}

export interface OpportunitiesByLeadSourceByMonthResult {
  leadSources: OpportunitiesByLeadSourceMonthRow[]
}

export type StageConversionGranularity = 'monthly' | 'quarterly' | 'yearly'

/** Salesforce Opportunity-creation-date histogram per LeadSource, at the given granularity (defaults to monthly) — the "Opportunities by Lead Source by Month" chart's lead-source-picker dropdown and series data. Salesforce-only. */
export async function getOpportunitiesByLeadSourceByMonthRequest(granularity: StageConversionGranularity = 'monthly'): Promise<OpportunitiesByLeadSourceByMonthResult> {
  const res = await httpClient.get<ApiEnvelope<OpportunitiesByLeadSourceByMonthResult>>('/metrics/salesforce/opportunities-by-lead-source-by-month', { params: { granularity } })
  return res.data.data
}

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

export interface CustomerRevenueConcentrationRow {
  customerId: string
  customerName: string
  revenue: number
  pctOfTotal: number
}

export interface CustomerRevenueConcentrationResult {
  rows: CustomerRevenueConcentrationRow[]
  top10Pct: number
  totalRevenue: number
}

/** All-time invoiced revenue concentration among the top 10 QuickBooks customers — the "Customer Concentration" chart below Opportunities by Lead Source by Month. `itemId` narrows to one product's revenue instead of every product blended. QuickBooks-only. */
export async function getCustomerRevenueConcentrationRequest(itemId?: string): Promise<CustomerRevenueConcentrationResult> {
  const res = await httpClient.get<ApiEnvelope<CustomerRevenueConcentrationResult>>('/metrics/quickbooks/customer-revenue-concentration', { params: { item: itemId || undefined } })
  return res.data.data
}

export interface CustomerRevenueConcentrationDetailLine {
  providerRecordId: string
  customerRecordId: string
  customerName: string
  rootCustomerId: string
  rootCustomerName: string
  /** "YYYY-MM-DD" */
  txnDate: string
  amount: number
}

export interface CustomerRevenueConcentrationDetailResult {
  rows: CustomerRevenueConcentrationRow[]
  top10Pct: number
  totalRevenue: number
  /** Every synced invoice (or invoice line, when filtered by product) billed to the top 10 customers above or any of their subsidiaries — sums to rows[].revenue exactly per root customer. */
  lines: CustomerRevenueConcentrationDetailLine[]
}

/** Record-level detail behind the chart above — every synced invoice (or invoice line, when filtered by product) billed to the top 10 customers or their subsidiaries, for the "export to Excel" verification button. */
export async function getCustomerRevenueConcentrationDetailRequest(itemId?: string): Promise<CustomerRevenueConcentrationDetailResult> {
  const res = await httpClient.get<ApiEnvelope<CustomerRevenueConcentrationDetailResult>>('/metrics/quickbooks/customer-revenue-concentration/detail', {
    params: { item: itemId || undefined }
  })
  return res.data.data
}

export interface CustomerRevenueConcentrationMonthPoint {
  periodStart: string
  top10Pct: number
  top10Revenue: number
  totalRevenue: number
}

export interface CustomerRevenueConcentrationByMonthResult {
  points: CustomerRevenueConcentrationMonthPoint[]
}

/** The same top-10-of-total revenue ratio as above, traced over time at the given granularity (defaults to monthly) — the "Customer Concentration" trend chart below the all-time one. Same optional `itemId` product narrowing. QuickBooks-only. */
export async function getCustomerRevenueConcentrationByMonthRequest(
  itemId?: string,
  granularity: StageConversionGranularity = 'monthly'
): Promise<CustomerRevenueConcentrationByMonthResult> {
  const res = await httpClient.get<ApiEnvelope<CustomerRevenueConcentrationByMonthResult>>('/metrics/quickbooks/customer-revenue-concentration-by-month', {
    params: { item: itemId || undefined, granularity }
  })
  return res.data.data
}

export interface CustomerRevenueConcentrationByMonthTopCustomer {
  customerId: string
  customerName: string
  revenue: number
  pctOfTotal: number
}

export interface CustomerRevenueConcentrationByMonthDetailPeriod extends CustomerRevenueConcentrationMonthPoint {
  /** Which customers made up this period's top 10 and how much each contributed — the chart itself only plots the blended top10Revenue/top10Pct. */
  topCustomers: CustomerRevenueConcentrationByMonthTopCustomer[]
}

export interface CustomerRevenueConcentrationByMonthDetailLine {
  providerRecordId: string
  customerRecordId: string
  customerName: string
  rootCustomerId: string
  rootCustomerName: string
  periodStart: string
  /** "YYYY-MM-DD" */
  txnDate: string
  amount: number
}

export interface CustomerRevenueConcentrationByMonthDetailResult {
  periods: CustomerRevenueConcentrationByMonthDetailPeriod[]
  /** Every synced invoice (or invoice line, when filtered by product) billed to a period's top 10 customers (or their subsidiaries) — sums to that period's topCustomers[].revenue exactly. */
  lines: CustomerRevenueConcentrationByMonthDetailLine[]
}

/** Record-level detail behind the chart above — which customers made up each displayed period's top 10, plus every synced invoice (or invoice line, when filtered by product) behind them, for the "export to Excel" verification button. */
export async function getCustomerRevenueConcentrationByMonthDetailRequest(
  itemId?: string,
  granularity: StageConversionGranularity = 'monthly'
): Promise<CustomerRevenueConcentrationByMonthDetailResult> {
  const res = await httpClient.get<ApiEnvelope<CustomerRevenueConcentrationByMonthDetailResult>>('/metrics/quickbooks/customer-revenue-concentration-by-month/detail', {
    params: { item: itemId || undefined, granularity }
  })
  return res.data.data
}
