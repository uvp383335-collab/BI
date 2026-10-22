import { Connection, Types } from 'mongoose'
import { getContactModel } from '../model/Contact.model'
import { getTenantConnection } from '../../../database/tenantConnection'

export interface ContactUpsertInput {
  providerRecordId: string
  email?: string
  firstname?: string
  lastname?: string
  lifecycleStage?: string
  leadStatus?: string
  analyticsSource?: string
  lifecycleStageHistory: { value: string; timestamp: Date }[]
}

/** Resolves the Contact model bound to the given org's own tenant database. */
async function modelForOrg(orgId: string | Types.ObjectId) {
  const connection: Connection = await getTenantConnection(orgId.toString())
  return getContactModel(connection)
}

export const contactRepository = {
  async count(orgId: string | Types.ObjectId, provider: string) {
    const ContactModel = await modelForOrg(orgId)
    return ContactModel.countDocuments({ orgId, provider })
  },

  async bulkUpsert(orgId: string | Types.ObjectId, provider: string, contacts: ContactUpsertInput[]) {
    if (contacts.length === 0) return
    const ContactModel = await modelForOrg(orgId)
    const orgObjectId = new Types.ObjectId(orgId)
    const operations = contacts.map((contact) => ({
      updateOne: {
        filter: { orgId: orgObjectId, provider, providerRecordId: contact.providerRecordId },
        update: { $set: { orgId: orgObjectId, provider, ...contact } },
        upsert: true
      }
    }))
    await ContactModel.bulkWrite(operations, { ordered: false })
  },

  /** Just id + original-source per contact — CM-05/CM-07's channel-attribution join key. */
  async findSourcesByProvider(orgId: string | Types.ObjectId, provider: string) {
    const ContactModel = await modelForOrg(orgId)
    return ContactModel.find({ orgId, provider }, { providerRecordId: 1, analyticsSource: 1 }).lean()
  }
}
