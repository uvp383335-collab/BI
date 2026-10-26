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
  salesforceObject?: 'Lead' | 'Contact'
  accountRecordId?: string
  convertedContactRecordId?: string
  lifecycleStageHistory: { value: string; timestamp: Date }[]
}

/** Resolves the Contact model bound to the given org's own tenant database. */
async function modelForOrg(orgId: string | Types.ObjectId) {
  const connection: Connection = await getTenantConnection(orgId.toString())
  return getContactModel(connection)
}

export const contactRepository = {
  /**
   * Lead-entity count: every HubSpot contact, Salesforce Leads only. Salesforce
   * Contact rows are left out — they'd double-count converted leads in the
   * funnel's Total Leads.
   */
  async count(orgId: string | Types.ObjectId, provider: string) {
    const ContactModel = await modelForOrg(orgId)
    return ContactModel.countDocuments({ orgId, provider, salesforceObject: { $ne: 'Contact' } })
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

  /** Salesforce Contact-object rows (not Leads) for the dashboard's Contacts browse table, paginated, most-recently-synced first. */
  async findSalesforceContactsPaginated(
    orgId: string | Types.ObjectId,
    provider: string,
    opts: { page?: number; pageSize?: number } = {}
  ) {
    const ContactModel = await modelForOrg(orgId)
    const page = Math.max(1, opts.page ?? 1)
    const pageSize = Math.max(1, Math.min(100, opts.pageSize ?? 20))
    const filter = { orgId, provider, salesforceObject: 'Contact' as const }

    const [items, total] = await Promise.all([
      ContactModel.find(filter, { providerRecordId: 1, email: 1, firstname: 1, lastname: 1, accountRecordId: 1 })
        .sort({ createdAt: -1 })
        .skip((page - 1) * pageSize)
        .limit(pageSize)
        .lean(),
      ContactModel.countDocuments(filter)
    ])

    return { items, total, page, pageSize }
  },

  /** Just id + original-source per contact — CM-05/CM-07's channel-attribution join key. */
  async findSourcesByProvider(orgId: string | Types.ObjectId, provider: string) {
    const ContactModel = await modelForOrg(orgId)
    return ContactModel.find({ orgId, provider }, { providerRecordId: 1, analyticsSource: 1 }).lean()
  }
}
