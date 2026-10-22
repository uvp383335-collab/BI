import { getStoredProfitAndLoss, StoredQuarterSnapshot } from './plReport.service'
import { cashBalanceSnapshotRepository } from '../../sync/repository/cashBalanceSnapshot.repository'
import { organizationsRepository } from '../../organizations/repository/organizations.repository'
import { computeCB05, computeCB07, computeCB10 } from './cbMetrics.service'

jest.mock('./plReport.service')
jest.mock('../../sync/repository/cashBalanceSnapshot.repository')
jest.mock('../../organizations/repository/organizations.repository')

const mockedGetPL = getStoredProfitAndLoss as jest.Mock
const mockedFindRecent = cashBalanceSnapshotRepository.findRecent as jest.Mock
const mockedFindOrgById = organizationsRepository.findById as jest.Mock

function snapshot(overrides: Partial<StoredQuarterSnapshot> = {}): StoredQuarterSnapshot {
  return {
    columns: ['Total'],
    income: [],
    cogs: [],
    expenses: [],
    otherExpenses: [],
    sectionTotals: {},
    startDate: '2026-01-01',
    endDate: '2026-03-31',
    ...overrides
  }
}

/** Org with no CB-07/CB-10 account settings configured at all (the default for a brand new org). */
function orgWithSettings(settings: Record<string, unknown> = {}) {
  return { settings }
}

beforeEach(() => {
  mockedGetPL.mockReset()
  mockedFindRecent.mockReset()
  mockedFindOrgById.mockReset()
  mockedFindOrgById.mockResolvedValue(orgWithSettings())
})

describe('CB-05 — Cash Position & Runway', () => {
  it('computes runway from the burn rate between the oldest and newest snapshot', async () => {
    // 90 days apart: cash fell from 900,000 to 600,000 -> burn ~100,000/mo -> runway = 600,000/100,000 = 6 months
    mockedFindRecent.mockResolvedValue([
      { asOfDate: '2026-08-22', unrestrictedCash: 600000 },
      { asOfDate: '2026-05-24', unrestrictedCash: 900000 }
    ])
    const result = await computeCB05('org1')
    expect(result.value).toBeCloseTo(6, 0)
    expect(result.unit).toBe('months')
    expect(result.flag?.level).toBe('watch') // 6.0 is not strictly below the 6-month act-now floor, but is below the 12-month watch line
  })

  it('marks self-funding (no runway) when cash is growing, not burning', async () => {
    mockedFindRecent.mockResolvedValue([
      { asOfDate: '2026-08-22', unrestrictedCash: 1000000 },
      { asOfDate: '2026-05-24', unrestrictedCash: 800000 }
    ])
    const result = await computeCB05('org1')
    expect(result.data.selfFunding).toBe(true)
    expect(result.value).toBeNull()
    expect(result.flag).toBeNull()
  })

  it('flags an unexplained single-day cash drop, but only when the two latest snapshots are really ~1 day apart', async () => {
    mockedFindRecent.mockResolvedValue([
      { asOfDate: '2026-08-22', unrestrictedCash: 800000 },
      { asOfDate: '2026-08-21', unrestrictedCash: 1000000 } // 20% drop, 1 day apart
    ])
    const result = await computeCB05('org1')
    expect(result.data.singleDayDropPct).toBeCloseTo(20, 0)
    expect(result.flag?.level).toBe('act_now')
  })

  it('does not call a two-week gap between sparse syncs a "single-day" drop', async () => {
    mockedFindRecent.mockResolvedValue([
      { asOfDate: '2026-08-22', unrestrictedCash: 800000 },
      { asOfDate: '2026-08-08', unrestrictedCash: 1000000 } // same 20% drop, but 14 days apart
    ])
    const result = await computeCB05('org1')
    expect(result.data.singleDayDropPct).toBeNull()
  })

  it('not computable with zero synced snapshots', async () => {
    mockedFindRecent.mockResolvedValue([])
    const result = await computeCB05('org1')
    expect(result.computable).toBe(false)
  })
})

describe('CB-07 — Free Cash Flow Conversion', () => {
  it('computes FCF / EBITDA from the Cash Flow report OCF and the org-configured expenditure accounts', async () => {
    mockedFindOrgById.mockResolvedValue(orgWithSettings({ cb07ExpenditureAccountIds: ['acct-1', 'acct-2'] }))
    mockedGetPL.mockResolvedValueOnce(
      snapshot({
        income: [{ account: 'Rev', amounts: { Total: 10000 } }],
        cogs: [{ account: 'Cogs', amounts: { Total: 4000 } }],
        operatingCashFlow: 3000,
        accountAmounts: { 'acct-1': -300, 'acct-2': 200 } // CapEx accounts summed as magnitudes regardless of sign
      })
    )
    // operating income falls back to revenue-cogs-expenses (0 expenses here) = 6000; no D&A -> EBITDA = 6000
    // CapEx = |-300| + |200| = 500; FCF = 3000 - 500 = 2500; conversion = 2500/6000 = 41.7%
    const result = await computeCB07('org1', '2026-02')
    expect(result.value).toBeCloseTo(41.7, 1)
    expect(result.data.capEx).toBeCloseTo(500, 1)
    expect(result.flag).toBeNull()
  })

  it('is not computable when no expenditure accounts are configured, even with a perfectly good Cash Flow report', async () => {
    mockedGetPL.mockResolvedValueOnce(
      snapshot({ income: [{ account: 'Rev', amounts: { Total: 10000 } }], operatingCashFlow: 3000 })
    )
    const result = await computeCB07('org1', '2026-02')
    expect(result.computable).toBe(false)
    expect(result.data.capEx).toBeNull()
    expect(result.data.expenditureAccountsConfigured).toBe(false)
  })

  it('is not computable when a configured expenditure account has no amount for this quarter', async () => {
    mockedFindOrgById.mockResolvedValue(orgWithSettings({ cb07ExpenditureAccountIds: ['acct-missing'] }))
    mockedGetPL.mockResolvedValueOnce(
      snapshot({ income: [{ account: 'Rev', amounts: { Total: 10000 } }], operatingCashFlow: 3000, accountAmounts: { 'acct-1': 100 } })
    )
    const result = await computeCB07('org1', '2026-02')
    expect(result.computable).toBe(false)
    expect(result.data.capEx).toBeNull()
  })

  it('falls back to a Balance-Sheet-derived Operating Cash Flow when the Cash Flow report is unavailable', async () => {
    mockedFindOrgById.mockResolvedValue(orgWithSettings({ cb07ExpenditureAccountIds: ['acct-1'] }))
    // EBITDA: revenue 10000 - cogs 4000 - expenses 500 (a D&A account) = operating income 5500, + D&A 500 back = 6000.
    // Working capital increase: AR +1000, Inventory +200, AP +500 -> net +700 -> OCF proxy = 6000 - 700 = 5300.
    // CapEx (manual, acct-1) = 1200. FCF = 5300 - 1200 = 4100. Conversion = 4100/6000 = 68.3%.
    const current = snapshot({
      income: [{ account: 'Rev', amounts: { Total: 10000 } }],
      cogs: [{ account: 'Cogs', amounts: { Total: 4000 } }],
      expenses: [{ account: 'Equipment Depreciation', amounts: { Total: 500 } }],
      accountsReceivable: 5000,
      accountsPayable: 3000,
      inventoryValue: 2000,
      accountAmounts: { 'acct-1': 1200 }
      // operatingCashFlow intentionally omitted -- Cash Flow report unavailable
    })
    const previous = snapshot({ accountsReceivable: 4000, accountsPayable: 2500, inventoryValue: 1800 })
    mockedGetPL.mockResolvedValueOnce(current).mockResolvedValueOnce(previous)

    const result = await computeCB07('org1', '2026-02')
    expect(result.computable).toBe(true)
    expect(result.value).toBeCloseTo(68.3, 1)
    expect(result.data.sourceQuality).toBe('balance-sheet-derived')
  })

  it('still falls back when neither quarter has an inventory report (a no-inventory company, e.g. most SaaS) -- treated as $0, not blocking', async () => {
    mockedFindOrgById.mockResolvedValue(orgWithSettings({ cb07ExpenditureAccountIds: ['acct-1'] }))
    // Working capital increase: AR +1000, Inventory +0, AP +500 -> net +500 -> OCF proxy = 6000 - 500 = 5500.
    // CapEx (manual) = 1200. FCF = 5500 - 1200 = 4300. Conversion = 4300/6000 = 71.7%.
    const current = snapshot({
      income: [{ account: 'Rev', amounts: { Total: 10000 } }],
      cogs: [{ account: 'Cogs', amounts: { Total: 4000 } }],
      expenses: [{ account: 'Equipment Depreciation', amounts: { Total: 500 } }],
      accountsReceivable: 5000,
      accountsPayable: 3000,
      accountAmounts: { 'acct-1': 1200 }
      // inventoryValue intentionally omitted
    })
    const previous = snapshot({ accountsReceivable: 4000, accountsPayable: 2500 })
    mockedGetPL.mockResolvedValueOnce(current).mockResolvedValueOnce(previous)

    const result = await computeCB07('org1', '2026-02')
    expect(result.computable).toBe(true)
    expect(result.value).toBeCloseTo(71.7, 1)
    expect(result.data.sourceQuality).toBe('balance-sheet-derived')
  })

  it('does not fall back when the prior quarter is also missing Balance Sheet data', async () => {
    const current = snapshot({
      income: [{ account: 'Rev', amounts: { Total: 10000 } }],
      cogs: [{ account: 'Cogs', amounts: { Total: 4000 } }],
      accountsReceivable: 5000,
      accountsPayable: 3000,
      inventoryValue: 2000
    })
    const previous = snapshot({}) // no A/R or A/P at all
    mockedGetPL.mockResolvedValueOnce(current).mockResolvedValueOnce(previous)

    const result = await computeCB07('org1', '2026-02')
    expect(result.computable).toBe(false)
    expect(result.data.sourceQuality).toBeNull()
  })
})

describe('CB-10 — Cash Conversion Cycle', () => {
  it('computes the three legs and the overall cycle from the org-configured A/R, A/P, and Inventory accounts', async () => {
    mockedFindOrgById.mockResolvedValue(
      orgWithSettings({ cb10AccountsReceivableAccountId: 'ar-1', cb10AccountsPayableAccountId: 'ap-1', cb10InventoryAccountId: 'inv-1' })
    )
    // 90-day quarter. Revenue 9000, COGS 3600, A/R 1000 -> days to collect = 1000/9000*90 = 10
    // Inventory 200 -> days in inventory = 200/3600*90 = 5; A/P 600 -> days to pay = 600/3600*90 = 15
    // cycle = 10 + 5 - 15 = 0
    const current = snapshot({
      startDate: '2026-01-01',
      endDate: '2026-03-31',
      income: [{ account: 'Rev', amounts: { Total: 9000 } }],
      cogs: [{ account: 'Cogs', amounts: { Total: 3600 } }],
      accountAmounts: { 'ar-1': 1000, 'ap-1': 600, 'inv-1': 200 }
    })
    mockedGetPL.mockResolvedValueOnce(current).mockResolvedValue(null)

    const result = await computeCB10('org1', '2026-02')
    expect(result.data.daysToCollect).toBeCloseTo(10, 0)
    expect(result.data.daysInInventory).toBeCloseTo(5, 0)
    expect(result.data.daysToPay).toBeCloseTo(15, 0)
    expect(result.value).toBeCloseTo(0, 0)
    expect(result.data.hasInventory).toBe(true)
  })

  it('hides the inventory leg (but still returns a cycle) when no Inventory account is configured', async () => {
    mockedFindOrgById.mockResolvedValue(orgWithSettings({ cb10AccountsReceivableAccountId: 'ar-1', cb10AccountsPayableAccountId: 'ap-1' }))
    const current = snapshot({
      income: [{ account: 'Rev', amounts: { Total: 9000 } }],
      cogs: [{ account: 'Cogs', amounts: { Total: 3600 } }],
      accountAmounts: { 'ar-1': 1000, 'ap-1': 600 }
      // no Inventory account configured
    })
    mockedGetPL.mockResolvedValueOnce(current).mockResolvedValue(null)

    const result = await computeCB10('org1', '2026-02')
    expect(result.data.hasInventory).toBe(false)
    expect(result.data.daysInInventory).toBeNull()
    expect(result.computable).toBe(true) // the cycle itself still computes with a 0 inventory leg
  })

  it('is not computable when the A/P account is not configured, even with A/R and Inventory set', async () => {
    mockedFindOrgById.mockResolvedValue(orgWithSettings({ cb10AccountsReceivableAccountId: 'ar-1', cb10InventoryAccountId: 'inv-1' }))
    const current = snapshot({
      income: [{ account: 'Rev', amounts: { Total: 9000 } }],
      cogs: [{ account: 'Cogs', amounts: { Total: 3600 } }],
      accountAmounts: { 'ar-1': 1000, 'inv-1': 200 }
    })
    mockedGetPL.mockResolvedValueOnce(current).mockResolvedValue(null)

    const result = await computeCB10('org1', '2026-02')
    expect(result.computable).toBe(false)
    expect(result.data.daysToPay).toBeNull()
    expect(result.data.accountsConfigured).toEqual({ accountsReceivable: true, accountsPayable: false, inventory: true })
  })

  it('flags act_now when the cycle lengthened more than 15 days over two quarters', async () => {
    mockedFindOrgById.mockResolvedValue(
      orgWithSettings({ cb10AccountsReceivableAccountId: 'ar-1', cb10AccountsPayableAccountId: 'ap-1', cb10InventoryAccountId: 'inv-1' })
    )
    const makeSnap = (ar: number) =>
      snapshot({
        income: [{ account: 'Rev', amounts: { Total: 9000 } }],
        cogs: [{ account: 'Cogs', amounts: { Total: 3600 } }],
        accountAmounts: { 'ar-1': ar, 'ap-1': 600, 'inv-1': 0 }
      })
    // current: days to collect = 3000/9000*90 = 30 -> cycle = 30-15 = 15
    // two-ago: days to collect = 500/9000*90 = 5 -> cycle = 5-15 = -10
    // delta = 15 - (-10) = 25 > 15 -> act_now
    mockedGetPL
      .mockResolvedValueOnce(makeSnap(3000)) // current
      .mockResolvedValueOnce(makeSnap(3000)) // prev quarter (not relevant to this assertion)
      .mockResolvedValueOnce(makeSnap(500)) // two quarters ago

    const result = await computeCB10('org1', '2026-02')
    expect(result.flag?.level).toBe('act_now')
  })

  it('never carries a flag when the cycle itself is not computable, even if collections alone slowed', async () => {
    // Current quarter has no A/P account configured value -> daysToPay is null -> legs.cycle is null ->
    // not computable. But daysToCollect alone resolves fine and did slow a lot vs. last quarter --
    // that alone must not be enough to set a flag on a "not computable" response.
    mockedFindOrgById.mockResolvedValue(orgWithSettings({ cb10AccountsReceivableAccountId: 'ar-1', cb10AccountsPayableAccountId: 'ap-1' }))
    const current = snapshot({
      income: [{ account: 'Rev', amounts: { Total: 9000 } }],
      cogs: [{ account: 'Cogs', amounts: { Total: 3600 } }],
      accountAmounts: { 'ar-1': 3000 } // days to collect = 30; ap-1 missing from this quarter's amounts
    })
    const prev = snapshot({
      income: [{ account: 'Rev', amounts: { Total: 9000 } }],
      cogs: [{ account: 'Cogs', amounts: { Total: 3600 } }],
      accountAmounts: { 'ar-1': 500, 'ap-1': 600 } // days to collect = 5 -- a 25-day slowdown vs. current
    })
    mockedGetPL.mockResolvedValueOnce(current).mockResolvedValueOnce(prev).mockResolvedValueOnce(null)

    const result = await computeCB10('org1', '2026-02')
    expect(result.computable).toBe(false)
    expect(result.data.daysToCollect).toBeCloseTo(30, 0) // confirms the collections data really was there
    expect(result.flag).toBeNull()
  })
})
