import { quickbooksAuth, closeDb } from './auth'
import { makeQbClient } from './qbClient'

async function main() {
  const { accessToken, realmId } = await quickbooksAuth()
  const qb = makeQbClient(accessToken, realmId)
  for (const entity of ['Customer', 'Invoice', 'Payment', 'Bill', 'BillPayment', 'JournalEntry', 'Class', 'Item', 'Vendor', 'Account']) {
    const where = ['Customer', 'Vendor', 'Item', 'Class'].includes(entity) ? 'Active = true' : ''
    const records = await qb.query(entity, where)
    console.log(`QuickBooks -> ${entity}: ${records.length}`)
  }
  await closeDb()
}

main().catch((e) => {
  console.error('verify failed', e.response?.data ?? e.message)
  process.exit(1)
})
