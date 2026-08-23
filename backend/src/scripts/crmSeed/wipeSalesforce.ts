import axios from 'axios'
import { salesforceAuth, closeDb } from './auth'

const V = 'v65.0'

async function query<T>(instanceUrl: string, accessToken: string, soql: string): Promise<T[]> {
  const headers = { Authorization: `Bearer ${accessToken}` }
  const records: T[] = []
  let url: string | null = `${instanceUrl}/services/data/${V}/query`
  let params: Record<string, string> | undefined = { q: soql }
  while (url) {
    const res: { data: { records: T[]; nextRecordsUrl?: string; done: boolean } } = await axios.get(url, {
      headers,
      params
    })
    records.push(...res.data.records)
    if (res.data.nextRecordsUrl) {
      url = `${instanceUrl}${res.data.nextRecordsUrl}`
      params = undefined
    } else {
      url = null
    }
  }
  return records
}

async function deleteAll(instanceUrl: string, accessToken: string, sobject: string, ids: string[]): Promise<void> {
  if (ids.length === 0) return
  const headers = { Authorization: `Bearer ${accessToken}` }
  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200)
    const idsParam = chunk.join(',')
    try {
      await axios.delete(`${instanceUrl}/services/data/${V}/composite/sobjects`, {
        headers,
        params: { ids: idsParam, allOrNone: false }
      })
    } catch (e) {
      const err = e as { response?: { data: unknown } }
      console.log(`  ${sobject} batch delete had errors:`, JSON.stringify(err.response?.data).slice(0, 500))
    }
    console.log(`  deleted ${sobject} ${Math.min(i + 200, ids.length)}/${ids.length}`)
  }
}

async function main() {
  const { accessToken, instanceUrl } = await salesforceAuth()

  console.log('Deleting Salesforce Opportunities (cascades OpportunityCompetitor)...')
  const opps = await query<{ Id: string }>(instanceUrl, accessToken, 'SELECT Id FROM Opportunity')
  await deleteAll(instanceUrl, accessToken, 'Opportunity', opps.map((o) => o.Id))

  console.log('Deleting Salesforce Leads...')
  const leads = await query<{ Id: string }>(instanceUrl, accessToken, 'SELECT Id FROM Lead')
  await deleteAll(instanceUrl, accessToken, 'Lead', leads.map((l) => l.Id))

  console.log('Deleting Salesforce Accounts (children before parents)...')
  const accounts = await query<{ Id: string; ParentId: string | null }>(
    instanceUrl,
    accessToken,
    'SELECT Id, ParentId FROM Account'
  )
  const children = accounts.filter((a) => a.ParentId).map((a) => a.Id)
  const parents = accounts.filter((a) => !a.ParentId).map((a) => a.Id)
  await deleteAll(instanceUrl, accessToken, 'Account (children)', children)
  await deleteAll(instanceUrl, accessToken, 'Account (parents)', parents)

  console.log('Deleting Salesforce Campaigns...')
  const campaigns = await query<{ Id: string }>(instanceUrl, accessToken, 'SELECT Id FROM Campaign')
  await deleteAll(instanceUrl, accessToken, 'Campaign', campaigns.map((c) => c.Id))

  console.log('Salesforce wipe complete.')
  await closeDb()
}

main().catch((e) => {
  console.error('Salesforce wipe failed:', e.response?.data ?? e.message)
  process.exit(1)
})
