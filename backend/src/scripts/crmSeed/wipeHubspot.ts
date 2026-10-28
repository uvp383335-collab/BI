import axios from 'axios'
import { hubspotAuth, closeDb } from './auth'

const BASE = 'https://api.hubapi.com'

async function listAllIds(accessToken: string, objectType: 'contacts' | 'deals' | 'line_items' | 'products'): Promise<string[]> {
  const headers = { Authorization: `Bearer ${accessToken}` }
  const ids: string[] = []
  let after: string | undefined
  do {
    const res: { data: { results: { id: string }[]; paging?: { next?: { after: string } } } } = await axios.get(
      `${BASE}/crm/v3/objects/${objectType}`,
      { headers, params: { limit: 100, after } }
    )
    ids.push(...res.data.results.map((r) => r.id))
    after = res.data.paging?.next?.after
  } while (after)
  return ids
}

async function batchArchive(accessToken: string, objectType: 'contacts' | 'deals' | 'line_items' | 'products', ids: string[]): Promise<void> {
  const headers = { Authorization: `Bearer ${accessToken}` }
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100)
    await axios.post(
      `${BASE}/crm/v3/objects/${objectType}/batch/archive`,
      { inputs: chunk.map((id) => ({ id })) },
      { headers }
    )
    console.log(`  archived ${objectType} ${Math.min(i + 100, ids.length)}/${ids.length}`)
  }
}

async function main() {
  const { accessToken } = await hubspotAuth()

  // Line items first — they're independent records, not cascade-archived
  // when their associated deal is archived (unlike Salesforce's Opportunity
  // -> OpportunityLineItem master-detail cascade).
  console.log('Listing HubSpot line items...')
  const lineItemIds = await listAllIds(accessToken, 'line_items')
  console.log(`Found ${lineItemIds.length} line items. Archiving...`)
  await batchArchive(accessToken, 'line_items', lineItemIds)

  console.log('Listing HubSpot products...')
  const productIds = await listAllIds(accessToken, 'products')
  console.log(`Found ${productIds.length} products. Archiving...`)
  await batchArchive(accessToken, 'products', productIds)

  console.log('Listing HubSpot deals...')
  const dealIds = await listAllIds(accessToken, 'deals')
  console.log(`Found ${dealIds.length} deals. Archiving...`)
  await batchArchive(accessToken, 'deals', dealIds)

  console.log('Listing HubSpot contacts...')
  const contactIds = await listAllIds(accessToken, 'contacts')
  console.log(`Found ${contactIds.length} contacts. Archiving...`)
  await batchArchive(accessToken, 'contacts', contactIds)

  console.log('HubSpot wipe complete.')
  await closeDb()
}

main().catch((e) => {
  console.error('HubSpot wipe failed:', e.response?.data ?? e.message)
  process.exit(1)
})
