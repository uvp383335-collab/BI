import { Connection, Types } from 'mongoose'
import { getPLSnapshotModel, PLLineItemDocument } from '../model/PLSnapshot.model'
import { getTenantConnection } from '../../../database/tenantConnection'

export interface PLSnapshotUpsertInput {
  quarterStart: string
  startDate: string
  endDate: string
  columns: string[]
  income: PLLineItemDocument[]
  cogs: PLLineItemDocument[]
  expenses: PLLineItemDocument[]
  otherExpenses: PLLineItemDocument[]
  sectionTotals: Record<string, Record<string, number>>
  accountsReceivable?: number
  accountsPayable?: number
  inventoryValue?: number
  operatingCashFlow?: number
  capEx?: number
  netFixedAssets?: number
  fetchedAt: Date
}

async function modelForOrg(orgId: string | Types.ObjectId) {
  const connection: Connection = await getTenantConnection(orgId.toString())
  return getPLSnapshotModel(connection)
}

export const plSnapshotRepository = {
  async upsertMany(orgId: string | Types.ObjectId, provider: string, snapshots: PLSnapshotUpsertInput[]) {
    if (snapshots.length === 0) return
    const Model = await modelForOrg(orgId)
    const orgObjectId = new Types.ObjectId(orgId)
    const operations = snapshots.map((snapshot) => ({
      updateOne: {
        filter: { orgId: orgObjectId, provider, quarterStart: snapshot.quarterStart },
        update: { $set: { orgId: orgObjectId, provider, ...snapshot } },
        upsert: true
      }
    }))
    await Model.bulkWrite(operations, { ordered: false })
  },

  async findByQuarter(orgId: string | Types.ObjectId, provider: string, quarterStart: string) {
    const Model = await modelForOrg(orgId)
    return Model.findOne({ orgId, provider, quarterStart }).lean()
  },

  async findByQuarters(orgId: string | Types.ObjectId, provider: string, quarterStarts: string[]) {
    const Model = await modelForOrg(orgId)
    return Model.find({ orgId, provider, quarterStart: { $in: quarterStarts } }).lean()
  }
}
