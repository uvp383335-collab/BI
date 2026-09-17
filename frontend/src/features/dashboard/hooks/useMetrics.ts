import { useQuery } from '@tanstack/react-query'
import * as metricsApi from '../api/metricsApi'

export function useMetric(id: metricsApi.MetricId, enabled: boolean, provider?: 'hubspot' | 'salesforce', itemId?: string) {
  return useQuery({
    queryKey: ['metrics', id, provider, itemId],
    queryFn: () => metricsApi.getMetricRequest(id, undefined, provider, itemId),
    enabled
  })
}

export function useMetricTrend(id: metricsApi.TrendMetricId, enabled: boolean, itemId?: string, fromYear?: string) {
  return useQuery({
    queryKey: ['metrics', 'trend', id, itemId, fromYear],
    queryFn: () => metricsApi.getMetricTrendRequest(id, itemId, fromYear),
    enabled
  })
}
