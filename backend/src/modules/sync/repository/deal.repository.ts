import { Connection, Types } from 'mongoose'
import { getDealModel } from '../model/Deal.model'
import { getTenantConnection } from '../../../database/tenantConnection'

export interface DealUpsertInput {
  providerRecordId: string
  dealname?: string
  amount?: number
  closedate?: Date
  pipeline?: string
  dealstage?: string
  ownerId?: string
  contactIds: string[]
  dealStageHistory: { value: string; timestamp: Date }[]
  type?: string
  leadSource?: string
  campaignId?: string
  accountId?: string
  dealCreatedAt?: Date
  competitor?: string
  competitors?: string[]
}

/** Resolves the Deal model bound to the given org's own tenant database. */
async function modelForOrg(orgId: string | Types.ObjectId) {
  const connection: Connection = await getTenantConnection(orgId.toString())
  return getDealModel(connection)
}

export const dealRepository = {
  async count(orgId: string | Types.ObjectId, provider: string) {
    const DealModel = await modelForOrg(orgId)
    return DealModel.countDocuments({ orgId, provider })
  },

  async bulkUpsert(orgId: string | Types.ObjectId, provider: string, deals: DealUpsertInput[]) {
    if (deals.length === 0) return
    const DealModel = await modelForOrg(orgId)
    const orgObjectId = new Types.ObjectId(orgId)
    const operations = deals.map((deal) => ({
      updateOne: {
        filter: { orgId: orgObjectId, provider, providerRecordId: deal.providerRecordId },
        update: { $set: { orgId: orgObjectId, provider, ...deal } },
        upsert: true
      }
    }))
    await DealModel.bulkWrite(operations, { ordered: false })
  },

  /** Deals that have at least one associated contact — the raw material for the lead-to-deal conversion funnel. */
  async findContactAssociationsForFunnel(orgId: string | Types.ObjectId, provider: string, pipeline?: string) {
    const DealModel = await modelForOrg(orgId)
    const query: Record<string, unknown> = { orgId, provider, 'contactIds.0': { $exists: true } }
    if (pipeline) query.pipeline = pipeline

    return DealModel.find(query, { pipeline: 1, dealstage: 1, contactIds: 1 }).lean()
  },

  async distinctPipelines(orgId: string | Types.ObjectId, provider: string) {
    const DealModel = await modelForOrg(orgId)
    return DealModel.distinct('pipeline', { orgId, provider, pipeline: { $ne: null } })
  },

  /** Deals closing within a date range, across every pipeline — CM-03/CM-04/CM-05's raw material (qualified/won-lost/competitor filtering happens in the metric, joined against PipelineStageDefinition). */
  async findByCloseDateRange(orgId: string | Types.ObjectId, provider: string, from: Date, to: Date) {
    const DealModel = await modelForOrg(orgId)
    return DealModel.find(
      { orgId, provider, closedate: { $gte: from, $lte: to } },
      { pipeline: 1, dealstage: 1, amount: 1, closedate: 1, contactIds: 1, competitor: 1, competitors: 1 }
    ).lean()
  },

  /** Deals created within a date range — CM-05's "qualified pipeline created this period" input, distinct from findByCloseDateRange (creation, not expected/actual close). */
  async findByCreateDateRange(orgId: string | Types.ObjectId, provider: string, from: Date, to: Date) {
    const DealModel = await modelForOrg(orgId)
    return DealModel.find(
      { orgId, provider, dealCreatedAt: { $gte: from, $lte: to } },
      { pipeline: 1, dealstage: 1, amount: 1, contactIds: 1 }
    ).lean()
  }
}
