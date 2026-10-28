import { Connection, Types } from 'mongoose'
import { getSalesforceCampaignModel } from '../model/SalesforceCampaign.model'
import { getTenantConnection } from '../../../database/tenantConnection'

export interface SalesforceCampaignUpsertInput {
  providerRecordId: string
  name?: string
  type?: string
  status?: string
  startDate?: Date
  endDate?: Date
  active?: boolean
  ownerName?: string
  expectedRevenue?: number
  budgetedCost?: number
  actualCost?: number
  expectedResponsePct?: number
  numberSent?: number
  parentCampaignName?: string
  description?: string
  createdByName?: string
  lastModifiedByName?: string
  lastModifiedAt?: Date
  numberOfLeads?: number
  numberOfConvertedLeads?: number
  numberOfContacts?: number
  numberOfResponses?: number
  numberOfOpportunities?: number
  numberOfWonOpportunities?: number
  amountAllOpportunities?: number
  amountWonOpportunities?: number
}

async function modelForOrg(orgId: string | Types.ObjectId) {
  const connection: Connection = await getTenantConnection(orgId.toString())
  return getSalesforceCampaignModel(connection)
}

export const salesforceCampaignRepository = {
  async bulkUpsert(orgId: string | Types.ObjectId, provider: string, campaigns: SalesforceCampaignUpsertInput[]) {
    if (campaigns.length === 0) return
    const Model = await modelForOrg(orgId)
    const orgObjectId = new Types.ObjectId(orgId)
    const operations = campaigns.map((campaign) => ({
      updateOne: {
        filter: { orgId: orgObjectId, provider, providerRecordId: campaign.providerRecordId },
        update: { $set: { orgId: orgObjectId, provider, ...campaign } },
        upsert: true
      }
    }))
    await Model.bulkWrite(operations, { ordered: false })
  },

  async findAll(orgId: string | Types.ObjectId, provider: string) {
    const Model = await modelForOrg(orgId)
    return Model.find({ orgId, provider }).lean()
  },

  /** Raw campaign records for the "Campaigns & Opportunities" browse view, paginated, most-recently-synced first. */
  async findAllPaginated(orgId: string | Types.ObjectId, provider: string, opts: { page?: number; pageSize?: number } = {}) {
    const Model = await modelForOrg(orgId)
    const page = Math.max(1, opts.page ?? 1)
    const pageSize = Math.max(1, Math.min(100, opts.pageSize ?? 20))
    const filter = { orgId, provider }

    const [items, total] = await Promise.all([
      Model.find(filter).sort({ createdAt: -1 }).skip((page - 1) * pageSize).limit(pageSize).lean(),
      Model.countDocuments(filter)
    ])

    return { items, total, page, pageSize }
  }
}
