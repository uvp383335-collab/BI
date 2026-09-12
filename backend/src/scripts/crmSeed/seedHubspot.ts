import axios from 'axios'
import { hubspotAuth, closeDb } from './auth'
import { CUSTOMERS, monthlyRevenue, isoDate, MONTH_COUNT, HUBSPOT_PRODUCTS, customerByKey } from './data'

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
  objectType: 'contacts' | 'deals' | 'products' | 'line_items',
  inputs: { properties: Record<string, string> }[]
): Promise<string[]> {
  const ids: string[] = []
  for (let i = 0; i < inputs.length; i += 100) {
    const chunk = inputs.slice(i, i + 100)
    const res: { data: { results: { id: string }[]; numErrors?: number; errors?: { message: string }[] } } = await axios.post(
      `${BASE}/crm/v3/objects/${objectType}/batch/create`,
      { inputs: chunk },
      { headers }
    )
    ids.push(...res.data.results.map((r) => r.id))
    // A 207 multi-status response only puts successes in `results` — surface
    // the rest so a partial failure isn't silently swallowed (previously the
    // only symptom was a smaller-than-expected count in the summary line).
    if (res.data.errors?.length) {
      console.log(`  ${res.data.errors.length} ${objectType} failed, e.g.: ${res.data.errors[0].message}`)
    }
    console.log(`  created ${objectType} ${ids.length}/${inputs.length}`)
  }
  return ids
}

/** Default-associates a batch of (from, to) id pairs via the v4 batch/associate/default endpoint — same shape for deals<->contacts and line_items<->deals. */
async function associateDefault(
  headers: Record<string, string>,
  fromType: string,
  toType: string,
  pairs: { from: string; to: string }[]
): Promise<void> {
  for (let i = 0; i < pairs.length; i += 100) {
    const chunk = pairs.slice(i, i + 100).map((p) => ({ from: { id: p.from }, to: { id: p.to } }))
    await axios.post(`${BASE}/crm/v4/associations/${fromType}/${toType}/batch/associate/default`, { inputs: chunk }, { headers })
  }
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
  await associateDefault(
    headers,
    'deals',
    'contacts',
    associationInputs.map((a) => ({ from: a.from.id, to: a.to.id }))
  )

  // --- Products + line items: gives the funnel product filter something to filter by ---
  console.log(`Creating ${HUBSPOT_PRODUCTS.length} HubSpot products...`)
  const productIds = await batchCreate(
    headers,
    'products',
    HUBSPOT_PRODUCTS.map((name) => ({ properties: { name } }))
  )
  const productIdByName = new Map(HUBSPOT_PRODUCTS.map((name, i) => [name, productIds[i]]))
  const platformProductId = productIdByName.get('DriverInsights Platform')!
  const hardwareProductId = productIdByName.get('GPS Hardware Kit')!

  const lineItemInputs: { properties: Record<string, string> }[] = []
  const lineItemDealId: string[] = []
  dealIds.forEach((dealId, i) => {
    const key = dealCustomerKey[i]
    const amount = dealInputs[i].properties.amount
    if (key) {
      // Every real customer deal carries the core platform line item; expansion
      // customers also bought the hardware kit — gives the filter more than
      // one bucket to differentiate real deals by.
      lineItemInputs.push({ properties: { name: 'DriverInsights Platform', hs_product_id: platformProductId, quantity: '1', price: amount } })
      lineItemDealId.push(dealId)
      if (customerByKey(key).trajectory === 'expansion') {
        lineItemInputs.push({ properties: { name: 'GPS Hardware Kit', hs_product_id: hardwareProductId, quantity: '1', price: '1200' } })
        lineItemDealId.push(dealId)
      }
    } else if (i % 2 === 0) {
      // Noise deals: roughly half carry a line item, alternating product, so
      // the filter has pipeline-stage variety too, not just closed-won deals.
      const name = i % 4 === 0 ? 'DriverInsights Platform' : 'GPS Hardware Kit'
      lineItemInputs.push({
        properties: { name, hs_product_id: name === 'DriverInsights Platform' ? platformProductId : hardwareProductId, quantity: '1', price: amount }
      })
      lineItemDealId.push(dealId)
    }
  })

  console.log(`Creating ${lineItemInputs.length} HubSpot line items...`)
  const lineItemIds = await batchCreate(headers, 'line_items', lineItemInputs)

  console.log(`Associating ${lineItemIds.length} line items to deals...`)
  await associateDefault(
    headers,
    'line_items',
    'deals',
    lineItemIds.map((lineItemId, i) => ({ from: lineItemId, to: lineItemDealId[i] }))
  )

  console.log(
    `HubSpot seed complete: ${contactIds.length} contacts, ${dealIds.length} deals, ${productIds.length} products, ${lineItemIds.length} line items.`
  )
  await closeDb()
}

main().catch((e) => {
  console.error('HubSpot seed failed:', e.response?.data ?? e.message)
  process.exit(1)
})
