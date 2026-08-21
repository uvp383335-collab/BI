import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import * as syncApi from '../api/syncApi'
import { IntegrationProvider } from '../../integrations/api/integrationsApi'

const ACTIVE_STATUSES = ['pending', 'running']

/** Polls sync job status while a sync is in progress; stops polling once settled. */
export function useSyncStatus(provider: IntegrationProvider) {
  return useQuery({
    queryKey: ['sync', 'status', provider],
    queryFn: () => syncApi.getSyncStatusRequest(provider),
    refetchInterval: (query) => {
      const job = query.state.data
      return job && ACTIVE_STATUSES.includes(job.status) ? 2000 : false
    }
  })
}

export function useEntityCounts(provider: IntegrationProvider, enabled: boolean) {
  return useQuery({
    queryKey: ['sync', 'counts', provider],
    queryFn: () => syncApi.getEntityCountsRequest(provider),
    enabled
  })
}

export function usePipelineProgression(provider: IntegrationProvider, filters: syncApi.PipelineFilters, enabled: boolean) {
  return useQuery({
    queryKey: ['analytics', 'pipeline-progression', provider, filters],
    queryFn: () => syncApi.getPipelineProgressionRequest(provider, filters),
    enabled
  })
}

export function usePipelines(provider: IntegrationProvider, enabled: boolean) {
  return useQuery({
    queryKey: ['analytics', 'pipelines', provider],
    queryFn: () => syncApi.getPipelinesRequest(provider),
    enabled
  })
}

export function useStartSync(provider: IntegrationProvider) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => syncApi.startSyncRequest(provider),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sync', 'status', provider] })
    }
  })
}
