import { ORG_ID, ensureDb, closeDb } from './auth'
import { getTenantConnection } from '../../database/tenantConnection'
import { integrationsRepository } from '../../modules/integrations/repository/integrations.repository'

/**
 * After wiping + reseeding the 3 external CRMs directly, the app's own tenant
 * DB still holds the old synced Contact/Deal rows and derived funnel data —
 * clear those local caches and reset lastSyncedAt so the next sync for each
 * provider is a full sync against the new CRM data, not an incremental one
 * that would leave stale rows mixed in.
 */
async function main() {
  await ensureDb()
  const connection = await getTenantConnection(ORG_ID)
  const db = connection.db
  if (!db) throw new Error('tenant db not ready')

  for (const collection of ['contacts', 'deals', 'funnelstageevents', 'pipelinestagedefinitions']) {
    const result = await db.collection(collection).deleteMany({})
    console.log(`cleared ${collection}: ${result.deletedCount} docs`)
  }

  for (const provider of ['hubspot', 'salesforce', 'quickbooks'] as const) {
    await integrationsRepository.updateLastSyncedAt(ORG_ID, provider, null as unknown as Date)
    console.log(`reset lastSyncedAt for ${provider}`)
  }

  await closeDb()
}

main().catch((e) => {
  console.error('reset failed', e)
  process.exit(1)
})
