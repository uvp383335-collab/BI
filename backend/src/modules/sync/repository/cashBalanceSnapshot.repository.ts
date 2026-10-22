import { Connection, Types } from 'mongoose'
import { getCashBalanceSnapshotModel } from '../model/CashBalanceSnapshot.model'
import { getTenantConnection } from '../../../database/tenantConnection'

export interface CashBalanceSnapshotUpsertInput {
  asOfDate: string
  unrestrictedCash: number
  fetchedAt: Date
}

async function modelForOrg(orgId: string | Types.ObjectId) {
  const connection: Connection = await getTenantConnection(orgId.toString())
  return getCashBalanceSnapshotModel(connection)
}

export const cashBalanceSnapshotRepository = {
  async upsert(orgId: string | Types.ObjectId, provider: string, input: CashBalanceSnapshotUpsertInput) {
    const Model = await modelForOrg(orgId)
    const orgObjectId = new Types.ObjectId(orgId)
    await Model.updateOne(
      { orgId: orgObjectId, provider, asOfDate: input.asOfDate },
      { $set: { orgId: orgObjectId, provider, ...input } },
      { upsert: true }
    )
  },

  /** Most recent snapshots first, up to `limit` — the raw material for CB-05's runway/burn-rate calculation. */
  async findRecent(orgId: string | Types.ObjectId, provider: string, limit: number) {
    const Model = await modelForOrg(orgId)
    return Model.find({ orgId, provider }).sort({ asOfDate: -1 }).limit(limit).lean()
  }
}
