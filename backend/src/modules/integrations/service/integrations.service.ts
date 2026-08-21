import { integrationsRepository } from '../repository/integrations.repository'
import { HubSpotService } from './hubspot.service'
import { signIntegrationState, verifyIntegrationState } from '../../../shared/utils/jwt'
import { AppError } from '../../../shared/utils/AppError'
import { IntegrationProvider } from '../model/Integration.model'

export const SUPPORTED_PROVIDERS: IntegrationProvider[] = ['hubspot', 'salesforce', 'quickbooks']
const IMPLEMENTED_PROVIDERS: IntegrationProvider[] = ['hubspot']

function assertProvider(provider: string): asserts provider is IntegrationProvider {
  if (!SUPPORTED_PROVIDERS.includes(provider as IntegrationProvider)) {
    throw AppError.badRequest('Invalid provider', 'INVALID_PROVIDER')
  }
}

function assertImplemented(provider: IntegrationProvider) {
  if (!IMPLEMENTED_PROVIDERS.includes(provider)) {
    throw AppError.badRequest(`${provider} is not available yet`, 'PROVIDER_NOT_IMPLEMENTED')
  }
}

export interface ProviderStatus {
  connected: boolean
  connectedAt?: string
  accountId?: string | null
  accountDomain?: string | null
  comingSoon?: boolean
}

/** Generates the provider's OAuth authorization URL, embedding org/user context via signed state. */
export async function getAuthorizationUrl(orgId: string, userId: string, provider: string): Promise<string> {
  assertProvider(provider)
  assertImplemented(provider)

  const state = signIntegrationState({ userId, orgId, provider })

  if (provider === 'hubspot') {
    return HubSpotService.getAuthorizationUrl(state)
  }
  throw AppError.badRequest(`${provider} is not available yet`, 'PROVIDER_NOT_IMPLEMENTED')
}

/** Handles the OAuth redirect callback: verifies state, exchanges the code, and persists the connection. */
export async function handleCallback(provider: string, code: string, state: string): Promise<{ orgId: string }> {
  assertProvider(provider)
  assertImplemented(provider)

  const payload = verifyIntegrationState(state)
  if (payload.provider !== provider) {
    throw AppError.badRequest('OAuth state does not match provider', 'STATE_PROVIDER_MISMATCH')
  }

  if (provider === 'hubspot') {
    const tokenData = await HubSpotService.exchangeCodeForToken(code)
    const tokenInfo = await HubSpotService.getTokenInfo(tokenData.accessToken)
    const expiresAt = new Date(Date.now() + tokenData.expiresIn * 1000)

    await integrationsRepository.upsert(payload.orgId, provider, {
      accessToken: tokenData.accessToken,
      refreshToken: tokenData.refreshToken,
      expiresAt,
      scope: tokenInfo?.scopes ?? [],
      connectedBy: payload.userId,
      accountId: tokenInfo?.hubId ?? null,
      accountDomain: tokenInfo?.hubDomain ?? null
    })
  }

  return { orgId: payload.orgId }
}

/**
 * Returns the connection status for every provider tile shown on the connect
 * screen. Only HubSpot is currently implemented; Salesforce/QuickBooks are
 * reported as "coming soon" placeholders.
 */
export async function getStatus(orgId: string): Promise<Record<IntegrationProvider, ProviderStatus>> {
  const integrations = await integrationsRepository.listByOrg(orgId)
  const byProvider = new Map(integrations.map((i) => [i.provider, i]))

  const hubspot = byProvider.get('hubspot')

  return {
    hubspot: hubspot
      ? {
          connected: true,
          connectedAt: hubspot.createdAt.toISOString(),
          accountId: hubspot.accountId,
          accountDomain: hubspot.accountDomain
        }
      : { connected: false },
    salesforce: { connected: false, comingSoon: true },
    quickbooks: { connected: false, comingSoon: true }
  }
}

export async function disconnect(orgId: string, provider: string): Promise<void> {
  assertProvider(provider)
  assertImplemented(provider)
  await integrationsRepository.delete(orgId, provider)
}

/** Returns a valid (refreshed if necessary) access token for the org's connection to `provider`. */
export async function getValidAccessToken(orgId: string, provider: string): Promise<string> {
  assertProvider(provider)
  assertImplemented(provider)

  const integration = await integrationsRepository.findByOrgAndProvider(orgId, provider)
  if (!integration) {
    throw AppError.notFound(`No ${provider} connection found for this organization`, 'INTEGRATION_NOT_FOUND')
  }

  const isExpired = new Date() >= integration.expiresAt
  if (!isExpired) {
    return integration.accessToken
  }

  if (provider === 'hubspot') {
    const refreshed = await HubSpotService.refreshAccessToken(integration.refreshToken)
    const expiresAt = new Date(Date.now() + refreshed.expiresIn * 1000)
    await integrationsRepository.updateAccessToken(orgId, provider, refreshed.accessToken, expiresAt)
    return refreshed.accessToken
  }

  throw AppError.badRequest(`${provider} is not available yet`, 'PROVIDER_NOT_IMPLEMENTED')
}
