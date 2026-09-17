import { Connection, Types } from 'mongoose'
import { getPLItemSnapshotModel } from '../model/PLItemSnapshot.model'
import { PLLineItemDocument } from '../model/PLSnapshot.model'
import { getTenantConnection } from '../../../database/tenantConnection'

export interface PLItemSnapshotUpsertInput {
  itemId: string
  quarterStart: string
  startDate: string
  endDate: string
  columns: string[]
  income: PLLineItemDocument[]
  cogs: PLLineItemDocument[]
  expenses: PLLineItemDocument[]
  otherExpenses: PLLineItemDocument[]
  sectionTotals: Record<string, Record<string, number>>
  fetchedAt: Date
}

async function modelForOrg(orgId: string | Types.ObjectId) {
  const connection: Connection = await getTenantConnection(orgId.toString())
  return getPLItemSnapshotModel(connection)
}

export const plItemSnapshotRepository = {
  async upsertMany(orgId: string | Types.ObjectId, provider: string, snapshots: PLItemSnapshotUpsertInput[]) {
    if (snapshots.length === 0) return
    const Model = await modelForOrg(orgId)
    const orgObjectId = new Types.ObjectId(orgId)
    const operations = snapshots.map((snapshot) => ({
      updateOne: {
        filter: { orgId: orgObjectId, provider, quarterStart: snapshot.quarterStart, itemId: snapshot.itemId },
        update: { $set: { orgId: orgObjectId, provider, ...snapshot } },
        upsert: true
      }
    }))
    await Model.bulkWrite(operations, { ordered: false })
  },

  async findByQuarterAndItem(orgId: string | Types.ObjectId, provider: string, quarterStart: string, itemId: string) {
    const Model = await modelForOrg(orgId)
    return Model.findOne({ orgId, provider, quarterStart, itemId }).lean()
  }
}
