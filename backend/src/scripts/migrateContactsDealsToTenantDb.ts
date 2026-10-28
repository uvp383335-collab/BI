import dotenv from 'dotenv'
import mongoose, { Types } from 'mongoose'
import { connectDatabase } from '../database/connection'
import { getTenantConnection, closeAllTenantConnections } from '../database/tenantConnection'
import { getContactModel } from '../modules/sync/model/Contact.model'
import { getDealModel } from '../modules/sync/model/Deal.model'

/**
 * One-off migration: moves Contact/Deal documents out of the shared
 * control-plane collections (`synccontacts`, `syncdeals` — the pre-refactor
 * home for these models, back when they lived on the default connection like
 * Organization/User) into each organization's own tenant database, alongside
 * Integration. Field names are normalized in the process: `hubspotId` ->
 * `providerRecordId`, `hubspotOwnerId` -> `ownerId`, matching the new
 * provider-agnostic schema in Contact.model.ts / Deal.model.ts.
 *
 * Safe to re-run: writes are upserts keyed on (orgId, provider,
 * providerRecordId), so re-running after a partial failure just re-upserts
 * the same documents.
 *
 * Usage:
 *   npm run migrate:crm-data            # copy only, old collections untouched
 *   npm run migrate:crm-data -- --drop  # copy, verify counts match, then drop old collections
 */

const DROP_OLD = process.argv.includes('--drop')

interface LegacyContact {
  orgId: Types.ObjectId
  provider: string
  hubspotId: string
  email?: string
  firstname?: string
  lastname?: string
  lifecycleStage?: string
  leadStatus?: string
}

interface LegacyDeal {
  orgId: Types.ObjectId
  provider: string
  hubspotId: string
  dealname?: string
  amount?: number
  closedate?: Date
  pipeline?: string
  dealstage?: string
  hubspotOwnerId?: string
  dealStageHistory: { value: string; timestamp: Date }[]
}

async function migrateOrg(orgId: Types.ObjectId, contacts: LegacyContact[], deals: LegacyDeal[]) {
  const connection = await getTenantConnection(orgId.toString())
  const ContactModel = getContactModel(connection)
  const DealModel = getDealModel(connection)

  if (contacts.length > 0) {
    await ContactModel.bulkWrite(
      contacts.map((contact) => ({
        updateOne: {
          filter: { orgId: contact.orgId, provider: contact.provider, providerRecordId: contact.hubspotId },
          update: {
            $set: {
              orgId: contact.orgId,
              provider: contact.provider,
              providerRecordId: contact.hubspotId,
              email: contact.email,
              firstname: contact.firstname,
              lastname: contact.lastname,
              lifecycleStage: contact.lifecycleStage,
              leadStatus: contact.leadStatus
            }
          },
          upsert: true
        }
      })),
      { ordered: false }
    )
  }

  if (deals.length > 0) {
    await DealModel.bulkWrite(
      deals.map((deal) => ({
        updateOne: {
          filter: { orgId: deal.orgId, provider: deal.provider, providerRecordId: deal.hubspotId },
          update: {
            $set: {
              orgId: deal.orgId,
              provider: deal.provider,
              providerRecordId: deal.hubspotId,
              dealname: deal.dealname,
              amount: deal.amount,
              closedate: deal.closedate,
              pipeline: deal.pipeline,
              dealstage: deal.dealstage,
              ownerId: deal.hubspotOwnerId,
              dealStageHistory: deal.dealStageHistory
            }
          },
          upsert: true
        }
      })),
      { ordered: false }
    )
  }

  const [tenantContactCount, tenantDealCount] = await Promise.all([
    ContactModel.countDocuments({ orgId }),
    DealModel.countDocuments({ orgId })
  ])

  return { tenantContactCount, tenantDealCount }
}

async function run() {
  dotenv.config()
  await connectDatabase()

  const db = mongoose.connection.db
  if (!db) throw new Error('Default database connection is not ready')

  const legacyContacts = db.collection<LegacyContact>('synccontacts')
  const legacyDeals = db.collection<LegacyDeal>('syncdeals')

  const orgIds = await legacyContacts.distinct('orgId')
  const dealOnlyOrgIds = await legacyDeals.distinct('orgId')
  for (const orgId of dealOnlyOrgIds) {
    if (!orgIds.some((id) => id.equals(orgId))) orgIds.push(orgId)
  }

  if (orgIds.length === 0) {
    // eslint-disable-next-line no-console
    console.log('No legacy contacts/deals found on the default connection. Nothing to migrate.')
    await closeAllTenantConnections()
    await mongoose.disconnect()
    return
  }

  // eslint-disable-next-line no-console
  console.log(`Found legacy CRM data for ${orgIds.length} organization(s). Migrating...`)

  let allCountsMatch = true

  for (const orgId of orgIds) {
    const [contacts, deals] = await Promise.all([
      legacyContacts.find({ orgId }).toArray(),
      legacyDeals.find({ orgId }).toArray()
    ])

    const { tenantContactCount, tenantDealCount } = await migrateOrg(orgId, contacts, deals)

    const contactsMatch = tenantContactCount >= contacts.length
    const dealsMatch = tenantDealCount >= deals.length
    if (!contactsMatch || !dealsMatch) allCountsMatch = false

    // eslint-disable-next-line no-console
    console.log(
      `org ${orgId}: contacts ${contacts.length} -> ${tenantContactCount}${contactsMatch ? '' : ' (MISMATCH)'}, ` +
        `deals ${deals.length} -> ${tenantDealCount}${dealsMatch ? '' : ' (MISMATCH)'}`
    )
  }

  if (DROP_OLD) {
    if (!allCountsMatch) {
      // eslint-disable-next-line no-console
      console.error('Refusing to drop legacy collections: at least one organization had a count mismatch above.')
    } else {
      await legacyContacts.drop().catch(() => {})
      await legacyDeals.drop().catch(() => {})
      // eslint-disable-next-line no-console
      console.log('Dropped legacy synccontacts/syncdeals collections from the default connection.')
    }
  } else {
    // eslint-disable-next-line no-console
    console.log('Old collections left in place. Re-run with --drop once you have verified the migrated data.')
  }

  await closeAllTenantConnections()
  await mongoose.disconnect()
}

run().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Migration failed:', err)
  process.exit(1)
})
