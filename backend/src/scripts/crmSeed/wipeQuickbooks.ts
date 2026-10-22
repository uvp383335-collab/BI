import { quickbooksAuth, closeDb } from './auth'
import { makeQbClient, QbEntityRef } from './qbClient'

async function deleteEntities(qb: ReturnType<typeof makeQbClient>, entityType: string, records: QbEntityRef[]) {
  if (records.length === 0) {
    console.log(`  ${entityType}: none to delete`)
    return
  }
  const ops = records.map((r, i) => ({
    bId: `${entityType}${i}`,
    operation: 'delete' as const,
    entityType,
    entity: { Id: r.Id, SyncToken: r.SyncToken }
  }))
  const results = await qb.batch(ops)
  const failed = results.filter((r) => !r.ok)
  console.log(`  ${entityType}: deleted ${results.length - failed.length}/${records.length}`)
  if (failed.length) console.log(`    ${failed.length} failures, e.g.`, JSON.stringify(failed[0].error).slice(0, 300))
}

async function deactivateEntities(qb: ReturnType<typeof makeQbClient>, entityType: string, records: QbEntityRef[]) {
  if (records.length === 0) {
    console.log(`  ${entityType}: none to deactivate`)
    return
  }
  const ops = records.map((r, i) => ({
    bId: `${entityType}${i}`,
    operation: 'update' as const,
    entityType,
    entity: { Id: r.Id, SyncToken: r.SyncToken, sparse: true, Active: false }
  }))
  const results = await qb.batch(ops)
  const failed = results.filter((r) => !r.ok)
  console.log(`  ${entityType}: deactivated ${results.length - failed.length}/${records.length}`)
  if (failed.length) console.log(`    ${failed.length} failures, e.g.`, JSON.stringify(failed[0].error).slice(0, 300))
}

async function main() {
  const { accessToken, realmId } = await quickbooksAuth()
  const qb = makeQbClient(accessToken, realmId)

  console.log('Wiping QuickBooks transactions...')
  for (const entity of ['Payment', 'BillPayment', 'Invoice', 'Bill', 'JournalEntry']) {
    const records = await qb.query<QbEntityRef>(entity)
    await deleteEntities(qb, entity, records)
  }

  console.log('Deactivating QuickBooks list entities (Customer/Vendor/Item/Class cannot be hard-deleted once used)...')
  for (const entity of ['Customer', 'Vendor', 'Item', 'Class']) {
    const records = await qb.query<QbEntityRef>(entity, 'Active = true')
    await deactivateEntities(qb, entity, records)
  }

  console.log('QuickBooks wipe complete.')
  await closeDb()
}

main().catch((e) => {
  console.error('QuickBooks wipe failed:', e.response?.data ?? e.message)
  process.exit(1)
})
