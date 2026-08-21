import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import * as integrationsApi from '../api/integrationsApi'
import { IntegrationProvider } from '../api/integrationsApi'
import { useAuthContext } from '../../../shared/context/AuthContext'

export function useIntegrationsStatus() {
  const { isAuthenticated } = useAuthContext()
  return useQuery({
    queryKey: ['integrations', 'status'],
    queryFn: integrationsApi.getIntegrationsStatusRequest,
    enabled: isAuthenticated,
    refetchOnMount: 'always'
  })
}

export function useConnectProvider() {
  return useMutation({
    mutationFn: (provider: IntegrationProvider) => integrationsApi.getAuthorizeUrlRequest(provider)
  })
}

export function useDisconnectProvider() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (provider: IntegrationProvider) => integrationsApi.disconnectIntegrationRequest(provider),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['integrations', 'status'] })
  })
}
