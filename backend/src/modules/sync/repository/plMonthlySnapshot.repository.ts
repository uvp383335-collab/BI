import { Connection, Types } from 'mongoose'
import { getPLMonthlySnapshotModel } from '../model/PLMonthlySnapshot.model'
import { PLLineItemDocument } from '../model/PLSnapshot.model'
import { getTenantConnection } from '../../../database/tenantConnection'

export interface PLMonthlySnapshotUpsertInput {
  month: string
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
  return getPLMonthlySnapshotModel(connection)
}

export const plMonthlySnapshotRepository = {
  async upsertMany(orgId: string | Types.ObjectId, provider: string, snapshots: PLMonthlySnapshotUpsertInput[]) {
    if (snapshots.length === 0) return
    const Model = await modelForOrg(orgId)
    const orgObjectId = new Types.ObjectId(orgId)
    const operations = snapshots.map((snapshot) => ({
      updateOne: {
        filter: { orgId: orgObjectId, provider, month: snapshot.month },
        update: { $set: { orgId: orgObjectId, provider, ...snapshot } },
        upsert: true
      }
    }))
    await Model.bulkWrite(operations, { ordered: false })
  },

  /** Every synced month's snapshot for a provider — G&A % of Revenue's Monthly/Yearly views read this directly rather than one month at a time. */
  async findAllForOrg(orgId: string | Types.ObjectId, provider: string) {
    const Model = await modelForOrg(orgId)
    return Model.find({ orgId, provider }, { month: 1, income: 1, expenses: 1, otherExpenses: 1, sectionTotals: 1 }).sort({ month: 1 }).lean()
  }
}
