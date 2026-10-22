import { Connection, Types } from 'mongoose'
import { getSalesforceAccountModel } from '../model/SalesforceAccount.model'
import { getTenantConnection } from '../../../database/tenantConnection'

export interface SalesforceAccountUpsertInput {
  providerRecordId: string
  name?: string
  parentRecordId?: string
}

async function modelForOrg(orgId: string | Types.ObjectId) {
  const connection: Connection = await getTenantConnection(orgId.toString())
  return getSalesforceAccountModel(connection)
}

export const salesforceAccountRepository = {
  async count(orgId: string | Types.ObjectId, provider: string) {
    const Model = await modelForOrg(orgId)
    return Model.countDocuments({ orgId, provider })
  },

  async bulkUpsert(orgId: string | Types.ObjectId, provider: string, accounts: SalesforceAccountUpsertInput[]) {
    if (accounts.length === 0) return
    const Model = await modelForOrg(orgId)
    const orgObjectId = new Types.ObjectId(orgId)
    const operations = accounts.map((account) => ({
      updateOne: {
        filter: { orgId: orgObjectId, provider, providerRecordId: account.providerRecordId },
        update: { $set: { orgId: orgObjectId, provider, ...account } },
        upsert: true
      }
    }))
    await Model.bulkWrite(operations, { ordered: false })
  },

  async findAll(orgId: string | Types.ObjectId, provider: string) {
    const Model = await modelForOrg(orgId)
    return Model.find({ orgId, provider }).lean()
  }
}
