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
