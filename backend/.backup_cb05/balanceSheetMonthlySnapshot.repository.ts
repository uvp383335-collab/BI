import { Connection, Types } from 'mongoose'
import { getBalanceSheetMonthlySnapshotModel } from '../model/BalanceSheetMonthlySnapshot.model'
import { getTenantConnection } from '../../../database/tenantConnection'

export interface BalanceSheetMonthlySnapshotUpsertInput {
  month: string
  asOfDate: string
  sectionTotals: Record<string, Record<string, number>>
  fetchedAt: Date
}

async function modelForOrg(orgId: string | Types.ObjectId) {
  const connection: Connection = await getTenantConnection(orgId.toString())
  return getBalanceSheetMonthlySnapshotModel(connection)
}

export const balanceSheetMonthlySnapshotRepository = {
  async upsertMany(orgId: string | Types.ObjectId, provider: string, snapshots: BalanceSheetMonthlySnapshotUpsertInput[]) {
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

  /** Every synced month's snapshot for a provider — month-grain Balance Sheet trends read this directly rather than one month at a time. */
  async findAllForOrg(orgId: string | Types.ObjectId, provider: string) {
    const Model = await modelForOrg(orgId)
    return Model.find({ orgId, provider }, { month: 1, asOfDate: 1, sectionTotals: 1 }).sort({ month: 1 }).lean()
  }
}
