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
