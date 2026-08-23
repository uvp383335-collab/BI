import { Connection, Types } from 'mongoose'
import { getIntegrationModel, IntegrationProvider } from '../model/Integration.model'
import { getTenantConnection } from '../../../database/tenantConnection'

export interface UpsertIntegrationInput {
  accessToken: string
  refreshToken: string
  expiresAt: Date
  scope: string[]
  connectedBy: string | Types.ObjectId
  accountId?: string | null
  accountDomain?: string | null
  instanceUrl?: string | null
}

/** Resolves the Integration model bound to the given org's own tenant database. */
async function modelForOrg(orgId: string | Types.ObjectId) {
  const connection: Connection = await getTenantConnection(orgId.toString())
  return getIntegrationModel(connection)
}

export const integrationsRepository = {
  async findByOrgAndProvider(orgId: string | Types.ObjectId, provider: IntegrationProvider) {
    const IntegrationModel = await modelForOrg(orgId)
    return IntegrationModel.findOne({ orgId, provider })
  },

  async listByOrg(orgId: string | Types.ObjectId) {
    const IntegrationModel = await modelForOrg(orgId)
    return IntegrationModel.find({ orgId })
  },

  async upsert(orgId: string | Types.ObjectId, provider: IntegrationProvider, data: UpsertIntegrationInput) {
    const IntegrationModel = await modelForOrg(orgId)
    const existing = await IntegrationModel.findOne({ orgId, provider })
    if (existing) {
      existing.accessToken = data.accessToken
      existing.refreshToken = data.refreshToken
      existing.expiresAt = data.expiresAt
      existing.scope = data.scope
      existing.connectedBy = new Types.ObjectId(data.connectedBy)
      existing.accountId = data.accountId ?? existing.accountId
      existing.accountDomain = data.accountDomain ?? existing.accountDomain
      existing.instanceUrl = data.instanceUrl ?? existing.instanceUrl
      return existing.save()
    }
    return IntegrationModel.create({ orgId, provider, ...data })
  },

  async updateAccessToken(orgId: string | Types.ObjectId, provider: IntegrationProvider, accessToken: string, expiresAt: Date) {
    const IntegrationModel = await modelForOrg(orgId)
    return IntegrationModel.findOneAndUpdate({ orgId, provider }, { accessToken, expiresAt }, { new: true })
  },

  async updateLastSyncedAt(orgId: string | Types.ObjectId, provider: IntegrationProvider, lastSyncedAt: Date) {
    const IntegrationModel = await modelForOrg(orgId)
    return IntegrationModel.findOneAndUpdate({ orgId, provider }, { lastSyncedAt }, { new: true })
  },

  async delete(orgId: string | Types.ObjectId, provider: IntegrationProvider) {
    const IntegrationModel = await modelForOrg(orgId)
    const result = await IntegrationModel.deleteOne({ orgId, provider })
    return result.deletedCount > 0
  },

  async isTokenExpired(orgId: string | Types.ObjectId, provider: IntegrationProvider) {
    const IntegrationModel = await modelForOrg(orgId)
    const integration = await IntegrationModel.findOne({ orgId, provider })
    if (!integration) return true
    return new Date() >= integration.expiresAt
  }
}
