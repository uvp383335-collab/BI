import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
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

export function useFunnels(
  organizationId: string,
  provider: IntegrationProvider,
  filters: syncApi.FunnelFilters,
  enabled: boolean
) {
  return useQuery({
    queryKey: ['analytics', 'funnels', organizationId, provider, filters],
    queryFn: () => syncApi.getFunnelsRequest(provider, filters),
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

export function useProducts(provider: IntegrationProvider, enabled: boolean) {
  return useQuery({
    queryKey: ['analytics', 'products', provider],
    queryFn: () => syncApi.getProductsRequest(provider),
    enabled
  })
}

export function useOpportunities(provider: IntegrationProvider, page: number, pageSize: number, enabled: boolean) {
  return useQuery({
    queryKey: ['analytics', 'opportunities', provider, page, pageSize],
    queryFn: () => syncApi.getOpportunitiesRequest(provider, page, pageSize),
    enabled,
    placeholderData: keepPreviousData
  })
}

export function useCampaigns(provider: IntegrationProvider, page: number, pageSize: number, enabled: boolean) {
  return useQuery({
    queryKey: ['analytics', 'campaigns', provider, page, pageSize],
    queryFn: () => syncApi.getCampaignsRequest(provider, page, pageSize),
    enabled,
    placeholderData: keepPreviousData
  })
}

export function useStartSync(provider: IntegrationProvider) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (force?: boolean) => syncApi.startSyncRequest(provider, force),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sync', 'status', provider] })
    }
  })
}
