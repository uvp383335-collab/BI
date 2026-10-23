import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import * as organizationSettingsApi from '../api/organizationSettingsApi'
import {
  SalesforceCompetitorSource,
  SalesforceOpportunityExtraField,
  CashMetricsAccountSettings,
  CACSettingsInput,
  Cm04Target,
  Cm08MqlTarget
} from '../api/organizationSettingsApi'
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

export function useUpdateSalesforceOpportunityExtraFields() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (fields: SalesforceOpportunityExtraField[]) => organizationSettingsApi.updateSalesforceOpportunityExtraFieldsRequest(fields),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['organizations', 'settings'] })
  })
}

/** `enabled` should be `status?.quickbooks?.connected` — the options list is a live QuickBooks read. */
export function useCashMetricsAccountOptions(enabled: boolean) {
  const { isAuthenticated } = useAuthContext()
  return useQuery({
    queryKey: ['organizations', 'settings', 'quickbooks-accounts'],
    queryFn: organizationSettingsApi.getCashMetricsAccountOptionsRequest,
    enabled: isAuthenticated && enabled
  })
}

export function useUpdateCashMetricsAccounts() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (settings: CashMetricsAccountSettings) => organizationSettingsApi.updateCashMetricsAccountsRequest(settings),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['organizations', 'settings'] })
  })
}

/** `enabled` should be `status?.quickbooks?.connected` — the options list is a live QuickBooks read. */
export function useGAndAAccountOptions(enabled: boolean) {
  const { isAuthenticated } = useAuthContext()
  return useQuery({
    queryKey: ['organizations', 'settings', 'ga-accounts'],
    queryFn: organizationSettingsApi.getGAndAAccountOptionsRequest,
    enabled: isAuthenticated && enabled
  })
}

export function useUpdateGAndAAccounts() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (gaExpenseAccountIds: string[]) => organizationSettingsApi.updateGAndAAccountsRequest(gaExpenseAccountIds),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['organizations', 'settings'] })
  })
}

/** `enabled` should be `status?.quickbooks?.connected` — the options list is a live QuickBooks read. */
export function useCACAccountOptions(enabled: boolean) {
  const { isAuthenticated } = useAuthContext()
  return useQuery({
    queryKey: ['organizations', 'settings', 'cac-accounts'],
    queryFn: organizationSettingsApi.getCACAccountOptionsRequest,
    enabled: isAuthenticated && enabled
  })
}

export function useUpdateCACSettings() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (settings: CACSettingsInput) => organizationSettingsApi.updateCACSettingsRequest(settings),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['organizations', 'settings'] })
  })
}

export function useUpdateMarketingSpendAccounts() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (marketingSpendAccountIds: string[]) => organizationSettingsApi.updateMarketingSpendAccountsRequest(marketingSpendAccountIds),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['organizations', 'settings'] })
      // CM-07 reads the accounts at compute time — refresh the dashboard card too.
      queryClient.invalidateQueries({ queryKey: ['metrics'] })
    }
  })
}

export function useUpdateCm04Targets() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (targets: Cm04Target[]) => organizationSettingsApi.updateCm04TargetsRequest(targets),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['organizations', 'settings'] })
      // CM-04 reads the targets at compute time — refresh the dashboard card too.
      queryClient.invalidateQueries({ queryKey: ['metrics'] })
    }
  })
}

export function useUpdateCm08MqlTargets() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (targets: Cm08MqlTarget[]) => organizationSettingsApi.updateCm08MqlTargetsRequest(targets),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['organizations', 'settings'] })
      // CM-08 reads the plan at compute time — refresh the dashboard card too.
      queryClient.invalidateQueries({ queryKey: ['metrics'] })
    }
  })
}

export function useUpdateHubSpotHistorySource() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (hubspotUseImportedHistory: boolean) => organizationSettingsApi.updateHubSpotHistorySourceRequest(hubspotUseImportedHistory),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['organizations', 'settings'] })
  })
}
