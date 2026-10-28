import { Connection, Types } from 'mongoose'
import { getQuickBooksCustomerModel } from '../model/QuickBooksCustomer.model'
import { getTenantConnection } from '../../../database/tenantConnection'

export interface QuickBooksCustomerUpsertInput {
  providerRecordId: string
  displayName?: string
  parentRecordId?: string
  active: boolean
}

async function modelForOrg(orgId: string | Types.ObjectId) {
  const connection: Connection = await getTenantConnection(orgId.toString())
  return getQuickBooksCustomerModel(connection)
}

export const quickBooksCustomerRepository = {
  async count(orgId: string | Types.ObjectId, provider: string) {
    const Model = await modelForOrg(orgId)
    return Model.countDocuments({ orgId, provider })
  },

  async bulkUpsert(orgId: string | Types.ObjectId, provider: string, customers: QuickBooksCustomerUpsertInput[]) {
    if (customers.length === 0) return
    const Model = await modelForOrg(orgId)
    const orgObjectId = new Types.ObjectId(orgId)
    const operations = customers.map((customer) => ({
      updateOne: {
        filter: { orgId: orgObjectId, provider, providerRecordId: customer.providerRecordId },
        update: { $set: { orgId: orgObjectId, provider, ...customer } },
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
