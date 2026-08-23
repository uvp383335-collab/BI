import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import * as organizationSettingsApi from '../api/organizationSettingsApi'
import { SalesforceCompetitorSource } from '../api/organizationSettingsApi'
import { useAuthContext } from '../../../shared/context/AuthContext'

export function useOrganizationSettings() {
  const { isAuthenticated } = useAuthContext()
  return useQuery({
    queryKey: ['organizations', 'settings'],
    queryFn: organizationSettingsApi.getOrganizationSettingsRequest,
    enabled: isAuthenticated
  })
}

export function useUpdateOrganizationSettings() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ source, field }: { source: SalesforceCompetitorSource | null; field: string | null }) =>
      organizationSettingsApi.updateOrganizationSettingsRequest(source, field),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['organizations', 'settings'] })
  })
}
