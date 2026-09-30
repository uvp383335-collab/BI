import { Connection, Types } from 'mongoose'
import { getCampaignModel } from '../model/Campaign.model'
import { getTenantConnection } from '../../../database/tenantConnection'

export interface CampaignUpsertInput {
  providerRecordId: string
  name?: string
  type?: string
  isActive: boolean
  actualCost: number
  numberOfLeads: number
  numberOfConvertedLeads: number
  numberOfOpportunities: number
  numberOfWonOpportunities: number
  amountAllOpportunities: number
  amountWonOpportunities: number
}

export interface ChannelSums {
  channel: string
  campaigns: number
  cost: number
  wonRevenue: number
  wonOpportunities: number
}

async function modelForOrg(orgId: string | Types.ObjectId) {
  const connection: Connection = await getTenantConnection(orgId.toString())
  return getCampaignModel(connection)
}

export const campaignRepository = {
  async count(orgId: string | Types.ObjectId, provider: string) {
    const Model = await modelForOrg(orgId)
    return Model.countDocuments({ orgId, provider })
  },

  async bulkUpsert(orgId: string | Types.ObjectId, provider: string, campaigns: CampaignUpsertInput[]) {
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

  /** Spend/won-revenue/won-opportunities summed per channel (`type`) — the raw inputs for CAC and ROI-by-channel. */
  async sumsByChannel(orgId: string | Types.ObjectId, provider: string): Promise<ChannelSums[]> {
    const Model = await modelForOrg(orgId)
    const orgObjectId = new Types.ObjectId(orgId)
    const rows = await Model.aggregate<{ _id: string; campaigns: number; cost: number; wonRevenue: number; wonOpportunities: number }>([
      { $match: { orgId: orgObjectId, provider } },
      {
        $group: {
          _id: { $ifNull: ['$type', 'Unspecified'] },
          campaigns: { $sum: 1 },
          cost: { $sum: '$actualCost' },
          wonRevenue: { $sum: '$amountWonOpportunities' },
          wonOpportunities: { $sum: '$numberOfWonOpportunities' }
        }
      },
      { $sort: { cost: -1 } }
    ])
    return rows.map((row) => ({
      channel: row._id,
      campaigns: row.campaigns,
      cost: row.cost,
      wonRevenue: row.wonRevenue,
      wonOpportunities: row.wonOpportunities
    }))
  }
}
