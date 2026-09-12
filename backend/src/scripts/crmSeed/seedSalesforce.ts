import { salesforceAuth, closeDb } from './auth'
import { makeSfClient } from './sfClient'
import { CUSTOMERS, monthlyRevenue, isoDate, MONTH_COUNT, COMPETITORS, customerByKey } from './data'

const OWNER_ID = '005jV0000002kErQAI' // Integration User — the only realistic non-system active user in this dev org
const LEAD_SOURCES = ['Web', 'Phone Inquiry', 'Partner Referral', 'Purchased List', 'Other']
const LEAD_STATUSES = ['Open - Not Contacted', 'Working - Contacted', 'Closed - Converted', 'Closed - Not Converted']

function pick<T>(arr: T[], seed: number): T {
  return arr[seed % arr.length]
}

async function main() {
  const { accessToken, instanceUrl } = await salesforceAuth()
  const sf = makeSfClient(accessToken, instanceUrl)

  const sfCustomers = CUSTOMERS.filter((c) => c.crmSource === 'salesforce')

  // --- Standard Price Book + its entries: this dev org already ships a
  // Product2 sample catalog (unlike HubSpot, which gets one created fresh
  // by the HubSpot seed script) — reused here rather than creating new
  // Product2 records, since OpportunityLineItem needs a PricebookEntryId,
  // not a bare Product2Id. Degrades to no line items (not a hard failure)
  // if the org has no active standard-pricebook entries.
  console.log('Looking up Standard Price Book entries...')
  const [standardPricebook] = await sf.query<{ Id: string }>('SELECT Id FROM Pricebook2 WHERE IsStandard = true LIMIT 1')
  const priceBookEntries = standardPricebook
    ? await sf.query<{ Id: string; Product2Id: string; UnitPrice: number }>(
        `SELECT Id, Product2Id, UnitPrice FROM PricebookEntry WHERE Pricebook2Id = '${standardPricebook.Id}' AND IsActive = true`
      )
    : []
  console.log(`  found ${priceBookEntries.length} active Standard Price Book entries`)

  // --- Campaigns ---
  console.log('Creating Campaigns...')
  const campaignDefs = [
    { Name: 'Q3 Webinar Series', Type: 'Webinar', IsActive: true, BudgetedCost: 12000, ActualCost: 11200, StartDate: isoDate(2), EndDate: isoDate(3) },
    { Name: 'Enterprise Outbound ABM', Type: 'Advertisement', IsActive: true, BudgetedCost: 40000, ActualCost: 38500, StartDate: isoDate(0), EndDate: isoDate(13) },
    { Name: 'Industry Conference 2026', Type: 'Conference', IsActive: true, BudgetedCost: 25000, ActualCost: 26800, StartDate: isoDate(9), EndDate: isoDate(9) }
  ]
  const campaignResults = await sf.createMany('Campaign', campaignDefs)
  const campaignIds = campaignResults.map((r) => r.id).filter((id): id is string => !!id)
  console.log(`  created ${campaignIds.length}/${campaignDefs.length}`)

  // --- Accounts: parents first, then children (need parent Id for ParentId) ---
  console.log('Creating parent Accounts...')
  const parentCustomers = sfCustomers.filter((c) => !c.parentKey)
  const parentResults = await sf.createMany(
    'Account',
    parentCustomers.map((c) => ({ Name: c.name, Industry: 'Transportation', Type: 'Customer' }))
  )
  const accountIdByKey = new Map<string, string>()
  parentCustomers.forEach((c, i) => {
    const id = parentResults[i]?.id
    if (id) accountIdByKey.set(c.key, id)
    else console.log(`  FAILED account for ${c.name}:`, JSON.stringify(parentResults[i]?.errors))
  })

  console.log('Creating child (subsidiary) Accounts...')
  const childCustomers = sfCustomers.filter((c) => c.parentKey)
  const childResults = await sf.createMany(
    'Account',
    childCustomers.map((c) => ({
      Name: c.name,
      Industry: 'Transportation',
      Type: 'Customer',
      ParentId: accountIdByKey.get(c.parentKey!)
    }))
  )
  childCustomers.forEach((c, i) => {
    const id = childResults[i]?.id
    if (id) accountIdByKey.set(c.key, id)
    else console.log(`  FAILED account for ${c.name}:`, JSON.stringify(childResults[i]?.errors))
  })
  console.log(`  ${accountIdByKey.size}/${sfCustomers.length} accounts created`)

  // --- Opportunities: one origin opportunity per customer, plus a churn-dated one for churned customers ---
  interface OppDef {
    Name: string
    AccountId: string
    Amount: number
    CloseDate: string
    StageName: string
    OwnerId: string
    Type: string
    LeadSource: string
    CampaignId?: string
    Description?: string
    customerKey: string
    wantCompetitor: boolean
  }
  const oppDefs: OppDef[] = []

  sfCustomers.forEach((c, i) => {
    const accountId = accountIdByKey.get(c.key)
    if (!accountId) return
    const originRevenue = monthlyRevenue(c, c.startMonth) || c.baseMrr
    oppDefs.push({
      Name: `${c.name} - DriverInsights Platform`,
      AccountId: accountId,
      Amount: originRevenue * 12,
      CloseDate: isoDate(c.startMonth, 15),
      StageName: 'Closed Won',
      OwnerId: OWNER_ID,
      Type: 'New Customer',
      LeadSource: pick(LEAD_SOURCES, i),
      CampaignId: i % 2 === 0 ? pick(campaignIds, i) : undefined,
      customerKey: c.key,
      wantCompetitor: !!c.competitive
    })

    if (c.trajectory === 'churn' && c.churnMonth !== undefined) {
      oppDefs.push({
        Name: `${c.name} - Contract Non-Renewal`,
        AccountId: accountId,
        Amount: 0,
        CloseDate: isoDate(c.churnMonth, 20),
        StageName: 'Closed Lost',
        OwnerId: OWNER_ID,
        // This org's Type picklist has no explicit "Churn" value — nearest available proxy used.
        // See crm-seed summary: VC-01's Salesforce "why" enrichment is approximate here, not exact.
        Type: 'Existing Customer - Downgrade',
        LeadSource: pick(LEAD_SOURCES, i + 3),
        Description: 'Customer churned - contract not renewed.',
        customerKey: c.key,
        wantCompetitor: !!c.competitive
      })
    }
  })

  // --- Noise opportunities: open pipeline (future close dates) + closed win/loss mix ---
  const accountIds = Array.from(accountIdByKey.values())
  const OPEN_STAGES = ['Prospecting', 'Qualification', 'Needs Analysis', 'Value Proposition', 'Id. Decision Makers', 'Perception Analysis', 'Proposal/Price Quote', 'Negotiation/Review']
  const NOISE_COUNT = 26
  for (let i = 0; i < NOISE_COUNT; i++) {
    const accountId = pick(accountIds, i)
    const isOpen = i % 2 === 0
    const isWon = !isOpen && i % 4 !== 1
    oppDefs.push({
      Name: `Pipeline Opportunity ${i}`,
      AccountId: accountId,
      Amount: 3000 + (i % 10) * 900,
      CloseDate: isOpen ? isoDate(MONTH_COUNT - 1, 20 + (i % 3)) : isoDate(i % MONTH_COUNT, 12),
      StageName: isOpen ? pick(OPEN_STAGES, i) : isWon ? 'Closed Won' : 'Closed Lost',
      OwnerId: OWNER_ID,
      Type: i % 3 === 0 ? 'Existing Customer - Upgrade' : 'New Customer',
      LeadSource: pick(LEAD_SOURCES, i + 1),
      CampaignId: i % 3 === 0 ? pick(campaignIds, i) : undefined,
      customerKey: '',
      wantCompetitor: !isOpen && i % 3 === 0
    })
  }
  // Bump the open-pipeline share of noise so CM-04 coverage has real amounts to sum.
  for (let i = 0; i < 10; i++) {
    const accountId = pick(accountIds, i + 5)
    oppDefs.push({
      Name: `Open Pipeline Deal ${i}`,
      AccountId: accountId,
      Amount: 5000 + (i % 6) * 1500,
      CloseDate: isoDate(MONTH_COUNT - 1, 22 + (i % 5)),
      StageName: pick(OPEN_STAGES, i + 2),
      OwnerId: OWNER_ID,
      Type: 'New Customer',
      LeadSource: pick(LEAD_SOURCES, i + 2),
      CampaignId: pick(campaignIds, i),
      customerKey: '',
      wantCompetitor: false
    })
  }

  console.log(`Creating ${oppDefs.length} Opportunities...`)
  const oppResults = await sf.createMany(
    'Opportunity',
    oppDefs.map((o) => ({
      Name: o.Name,
      AccountId: o.AccountId,
      Amount: o.Amount,
      CloseDate: o.CloseDate,
      StageName: o.StageName,
      OwnerId: o.OwnerId,
      Type: o.Type,
      LeadSource: o.LeadSource,
      ...(o.CampaignId ? { CampaignId: o.CampaignId } : {}),
      ...(o.Description ? { Description: o.Description } : {}),
      ...(standardPricebook ? { Pricebook2Id: standardPricebook.Id } : {})
    }))
  )
  const oppFailures = oppResults.filter((r) => !r.success)
  console.log(`  created ${oppResults.length - oppFailures.length}/${oppDefs.length}`)
  if (oppFailures.length) console.log('  sample failure:', JSON.stringify(oppFailures[0].errors))

  // --- OpportunityCompetitor for competitive deals ---
  const competitorRecords: { OpportunityId: string; CompetitorName: string }[] = []
  oppDefs.forEach((o, i) => {
    if (!o.wantCompetitor) return
    const oppId = oppResults[i]?.id
    if (!oppId) return
    competitorRecords.push({ OpportunityId: oppId, CompetitorName: pick(COMPETITORS, i) })
  })
  console.log(`Creating ${competitorRecords.length} OpportunityCompetitor records...`)
  const compResults = await sf.createMany('OpportunityCompetitor', competitorRecords)
  console.log(`  created ${compResults.filter((r) => r.success).length}/${competitorRecords.length}`)

  // --- OpportunityLineItem: gives the funnel product filter something to filter by ---
  let lineItemResults: { success: boolean }[] = []
  if (priceBookEntries.length > 0) {
    const pickEntry = (seed: number) => priceBookEntries[seed % priceBookEntries.length]
    const lineItemRecords: { OpportunityId: string; PricebookEntryId: string; Quantity: number; UnitPrice: number }[] = []
    oppDefs.forEach((o, i) => {
      const oppId = oppResults[i]?.id
      if (!oppId) return
      // The origin "DriverInsights Platform" opportunity per customer, plus
      // roughly half the noise pipeline, carries a line item; expansion
      // customers get a second one — same real-vs-noise, single-vs-multi
      // split as the HubSpot seed script, so both providers exercise the
      // filter the same way.
      const isOriginDeal = o.Name.endsWith('DriverInsights Platform')
      if (!isOriginDeal && i % 2 !== 0) return
      const entry = pickEntry(i)
      lineItemRecords.push({ OpportunityId: oppId, PricebookEntryId: entry.Id, Quantity: 1, UnitPrice: entry.UnitPrice ?? 1000 })
      const customer = o.customerKey ? customerByKey(o.customerKey) : undefined
      if (customer?.trajectory === 'expansion') {
        const addOnEntry = pickEntry(i + 7)
        lineItemRecords.push({ OpportunityId: oppId, PricebookEntryId: addOnEntry.Id, Quantity: 1, UnitPrice: addOnEntry.UnitPrice ?? 500 })
      }
    })
    console.log(`Creating ${lineItemRecords.length} OpportunityLineItems...`)
    lineItemResults = await sf.createMany('OpportunityLineItem', lineItemRecords)
    console.log(`  created ${lineItemResults.filter((r) => r.success).length}/${lineItemRecords.length}`)
  } else {
    console.log('Skipping OpportunityLineItem creation — no active Standard Price Book entries found.')
  }

  // --- Leads: generic top-of-funnel noise, not tied to specific customers ---
  const LEAD_COUNT = 40
  const leadRecords = Array.from({ length: LEAD_COUNT }, (_, i) => ({
    FirstName: 'Lead',
    LastName: `Prospect${i}`,
    Company: `Prospect Fleet Co ${i}`,
    Email: `lead${i}@prospect-fleet.example.com`,
    Status: i % 10 < 4 ? LEAD_STATUSES[0] : i % 10 < 7 ? LEAD_STATUSES[1] : i % 10 < 8.5 ? LEAD_STATUSES[2] : LEAD_STATUSES[3],
    LeadSource: pick(LEAD_SOURCES, i)
  }))
  console.log(`Creating ${leadRecords.length} Leads...`)
  const leadResults = await sf.createMany('Lead', leadRecords)
  console.log(`  created ${leadResults.filter((r) => r.success).length}/${leadRecords.length}`)

  console.log(
    `Salesforce seed complete: ${campaignIds.length} campaigns, ${accountIdByKey.size} accounts, ` +
      `${oppResults.length - oppFailures.length} opportunities, ${compResults.filter((r) => r.success).length} competitor rows, ` +
      `${lineItemResults.filter((r) => r.success).length} line items, ${leadResults.filter((r) => r.success).length} leads.`
  )
  await closeDb()
}

main().catch((e) => {
  console.error('Salesforce seed failed:', e.response?.data ?? e.message)
  process.exit(1)
})
