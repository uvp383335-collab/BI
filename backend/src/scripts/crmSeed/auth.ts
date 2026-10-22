import dotenv from 'dotenv'
import mongoose from 'mongoose'
import { connectDatabase } from '../../database/connection'
import { closeAllTenantConnections } from '../../database/tenantConnection'
import { getValidAccessToken } from '../../modules/integrations/service/integrations.service'
import { integrationsRepository } from '../../modules/integrations/repository/integrations.repository'

dotenv.config()

/**
 * One-off data-wipe/seed scripts operate against the single org currently
 * connected to all three providers ("ABC logistics") — not general-purpose
 * multi-tenant tooling. Hardcoded on purpose; re-check via the `organizations`
 * collection if this is ever run against a different environment.
 */
export const ORG_ID = '6a8adc0e601ee7759cc616dc'

let dbReady: Promise<void> | null = null
export async function ensureDb(): Promise<void> {
  if (!dbReady) dbReady = connectDatabase().then(() => undefined)
  await dbReady
}

export async function closeDb(): Promise<void> {
  await closeAllTenantConnections()
  await mongoose.disconnect()
}

export async function hubspotAuth(): Promise<{ accessToken: string }> {
  await ensureDb()
  const accessToken = await getValidAccessToken(ORG_ID, 'hubspot')
  return { accessToken }
}

export async function salesforceAuth(): Promise<{ accessToken: string; instanceUrl: string }> {
  await ensureDb()
  const accessToken = await getValidAccessToken(ORG_ID, 'salesforce')
  const integration = await integrationsRepository.findByOrgAndProvider(ORG_ID, 'salesforce')
  if (!integration?.instanceUrl) throw new Error('Salesforce instanceUrl missing on Integration doc')
  return { accessToken, instanceUrl: integration.instanceUrl }
}

export async function quickbooksAuth(): Promise<{ accessToken: string; realmId: string }> {
  await ensureDb()
  const accessToken = await getValidAccessToken(ORG_ID, 'quickbooks')
  const integration = await integrationsRepository.findByOrgAndProvider(ORG_ID, 'quickbooks')
  if (!integration?.accountId) throw new Error('QuickBooks realmId (accountId) missing on Integration doc')
  return { accessToken, realmId: integration.accountId }
}
