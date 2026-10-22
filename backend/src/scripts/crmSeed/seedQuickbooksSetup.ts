import { quickbooksAuth, closeDb } from './auth'
import { makeQbClient } from './qbClient'
import { isoDate } from './data'

/**
 * Phase 1 of the QuickBooks seed: chart-of-accounts additions, Classes (product
 * lines, for VC-04 COGS mix), Items, and Vendors. Split out from the
 * transaction-heavy phase (seedQuickbooksTransactions.ts) so account/subtype
 * validation errors are cheap to iterate on.
 */

const ACCOUNTS = [
  { Name: 'Subscription Revenue', AccountType: 'Income', AccountSubType: 'ServiceFeeIncome' },
  { Name: 'Professional Services Revenue', AccountType: 'Income', AccountSubType: 'ServiceFeeIncome' },
  { Name: 'Hardware Revenue', AccountType: 'Income', AccountSubType: 'SalesOfProductIncome' },
  { Name: 'Hosting & Infrastructure COGS', AccountType: 'Cost of Goods Sold', AccountSubType: 'OtherCostsOfServiceCos' },
  { Name: 'Customer Support COGS', AccountType: 'Cost of Goods Sold', AccountSubType: 'OtherCostsOfServiceCos' },
  { Name: 'Hardware COGS', AccountType: 'Cost of Goods Sold', AccountSubType: 'SuppliesMaterialsCogs' },
  { Name: 'Depreciation (COGS-embedded)', AccountType: 'Cost of Goods Sold', AccountSubType: 'OtherCostsOfServiceCos' },
  { Name: 'Sales & Marketing - Advertising', AccountType: 'Expense', AccountSubType: 'AdvertisingPromotional' },
  { Name: 'Sales & Marketing - Salaries', AccountType: 'Expense', AccountSubType: 'PayrollExpenses' },
  { Name: 'G&A - Salaries', AccountType: 'Expense', AccountSubType: 'PayrollExpenses' },
  { Name: 'G&A - Rent & Facilities', AccountType: 'Expense', AccountSubType: 'RentOrLeaseOfBuildings' },
  { Name: 'G&A - Legal & Professional', AccountType: 'Expense', AccountSubType: 'LegalProfessionalFees' },
  { Name: 'G&A - Software & Tools', AccountType: 'Expense', AccountSubType: 'OfficeGeneralAdministrativeExpenses' },
  { Name: 'Depreciation & Amortization', AccountType: 'Other Expense', AccountSubType: 'Depreciation' },
  { Name: 'Accumulated Depreciation', AccountType: 'Fixed Asset', AccountSubType: 'AccumulatedDepreciation' }
]

const CLASSES = ['Core Platform', 'Analytics Add-on', 'Professional Services & Hardware']

async function main() {
  const { accessToken, realmId } = await quickbooksAuth()
  const qb = makeQbClient(accessToken, realmId)

  console.log('Creating Accounts...')
  const accountResults = await qb.createMany('Account', ACCOUNTS)
  accountResults.forEach((r, i) => {
    if (!r.ok) console.log(`  FAILED ${ACCOUNTS[i].Name}:`, JSON.stringify(r.error).slice(0, 300))
  })
  console.log(`  ${accountResults.filter((r) => r.ok).length}/${ACCOUNTS.length} accounts created`)

  console.log('Creating Classes...')
  const classResults = await qb.createMany(
    'Class',
    CLASSES.map((Name) => ({ Name }))
  )
  classResults.forEach((r, i) => {
    if (!r.ok) console.log(`  FAILED ${CLASSES[i]}:`, JSON.stringify(r.error).slice(0, 300))
  })
  console.log(`  ${classResults.filter((r) => r.ok).length}/${CLASSES.length} classes created`)

  // Accounts can never be deleted/deactivated via the QuickBooks API (wipeQuickbooks.ts
  // doesn't touch them at all), so a re-seed against an already-seeded company always sees
  // these as duplicates -- fall back to the existing account's Id by name rather than
  // crashing on a failed create.
  const existingAccounts = await qb.query<{ Id: string; Name: string }>('Account', 'Active = true')
  const accountIdByName = new Map<string, string>()
  ACCOUNTS.forEach((a, i) => {
    const r = accountResults[i]
    if (r.ok) accountIdByName.set(a.Name, r.id!)
    else {
      const existing = existingAccounts.find((x) => x.Name === a.Name)
      if (existing) accountIdByName.set(a.Name, existing.Id)
    }
  })
  const incomeSub = accountIdByName.get('Subscription Revenue')!
  const incomePs = accountIdByName.get('Professional Services Revenue')!
  const incomeHw = accountIdByName.get('Hardware Revenue')!
  const cogsHosting = accountIdByName.get('Hosting & Infrastructure COGS')!
  const cogsSupport = accountIdByName.get('Customer Support COGS')!
  const cogsHw = accountIdByName.get('Hardware COGS')!

  // "Inventory Asset" is a QuickBooks-provisioned default account (exists on the company
  // before this script ever runs), not one of the accounts created above -- looked up
  // dynamically rather than hardcoding its Id, which is sandbox-specific.
  const invAssetAccount = existingAccounts.find((a) => a.Name === 'Inventory Asset')
  if (!invAssetAccount) throw new Error('"Inventory Asset" account not found -- required for GPS Hardware Kit as an Inventory item')

  console.log('Creating Items...')
  const ITEMS = [
    {
      Name: 'DriverInsights Platform Subscription',
      Type: 'Service',
      IncomeAccountRef: { value: incomeSub },
      ExpenseAccountRef: { value: cogsHosting }
    },
    {
      Name: 'Fleet Analytics Add-on',
      Type: 'Service',
      IncomeAccountRef: { value: incomeSub },
      ExpenseAccountRef: { value: cogsHosting }
    },
    {
      Name: 'Onboarding & Professional Services',
      Type: 'Service',
      IncomeAccountRef: { value: incomePs },
      ExpenseAccountRef: { value: cogsSupport }
    },
    {
      Name: 'GPS Hardware Kit',
      Type: 'Inventory',
      TrackQtyOnHand: true,
      QtyOnHand: 500,
      // Day 1 of the earliest seeded month -- must be on/before every Invoice line that
      // references this item (data.ts's month 0), or QuickBooks rejects the invoice as
      // dated before the item's inventory start.
      InvStartDate: isoDate(0, 1),
      IncomeAccountRef: { value: incomeHw },
      ExpenseAccountRef: { value: cogsHw },
      AssetAccountRef: { value: invAssetAccount.Id }
    }
  ]
  const itemResults = await qb.createMany('Item', ITEMS)
  itemResults.forEach((r, i) => {
    if (!r.ok) console.log(`  FAILED ${ITEMS[i].Name}:`, JSON.stringify(r.error).slice(0, 400))
  })
  console.log(`  ${itemResults.filter((r) => r.ok).length}/${ITEMS.length} items created`)

  console.log('Creating Vendors...')
  const VENDORS = ['CloudHost Infrastructure Ltd', 'AdNetwork Partners Co', 'Meridian Office Properties LLC', 'Sterling Legal Group LLP']
  const vendorResults = await qb.createMany(
    'Vendor',
    VENDORS.map((DisplayName) => ({ DisplayName }))
  )
  vendorResults.forEach((r, i) => {
    if (!r.ok) console.log(`  FAILED ${VENDORS[i]}:`, JSON.stringify(r.error).slice(0, 300))
  })
  console.log(`  ${vendorResults.filter((r) => r.ok).length}/${VENDORS.length} vendors created`)

  console.log('QuickBooks setup phase complete.')
  await closeDb()
}

main().catch((e) => {
  console.error('QuickBooks setup failed:', e.response?.data ?? e.message)
  process.exit(1)
})
