import axios from 'axios'
import { hubspotAuth, closeDb } from './auth'
import { CUSTOMERS, monthlyRevenue, isoDate, MONTH_COUNT } from './data'

const BASE = 'https://api.hubapi.com'
const OWNER_ID = '96152582'
const PIPELINE = 'default'
const STAGES = [
  'appointmentscheduled',
  'qualifiedtobuy',
  'presentationscheduled',
  'decisionmakerboughtin',
  'contractsent',
  'closedwon',
  'closedlost'
]
const MARKETING_SOURCES = ['ORGANIC_SEARCH', 'PAID_SEARCH', 'EMAIL_MARKETING', 'SOCIAL_MEDIA', 'PAID_SOCIAL']
const NON_MARKETING_SOURCES = ['DIRECT_TRAFFIC', 'REFERRALS', 'OTHER_CAMPAIGNS', 'OFFLINE']

function pick<T>(arr: T[], seed: number): T {
  return arr[seed % arr.length]
}

function slug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
    .slice(0, 20)
}

async function batchCreate(
  headers: Record<string, string>,
  objectType: 'contacts' | 'deals',
  inputs: { properties: Record<string, string> }[]
): Promise<string[]> {
  const ids: string[] = []
  for (let i = 0; i < inputs.length; i += 100) {
    const chunk = inputs.slice(i, i + 100)
    const res: { data: { results: { id: string }[] } } = await axios.post(
      `${BASE}/crm/v3/objects/${objectType}/batch/create`,
      { inputs: chunk },
      { headers }
    )
    ids.push(...res.data.results.map((r) => r.id))
    console.log(`  created ${objectType} ${Math.min(i + 100, inputs.length)}/${inputs.length}`)
  }
  return ids
}

async function main() {
  const { accessToken } = await hubspotAuth()
  const headers = { Authorization: `Bearer ${accessToken}` }

  const leadStatusProp = await axios.get(`${BASE}/crm/v3/properties/contacts/hs_lead_status`, { headers })
  const leadStatusOptions: string[] = leadStatusProp.data.options.map((o: { value: string }) => o.value)
  console.log('hs_lead_status options:', leadStatusOptions)

  const hubspotCustomers = CUSTOMERS.filter((c) => c.crmSource === 'hubspot')

  // --- Contacts: one real contact per HubSpot-sourced customer, plus funnel noise ---
  const contactInputs: { properties: Record<string, string> }[] = []
  const contactCustomerKey: (string | null)[] = []

  hubspotCustomers.forEach((c, i) => {
    const source = i % 2 === 0 ? pick(MARKETING_SOURCES, i) : pick(NON_MARKETING_SOURCES, i)
    contactInputs.push({
      properties: {
        email: `contact@${slug(c.name)}.example.com`,
        firstname: 'Jordan',
        lastname: c.name.split(' ')[0],
        lifecyclestage: 'customer',
        hs_lead_status: pick(leadStatusOptions, i),
        hs_analytics_source: source
      }
    })
    contactCustomerKey.push(c.key)
  })

  const NOISE_STAGES: [string, number][] = [
    ['subscriber', 30],
    ['lead', 38],
    ['marketingqualifiedlead', 24],
    ['salesqualifiedlead', 14],
    ['opportunity', 7],
    ['customer', 3]
  ]
  let noiseIdx = 0
  for (const [stage, count] of NOISE_STAGES) {
    for (let i = 0; i < count; i++) {
      const source = noiseIdx % 3 === 0 ? pick(NON_MARKETING_SOURCES, noiseIdx) : pick(MARKETING_SOURCES, noiseIdx)
      contactInputs.push({
        properties: {
          email: `lead${noiseIdx}@prospect-${slug(stage)}.example.com`,
          firstname: 'Prospect',
          lastname: `${stage}-${noiseIdx}`,
          lifecyclestage: stage,
          hs_lead_status: pick(leadStatusOptions, noiseIdx + 7),
          hs_analytics_source: source
        }
      })
      contactCustomerKey.push(null)
      noiseIdx++
    }
  }

  console.log(`Creating ${contactInputs.length} HubSpot contacts...`)
  const contactIds = await batchCreate(headers, 'contacts', contactInputs)

  const customerKeyToContactId = new Map<string, string>()
  contactIds.forEach((id, i) => {
    const key = contactCustomerKey[i]
    if (key) customerKeyToContactId.set(key, id)
  })

  // --- Deals: one real closed-won deal per HubSpot-sourced customer, plus pipeline noise ---
  const dealInputs: { properties: Record<string, string> }[] = []
  const dealCustomerKey: (string | null)[] = []

  hubspotCustomers.forEach((c) => {
    const startRevenue = monthlyRevenue(c, c.startMonth) || c.baseMrr
    dealInputs.push({
      properties: {
        dealname: `${c.name} - DriverInsights Platform`,
        amount: String(startRevenue * 12),
        closedate: isoDate(c.startMonth, 15),
        pipeline: PIPELINE,
        dealstage: 'closedwon',
        hubspot_owner_id: OWNER_ID
      }
    })
    dealCustomerKey.push(c.key)
  })

  const OPEN_STAGES = ['appointmentscheduled', 'qualifiedtobuy', 'presentationscheduled', 'decisionmakerboughtin', 'contractsent']
  const NOISE_DEAL_COUNT = 46
  for (let i = 0; i < NOISE_DEAL_COUNT; i++) {
    const isClosed = i % 3 === 0
    const isWon = isClosed && i % 6 === 0
    const stage = isClosed ? (isWon ? 'closedwon' : 'closedlost') : pick(OPEN_STAGES, i)
    // Open deals close in the next 1-3 months (pipeline coverage); closed ones spread across history.
    const closeMonthIdx = isClosed ? i % MONTH_COUNT : MONTH_COUNT - 1 + (i % 3) + 1
    dealInputs.push({
      properties: {
        dealname: `Prospect Deal ${i} - DriverInsights`,
        amount: String(800 + (i % 12) * 350),
        closedate: isoDate(Math.min(closeMonthIdx, MONTH_COUNT - 1), 10),
        pipeline: PIPELINE,
        dealstage: stage,
        hubspot_owner_id: OWNER_ID
      }
    })
    dealCustomerKey.push(null)
  }

  console.log(`Creating ${dealInputs.length} HubSpot deals...`)
  const dealIds = await batchCreate(headers, 'deals', dealInputs)

  // --- Associate each real deal to its customer's contact (default deal<->contact association) ---
  const associationInputs: { from: { id: string }; to: { id: string } }[] = []
  dealIds.forEach((dealId, i) => {
    const key = dealCustomerKey[i]
    if (!key) return
    const contactId = customerKeyToContactId.get(key)
    if (!contactId) return
    associationInputs.push({ from: { id: dealId }, to: { id: contactId } })
  })

  console.log(`Associating ${associationInputs.length} deals to contacts...`)
  for (let i = 0; i < associationInputs.length; i += 100) {
    const chunk = associationInputs.slice(i, i + 100)
    await axios.post(`${BASE}/crm/v4/associations/deals/contacts/batch/associate/default`, { inputs: chunk }, { headers })
  }

  console.log(`HubSpot seed complete: ${contactIds.length} contacts, ${dealIds.length} deals.`)
  await closeDb()
}

main().catch((e) => {
  console.error('HubSpot seed failed:', e.response?.data ?? e.message)
  process.exit(1)
})
