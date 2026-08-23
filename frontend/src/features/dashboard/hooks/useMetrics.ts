import { useQuery } from '@tanstack/react-query'
import * as metricsApi from '../api/metricsApi'

export function useMetric(id: metricsApi.MetricId, enabled: boolean, provider?: 'hubspot' | 'salesforce') {
  return useQuery({
    queryKey: ['metrics', id, provider],
    queryFn: () => metricsApi.getMetricRequest(id, undefined, provider),
    enabled
  })
}
