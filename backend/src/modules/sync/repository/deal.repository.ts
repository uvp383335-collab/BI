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
  productIds: string[]
  ownerName?: string
  accountName?: string
  campaignName?: string
  isPrivate?: boolean
  expectedRevenue?: number
  nextStep?: string
  probability?: number
  description?: string
  createdByName?: string
  lastModifiedByName?: string
  lastModifiedAt?: Date
  customFields?: { label: string; value: string | number | boolean | null }[]
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
  async findContactAssociationsForFunnel(orgId: string | Types.ObjectId, provider: string, pipeline?: string, productId?: string) {
    const DealModel = await modelForOrg(orgId)
    const query: Record<string, unknown> = { orgId, provider, 'contactIds.0': { $exists: true } }
    if (pipeline) query.pipeline = pipeline
    if (productId) query.productIds = productId

    return DealModel.find(query, { pipeline: 1, dealstage: 1, contactIds: 1 }).lean()
  },

  async distinctPipelines(orgId: string | Types.ObjectId, provider: string) {
    const DealModel = await modelForOrg(orgId)
    return DealModel.distinct('pipeline', { orgId, provider, pipeline: { $ne: null } })
  },

  /** Deal providerRecordIds carrying the given product — funnel.service.ts intersects this against a cohort to scope the deal-stage/lead-to-deal funnels by product. */
  async findIdsByProduct(orgId: string | Types.ObjectId, provider: string, productId: string): Promise<string[]> {
    const DealModel = await modelForOrg(orgId)
    return DealModel.distinct('providerRecordId', { orgId, provider, productIds: productId })
  },

  /** Deals closing within a date range, across every pipeline — CM-03/CM-04/CM-05's raw material (qualified/won-lost/competitor filtering happens in the metric, joined against PipelineStageDefinition). `leadSource`/`campaignId` (Salesforce-only) feed CM-05's Salesforce marketing-attribution branch. */
  async findByCloseDateRange(orgId: string | Types.ObjectId, provider: string, from: Date, to: Date) {
    const DealModel = await modelForOrg(orgId)
    return DealModel.find(
      { orgId, provider, closedate: { $gte: from, $lte: to } },
      { pipeline: 1, dealstage: 1, amount: 1, closedate: 1, contactIds: 1, competitor: 1, competitors: 1, leadSource: 1, campaignId: 1 }
    ).lean()
  },

  /** Deals created within a date range — CM-05's "qualified pipeline created this period" input, distinct from findByCloseDateRange (creation, not expected/actual close). `leadSource`/`campaignId` (Salesforce-only) feed CM-05's Salesforce marketing-attribution branch. */
  async findByCreateDateRange(orgId: string | Types.ObjectId, provider: string, from: Date, to: Date) {
    const DealModel = await modelForOrg(orgId)
    return DealModel.find(
      { orgId, provider, dealCreatedAt: { $gte: from, $lte: to } },
      { pipeline: 1, dealstage: 1, amount: 1, contactIds: 1, leadSource: 1, campaignId: 1 }
    ).lean()
  },

  /** Raw deal/opportunity records for the "Campaigns & Opportunities" browse view — full field set, paginated, most-recently-created first. */
  async findAllPaginated(orgId: string | Types.ObjectId, provider: string, opts: { page?: number; pageSize?: number } = {}) {
    const DealModel = await modelForOrg(orgId)
    const page = Math.max(1, opts.page ?? 1)
    const pageSize = Math.max(1, Math.min(100, opts.pageSize ?? 20))
    const filter = { orgId, provider }

    const [items, total] = await Promise.all([
      DealModel.find(filter, {
        dealname: 1,
        amount: 1,
        closedate: 1,
        pipeline: 1,
        dealstage: 1,
        type: 1,
        leadSource: 1,
        campaignId: 1,
        campaignName: 1,
        accountId: 1,
        accountName: 1,
        ownerId: 1,
        ownerName: 1,
        dealCreatedAt: 1,
        competitor: 1,
        competitors: 1,
        isPrivate: 1,
        expectedRevenue: 1,
        nextStep: 1,
        probability: 1,
        description: 1,
        createdByName: 1,
        lastModifiedByName: 1,
        lastModifiedAt: 1,
        customFields: 1
      })
        .sort({ dealCreatedAt: -1, createdAt: -1 })
        .skip((page - 1) * pageSize)
        .limit(pageSize)
        .lean(),
      DealModel.countDocuments(filter)
    ])

    return { items, total, page, pageSize }
  }
}
