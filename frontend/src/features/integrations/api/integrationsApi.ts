import { httpClient } from '../../../shared/api/httpClient'

export type IntegrationProvider = 'hubspot' | 'salesforce' | 'quickbooks'

interface ApiEnvelope<T> {
  success: boolean
  data: T
}

export interface ProviderStatus {
  connected: boolean
  connectedAt?: string
  accountId?: string | null
  accountDomain?: string | null
  lastSyncedAt?: string | null
  comingSoon?: boolean
}

export type IntegrationsStatus = Record<IntegrationProvider, ProviderStatus>

export async function getIntegrationsStatusRequest(): Promise<IntegrationsStatus> {
  const res = await httpClient.get<ApiEnvelope<IntegrationsStatus>>('/integrations/status')
  return res.data.data
}

export async function getAuthorizeUrlRequest(provider: IntegrationProvider): Promise<{ authUrl: string }> {
  const res = await httpClient.get<ApiEnvelope<{ authUrl: string }>>(`/integrations/${provider}/authorize`)
  return res.data.data
}

export async function disconnectIntegrationRequest(provider: IntegrationProvider): Promise<{ disconnected: boolean }> {
  const res = await httpClient.delete<ApiEnvelope<{ disconnected: boolean }>>(`/integrations/${provider}/disconnect`)
  return res.data.data
}
