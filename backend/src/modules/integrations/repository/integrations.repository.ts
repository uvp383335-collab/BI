import { IntegrationModel, IntegrationProvider } from '../model/Integration.model'
import { Types } from 'mongoose'

export interface UpsertIntegrationInput {
  accessToken: string
  refreshToken: string
  expiresAt: Date
  scope: string[]
  connectedBy: string | Types.ObjectId
  accountId?: string | null
  accountDomain?: string | null
}

export const integrationsRepository = {
  findByOrgAndProvider(orgId: string | Types.ObjectId, provider: IntegrationProvider) {
    return IntegrationModel.findOne({ orgId, provider })
  },

  listByOrg(orgId: string | Types.ObjectId) {
    return IntegrationModel.find({ orgId })
  },

  async upsert(orgId: string | Types.ObjectId, provider: IntegrationProvider, data: UpsertIntegrationInput) {
    const existing = await IntegrationModel.findOne({ orgId, provider })
    if (existing) {
      existing.accessToken = data.accessToken
      existing.refreshToken = data.refreshToken
      existing.expiresAt = data.expiresAt
      existing.scope = data.scope
      existing.connectedBy = new Types.ObjectId(data.connectedBy)
      existing.accountId = data.accountId ?? existing.accountId
      existing.accountDomain = data.accountDomain ?? existing.accountDomain
      return existing.save()
    }
    return IntegrationModel.create({ orgId, provider, ...data })
  },

  updateAccessToken(orgId: string | Types.ObjectId, provider: IntegrationProvider, accessToken: string, expiresAt: Date) {
    return IntegrationModel.findOneAndUpdate({ orgId, provider }, { accessToken, expiresAt }, { new: true })
  },

  async delete(orgId: string | Types.ObjectId, provider: IntegrationProvider) {
    const result = await IntegrationModel.deleteOne({ orgId, provider })
    return result.deletedCount > 0
  },

  async isTokenExpired(orgId: string | Types.ObjectId, provider: IntegrationProvider) {
    const integration = await IntegrationModel.findOne({ orgId, provider })
    if (!integration) return true
    return new Date() >= integration.expiresAt
  }
}
