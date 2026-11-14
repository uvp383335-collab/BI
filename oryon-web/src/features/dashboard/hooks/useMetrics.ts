import { useQuery } from '@tanstack/react-query'
import * as metricsApi from '../api/metricsApi'

export function useMetric(id: metricsApi.MetricId, enabled: boolean, provider?: 'hubspot' | 'salesforce', itemId?: string, state?: string, viewMode?: 'percentage' | 'absolute') {
  return useQuery({
    queryKey: ['metrics', id, provider, itemId, state, viewMode],
    queryFn: () => metricsApi.getMetricRequest(id, undefined, provider, itemId, state, viewMode),
    enabled
  })
}

export function useMetricTrend(id: metricsApi.TrendMetricId, enabled: boolean, itemId?: string, fromYear?: string, state?: string, viewMode?: 'percentage' | 'absolute') {
  return useQuery({
    queryKey: ['metrics', 'trend', id, itemId, fromYear, state, viewMode],
    queryFn: () => metricsApi.getMetricTrendRequest(id, itemId, fromYear, state, viewMode),
    enabled
  })
}

export function useQualifiedPipelineTrend(enabled: boolean, provider: 'hubspot' | 'salesforce', fromMonth?: string, toMonth?: string) {
  return useQuery({
    queryKey: ['metrics', 'qualified-pipeline-trend', provider, fromMonth, toMonth],
    queryFn: () => metricsApi.getQualifiedPipelineTrendRequest(provider, fromMonth, toMonth),
    enabled
  })
}

export function useCampaignWonOpportunities(enabled: boolean) {
  return useQuery({
    queryKey: ['metrics', 'campaign-won-opportunities'],
    queryFn: () => metricsApi.getCampaignWonOpportunitiesRequest(),
    enabled
  })
}

export function useCampaignRoi(enabled: boolean) {
  return useQuery({
    queryKey: ['metrics', 'campaign-roi'],
    queryFn: () => metricsApi.getCampaignRoiRequest(),
    enabled
  })
}

export function useCompetitorWinRate(enabled: boolean) {
  return useQuery({
    queryKey: ['metrics', 'competitor-win-rate'],
    queryFn: () => metricsApi.getCompetitorWinRateRequest(),
    enabled
  })
}

export function useLeadVolumeVsTarget(enabled: boolean) {
  return useQuery({
    queryKey: ['metrics', 'lead-volume-vs-target-mql'],
    queryFn: () => metricsApi.getLeadVolumeVsTargetRequest(),
    enabled
  })
}

export function useLeadsByMonthByCampaign(enabled: boolean) {
  return useQuery({
    queryKey: ['metrics', 'leads-by-month-by-campaign'],
    queryFn: () => metricsApi.getLeadsByMonthByCampaignRequest(),
    enabled
  })
}

export function useOpportunitiesByLeadSource(enabled: boolean) {
  return useQuery({
    queryKey: ['metrics', 'opportunities-by-lead-source'],
    queryFn: () => metricsApi.getOpportunitiesByLeadSourceRequest(),
    enabled
  })
}

export function useOpportunitiesByLeadSourceByMonth(enabled: boolean, granularity: metricsApi.StageConversionGranularity) {
  return useQuery({
    queryKey: ['metrics', 'opportunities-by-lead-source-by-month', granularity],
    queryFn: () => metricsApi.getOpportunitiesByLeadSourceByMonthRequest(granularity),
    enabled
  })
}

export function useCustomerRevenueConcentration(enabled: boolean, itemId?: string) {
  return useQuery({
    queryKey: ['metrics', 'customer-revenue-concentration', itemId],
    queryFn: () => metricsApi.getCustomerRevenueConcentrationRequest(itemId),
    enabled
  })
}

export function useCustomerRevenueConcentrationByMonth(enabled: boolean, itemId: string | undefined, granularity: metricsApi.StageConversionGranularity) {
  return useQuery({
    queryKey: ['metrics', 'customer-revenue-concentration-by-month', itemId, granularity],
    queryFn: () => metricsApi.getCustomerRevenueConcentrationByMonthRequest(itemId, granularity),
    enabled
  })
}

export function useLeadToMqlTrend(enabled: boolean, provider: 'hubspot' | 'salesforce', granularity: metricsApi.StageConversionGranularity, from?: string, to?: string) {
  return useQuery({
    queryKey: ['metrics', 'lead-to-mql-trend', provider, granularity, from, to],
    queryFn: () => metricsApi.getLeadToMqlTrendRequest(provider, granularity, from, to),
    enabled
  })
}

export function useMqlToSqlTrend(enabled: boolean, provider: 'hubspot' | 'salesforce', granularity: metricsApi.StageConversionGranularity, from?: string, to?: string) {
  return useQuery({
    queryKey: ['metrics', 'mql-to-sql-trend', provider, granularity, from, to],
    queryFn: () => metricsApi.getMqlToSqlTrendRequest(provider, granularity, from, to),
    enabled
  })
}
