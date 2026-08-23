import crypto from 'crypto'
import { integrationsRepository } from '../repository/integrations.repository'
import { HubSpotService } from './hubspot.service'
import { SalesforceService } from './salesforce.service'
import { QuickBooksService, QUICKBOOKS_SCOPES } from './quickbooks.service'
import { signIntegrationState, verifyIntegrationState } from '../../../shared/utils/jwt'
import { AppError } from '../../../shared/utils/AppError'
import { IntegrationProvider } from '../model/Integration.model'
import { ProviderConnectionIndexModel } from '../model/ProviderConnectionIndex.model'
import { membershipsRepository } from '../../organizations/repository/memberships.repository'
import { organizationsRepository } from '../../organizations/repository/organizations.repository'

export const SUPPORTED_PROVIDERS: IntegrationProvider[] = ['hubspot', 'salesforce', 'quickbooks']
const IMPLEMENTED_PROVIDERS: IntegrationProvider[] = ['hubspot', 'salesforce', 'quickbooks']

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
  lastSyncedAt?: string | null
  comingSoon?: boolean
}

/** Generates the provider's OAuth authorization URL, embedding org/user context via signed state. */
export async function getAuthorizationUrl(orgId: string, userId: string, provider: string): Promise<string> {
  assertProvider(provider)
  assertImplemented(provider)

  if (provider === 'salesforce') {
    // PKCE: the verifier can't be kept server-side across a stateless OAuth
    // redirect, so it rides along inside the signed state JWT instead.
    const codeVerifier = crypto.randomBytes(32).toString('base64url')
    const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url')
    const state = signIntegrationState({ userId, orgId, provider, codeVerifier })
    return SalesforceService.getAuthorizationUrl(state, codeChallenge)
  }

  const state = signIntegrationState({ userId, orgId, provider })
  if (provider === 'hubspot') {
    return HubSpotService.getAuthorizationUrl(state)
  }
  if (provider === 'quickbooks') {
    return QuickBooksService.getAuthorizationUrl(state)
  }
  throw AppError.badRequest(`${provider} is not available yet`, 'PROVIDER_NOT_IMPLEMENTED')
}

/**
 * Guards a HubSpot connection attempt against both directions of account/org
 * collision. Each org is permanently bound to the first HubSpot account
 * (hub_id) it successfully connects for this provider — switching accounts
 * within the same org is not supported by design (create a new organization
 * to connect a different account instead). Throws a distinguishable AppError
 * so the controller can redirect to the right resolution flow:
 *  - this account already belongs to this org      -> allowed (reconnect/refresh case)
 *  - this account belongs to a different org        -> HUBSPOT_ALREADY_CONNECTED_SWITCH (user is a member, offer to switch) /
 *                                                        HUBSPOT_ALREADY_CONNECTED_REQUEST_ACCESS (user is not, no org details leaked)
 *  - this org already permanently owns a *different* account -> HUBSPOT_ORG_LOCKED_TO_ACCOUNT
 */
async function assertHubSpotAccountUsable(hubId: string, targetOrgId: string, userId: string): Promise<void> {
  const byAccount = await ProviderConnectionIndexModel.findOne({ provider: 'hubspot', externalAccountId: hubId })
  if (byAccount && byAccount.orgId.toString() !== targetOrgId) {
    const otherOrgId = byAccount.orgId.toString()
    const membership = await membershipsRepository.findByUserAndOrg(userId, otherOrgId)

    if (membership && membership.status === 'active') {
      const otherOrg = await organizationsRepository.findById(otherOrgId)
      throw new AppError(
        'This HubSpot account is already connected to another organization you belong to',
        409,
        'HUBSPOT_ALREADY_CONNECTED_SWITCH',
        { orgId: otherOrgId, orgName: otherOrg?.name, orgSlug: otherOrg?.slug }
      )
    }

    // Don't reveal which org owns it to a user who isn't a member of it.
    throw new AppError(
      'This HubSpot account is already connected to another workspace',
      409,
      'HUBSPOT_ALREADY_CONNECTED_REQUEST_ACCESS'
    )
  }

  const byOrg = await ProviderConnectionIndexModel.findOne({ provider: 'hubspot', orgId: targetOrgId })
  if (byOrg && byOrg.externalAccountId !== hubId) {
    throw new AppError(
      'This organization is already connected to a different HubSpot account. Create a new organization to connect a different account.',
      409,
      'HUBSPOT_ORG_LOCKED_TO_ACCOUNT'
    )
  }
}

/** Same collision-guard contract as assertHubSpotAccountUsable above, for Salesforce's org id. */
async function assertSalesforceAccountUsable(orgIdentifier: string, targetOrgId: string, userId: string): Promise<void> {
  const byAccount = await ProviderConnectionIndexModel.findOne({ provider: 'salesforce', externalAccountId: orgIdentifier })
  if (byAccount && byAccount.orgId.toString() !== targetOrgId) {
    const otherOrgId = byAccount.orgId.toString()
    const membership = await membershipsRepository.findByUserAndOrg(userId, otherOrgId)

    if (membership && membership.status === 'active') {
      const otherOrg = await organizationsRepository.findById(otherOrgId)
      throw new AppError(
        'This Salesforce account is already connected to another organization you belong to',
        409,
        'SALESFORCE_ALREADY_CONNECTED_SWITCH',
        { orgId: otherOrgId, orgName: otherOrg?.name, orgSlug: otherOrg?.slug }
      )
    }

    throw new AppError(
      'This Salesforce account is already connected to another workspace',
      409,
      'SALESFORCE_ALREADY_CONNECTED_REQUEST_ACCESS'
    )
  }

  const byOrg = await ProviderConnectionIndexModel.findOne({ provider: 'salesforce', orgId: targetOrgId })
  if (byOrg && byOrg.externalAccountId !== orgIdentifier) {
    throw new AppError(
      'This organization is already connected to a different Salesforce account. Create a new organization to connect a different account.',
      409,
      'SALESFORCE_ORG_LOCKED_TO_ACCOUNT'
    )
  }
}

/** Same collision-guard contract as assertHubSpotAccountUsable above, for QuickBooks' company id (realmId). */
async function assertQuickBooksAccountUsable(realmId: string, targetOrgId: string, userId: string): Promise<void> {
  const byAccount = await ProviderConnectionIndexModel.findOne({ provider: 'quickbooks', externalAccountId: realmId })
  if (byAccount && byAccount.orgId.toString() !== targetOrgId) {
    const otherOrgId = byAccount.orgId.toString()
    const membership = await membershipsRepository.findByUserAndOrg(userId, otherOrgId)

    if (membership && membership.status === 'active') {
      const otherOrg = await organizationsRepository.findById(otherOrgId)
      throw new AppError(
        'This QuickBooks company is already connected to another organization you belong to',
        409,
        'QUICKBOOKS_ALREADY_CONNECTED_SWITCH',
        { orgId: otherOrgId, orgName: otherOrg?.name, orgSlug: otherOrg?.slug }
      )
    }

    throw new AppError(
      'This QuickBooks company is already connected to another workspace',
      409,
      'QUICKBOOKS_ALREADY_CONNECTED_REQUEST_ACCESS'
    )
  }

  const byOrg = await ProviderConnectionIndexModel.findOne({ provider: 'quickbooks', orgId: targetOrgId })
  if (byOrg && byOrg.externalAccountId !== realmId) {
    throw new AppError(
      'This organization is already connected to a different QuickBooks company. Create a new organization to connect a different one.',
      409,
      'QUICKBOOKS_ORG_LOCKED_TO_ACCOUNT'
    )
  }
}

/**
 * Handles the OAuth redirect callback: verifies state, exchanges the code, and persists the connection.
 * `realmId` is QuickBooks-only — Intuit appends the connected company id directly onto the redirect query
 * string, so the controller passes it through unchanged for that provider.
 */
export async function handleCallback(
  provider: string,
  code: string,
  state: string,
  realmId?: string
): Promise<{ orgId: string }> {
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
    const hubId = tokenInfo?.hubId ?? null

    if (hubId) {
      await assertHubSpotAccountUsable(hubId, payload.orgId, payload.userId)
    }

    await integrationsRepository.upsert(payload.orgId, provider, {
      accessToken: tokenData.accessToken,
      refreshToken: tokenData.refreshToken,
      expiresAt,
      scope: tokenInfo?.scopes ?? [],
      connectedBy: payload.userId,
      accountId: hubId,
      accountDomain: tokenInfo?.hubDomain ?? null
    })

    if (hubId) {
      // Claim (or reaffirm) this HubSpot account for this org in the global,
      // cross-tenant index used purely for collision detection.
      await ProviderConnectionIndexModel.findOneAndUpdate(
        { provider, externalAccountId: hubId },
        { provider, externalAccountId: hubId, externalAccountLabel: tokenInfo?.hubDomain ?? null, orgId: payload.orgId },
        { upsert: true, new: true }
      )
    }
  }

  if (provider === 'salesforce') {
    if (!payload.codeVerifier) {
      throw AppError.badRequest('Missing PKCE code verifier in OAuth state', 'SALESFORCE_MISSING_CODE_VERIFIER')
    }

    const tokenData = await SalesforceService.exchangeCodeForToken(code, payload.codeVerifier)
    const expiresAt = new Date(Date.now() + tokenData.expiresIn * 1000)

    if (tokenData.externalAccountId) {
      await assertSalesforceAccountUsable(tokenData.externalAccountId, payload.orgId, payload.userId)
    }

    await integrationsRepository.upsert(payload.orgId, provider, {
      accessToken: tokenData.accessToken,
      refreshToken: tokenData.refreshToken,
      expiresAt,
      scope: tokenData.scope,
      connectedBy: payload.userId,
      accountId: tokenData.externalAccountId || null,
      accountDomain: tokenData.instanceUrl,
      instanceUrl: tokenData.instanceUrl
    })

    if (tokenData.externalAccountId) {
      await ProviderConnectionIndexModel.findOneAndUpdate(
        { provider, externalAccountId: tokenData.externalAccountId },
        {
          provider,
          externalAccountId: tokenData.externalAccountId,
          externalAccountLabel: tokenData.instanceUrl,
          orgId: payload.orgId
        },
        { upsert: true, new: true }
      )
    }
  }

  if (provider === 'quickbooks') {
    if (!realmId) {
      throw AppError.badRequest('Missing QuickBooks company id (realmId) in OAuth callback', 'QUICKBOOKS_MISSING_REALM_ID')
    }

    const tokenData = await QuickBooksService.exchangeCodeForToken(code)
    const expiresAt = new Date(Date.now() + tokenData.expiresIn * 1000)

    await assertQuickBooksAccountUsable(realmId, payload.orgId, payload.userId)

    await integrationsRepository.upsert(payload.orgId, provider, {
      accessToken: tokenData.accessToken,
      refreshToken: tokenData.refreshToken,
      expiresAt,
      scope: QUICKBOOKS_SCOPES,
      connectedBy: payload.userId,
      accountId: realmId,
      accountDomain: null
    })

    await ProviderConnectionIndexModel.findOneAndUpdate(
      { provider, externalAccountId: realmId },
      { provider, externalAccountId: realmId, externalAccountLabel: null, orgId: payload.orgId },
      { upsert: true, new: true }
    )
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
  const salesforce = byProvider.get('salesforce')
  const quickbooks = byProvider.get('quickbooks')

  return {
    hubspot: hubspot
      ? {
          connected: true,
          connectedAt: hubspot.createdAt.toISOString(),
          accountId: hubspot.accountId,
          accountDomain: hubspot.accountDomain,
          lastSyncedAt: hubspot.lastSyncedAt ? hubspot.lastSyncedAt.toISOString() : null
        }
      : { connected: false },
    salesforce: salesforce
      ? {
          connected: true,
          connectedAt: salesforce.createdAt.toISOString(),
          accountId: salesforce.accountId,
          accountDomain: salesforce.accountDomain,
          lastSyncedAt: salesforce.lastSyncedAt ? salesforce.lastSyncedAt.toISOString() : null
        }
      : { connected: false },
    quickbooks: quickbooks
      ? {
          connected: true,
          connectedAt: quickbooks.createdAt.toISOString(),
          accountId: quickbooks.accountId,
          accountDomain: quickbooks.accountDomain,
          lastSyncedAt: quickbooks.lastSyncedAt ? quickbooks.lastSyncedAt.toISOString() : null
        }
      : { connected: false }
  }
}

export async function disconnect(orgId: string, provider: string): Promise<void> {
  assertProvider(provider)
  assertImplemented(provider)
  // Deliberately does NOT touch ProviderConnectionIndex: the org's claim on its
  // HubSpot account must survive disconnect, otherwise a reconnect could silently
  // bind a *different* HubSpot account to this org, mixing that account's contacts/
  // deals into the tenant DB alongside data already synced from the original one
  // (Contact/Deal rows carry no per-account marker, only `provider`). The org stays
  // permanently linked to the account it first connected — see
  // assertHubSpotAccountUsable. Only the tokens are removed; a reconnect of the
  // *same* account still works normally.
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

  if (provider === 'salesforce') {
    const refreshed = await SalesforceService.refreshAccessToken(integration.refreshToken)
    const expiresAt = new Date(Date.now() + refreshed.expiresIn * 1000)
    await integrationsRepository.updateAccessToken(orgId, provider, refreshed.accessToken, expiresAt)
    return refreshed.accessToken
  }

  if (provider === 'quickbooks') {
    const refreshed = await QuickBooksService.refreshAccessToken(integration.refreshToken)
    const expiresAt = new Date(Date.now() + refreshed.expiresIn * 1000)
    await integrationsRepository.updateAccessToken(orgId, provider, refreshed.accessToken, expiresAt)
    return refreshed.accessToken
  }

  throw AppError.badRequest(`${provider} is not available yet`, 'PROVIDER_NOT_IMPLEMENTED')
}
