import { ContactModel } from '../model/Contact.model'
import { Types } from 'mongoose'

export interface ContactUpsertInput {
  hubspotId: string
  email?: string
  firstname?: string
  lastname?: string
  lifecycleStage?: string
  leadStatus?: string
}

export const contactRepository = {
  count(orgId: string | Types.ObjectId, provider: string) {
    return ContactModel.countDocuments({ orgId, provider })
  },

  async bulkUpsert(orgId: string | Types.ObjectId, provider: string, contacts: ContactUpsertInput[]) {
    if (contacts.length === 0) return
    const orgObjectId = new Types.ObjectId(orgId)
    const operations = contacts.map((contact) => ({
      updateOne: {
        filter: { orgId: orgObjectId, provider, hubspotId: contact.hubspotId },
        update: { $set: { orgId: orgObjectId, provider, ...contact } },
        upsert: true
      }
    }))
    await ContactModel.bulkWrite(operations, { ordered: false })
  }
}
