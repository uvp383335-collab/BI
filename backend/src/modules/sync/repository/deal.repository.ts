import { DealModel } from '../model/Deal.model'
import { Types } from 'mongoose'

export interface DealUpsertInput {
  hubspotId: string
  dealname?: string
  amount?: number
  closedate?: Date
  pipeline?: string
  dealstage?: string
  hubspotOwnerId?: string
  dealStageHistory: { value: string; timestamp: Date }[]
}

export const dealRepository = {
  count(orgId: string | Types.ObjectId, provider: string) {
    return DealModel.countDocuments({ orgId, provider })
  },

  async bulkUpsert(orgId: string | Types.ObjectId, provider: string, deals: DealUpsertInput[]) {
    if (deals.length === 0) return
    const orgObjectId = new Types.ObjectId(orgId)
    const operations = deals.map((deal) => ({
      updateOne: {
        filter: { orgId: orgObjectId, provider, hubspotId: deal.hubspotId },
        update: { $set: { orgId: orgObjectId, provider, ...deal } },
        upsert: true
      }
    }))
    await DealModel.bulkWrite(operations, { ordered: false })
  },

  findForPipelineProgression(
    orgId: string | Types.ObjectId,
    provider: string,
    filters: { pipeline?: string; hubspotOwnerId?: string }
  ) {
    const query: Record<string, unknown> = {
      orgId,
      provider,
      'dealStageHistory.0': { $exists: true }
    }
    if (filters.pipeline) query.pipeline = filters.pipeline
    if (filters.hubspotOwnerId) query.hubspotOwnerId = filters.hubspotOwnerId

    return DealModel.find(query, { pipeline: 1, hubspotOwnerId: 1, dealStageHistory: 1 }).lean()
  },

  distinctPipelines(orgId: string | Types.ObjectId, provider: string) {
    return DealModel.distinct('pipeline', { orgId, provider, pipeline: { $ne: null } })
  },

  distinctOwnerIds(orgId: string | Types.ObjectId, provider: string) {
    return DealModel.distinct('hubspotOwnerId', { orgId, provider, hubspotOwnerId: { $ne: null } })
  }
}
