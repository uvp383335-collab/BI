import { getStoredProfitAndLoss, StoredQuarterSnapshot } from './plReport.service'
import { cashBalanceSnapshotRepository } from '../../sync/repository/cashBalanceSnapshot.repository'
import { computeCB05, computeCB07, computeCB10 } from './cbMetrics.service'

jest.mock('./plReport.service')
jest.mock('../../sync/repository/cashBalanceSnapshot.repository')

const mockedGetPL = getStoredProfitAndLoss as jest.Mock
const mockedFindRecent = cashBalanceSnapshotRepository.findRecent as jest.Mock

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

beforeEach(() => {
  mockedGetPL.mockReset()
  mockedFindRecent.mockReset()
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
  it('computes FCF / EBITDA and never fires a flag (leverage/plan data unavailable in MVP)', async () => {
    mockedGetPL.mockResolvedValueOnce(
      snapshot({
        income: [{ account: 'Rev', amounts: { Total: 10000 } }],
        cogs: [{ account: 'Cogs', amounts: { Total: 4000 } }],
        operatingCashFlow: 3000,
        capEx: 500
      })
    )
    // operating income falls back to revenue-cogs-expenses (0 expenses here) = 6000; no D&A -> EBITDA = 6000
    // FCF = 3000 - 500 = 2500; conversion = 2500/6000 = 41.7%
    const result = await computeCB07('org1', '2026-02')
    expect(result.value).toBeCloseTo(41.7, 1)
    expect(result.flag).toBeNull()
  })

  it('is not computable when the Cash Flow report never resolved for this quarter (operatingCashFlow/capEx undefined)', async () => {
    mockedGetPL.mockResolvedValueOnce(snapshot({ income: [{ account: 'Rev', amounts: { Total: 10000 } }] }))
    const result = await computeCB07('org1', '2026-02')
    expect(result.computable).toBe(false)
  })

  it('falls back to a Balance-Sheet-derived FCF when the Cash Flow report is unavailable', async () => {
    // EBITDA: revenue 10000 - cogs 4000 - expenses 500 (a D&A account) = operating income 5500, + D&A 500 back = 6000.
    // Working capital increase: AR +1000, Inventory +200, AP +500 -> net +700 -> OCF proxy = 6000 - 700 = 5300.
    // CapEx proxy: net fixed assets +1000, + D&A 500 = 1500. FCF = 5300 - 1500 = 3800. Conversion = 3800/6000 = 63.3%.
    const current = snapshot({
      income: [{ account: 'Rev', amounts: { Total: 10000 } }],
      cogs: [{ account: 'Cogs', amounts: { Total: 4000 } }],
      expenses: [{ account: 'Equipment Depreciation', amounts: { Total: 500 } }],
      accountsReceivable: 5000,
      accountsPayable: 3000,
      inventoryValue: 2000,
      netFixedAssets: 20000
      // operatingCashFlow/capEx intentionally omitted -- Cash Flow report unavailable
    })
    const previous = snapshot({
      accountsReceivable: 4000,
      accountsPayable: 2500,
      inventoryValue: 1800,
      netFixedAssets: 19000
    })
    mockedGetPL.mockResolvedValueOnce(current).mockResolvedValueOnce(previous)

    const result = await computeCB07('org1', '2026-02')
    expect(result.computable).toBe(true)
    expect(result.value).toBeCloseTo(63.3, 1)
    expect(result.data.sourceQuality).toBe('balance-sheet-derived')
  })

  it('still falls back when neither quarter has an inventory report (a no-inventory company, e.g. most SaaS) -- treated as $0, not blocking', async () => {
    // Same as the fallback test above, minus inventoryValue on both quarters entirely.
    // Working capital increase: AR +1000, Inventory +0, AP +500 -> net +500 -> OCF proxy = 6000 - 500 = 5500.
    // CapEx proxy unchanged at 1500. FCF = 5500 - 1500 = 4000. Conversion = 4000/6000 = 66.7%.
    const current = snapshot({
      income: [{ account: 'Rev', amounts: { Total: 10000 } }],
      cogs: [{ account: 'Cogs', amounts: { Total: 4000 } }],
      expenses: [{ account: 'Equipment Depreciation', amounts: { Total: 500 } }],
      accountsReceivable: 5000,
      accountsPayable: 3000,
      netFixedAssets: 20000
      // inventoryValue intentionally omitted
    })
    const previous = snapshot({
      accountsReceivable: 4000,
      accountsPayable: 2500,
      netFixedAssets: 19000
      // inventoryValue intentionally omitted
    })
    mockedGetPL.mockResolvedValueOnce(current).mockResolvedValueOnce(previous)

    const result = await computeCB07('org1', '2026-02')
    expect(result.computable).toBe(true)
    expect(result.value).toBeCloseTo(66.7, 1)
    expect(result.data.sourceQuality).toBe('balance-sheet-derived')
  })

  it('does not fall back when the prior quarter is also missing Balance Sheet data', async () => {
    const current = snapshot({
      income: [{ account: 'Rev', amounts: { Total: 10000 } }],
      cogs: [{ account: 'Cogs', amounts: { Total: 4000 } }],
      accountsReceivable: 5000,
      accountsPayable: 3000,
      inventoryValue: 2000,
      netFixedAssets: 20000
    })
    const previous = snapshot({}) // no A/R, A/P, Inventory, or Net Fixed Assets at all
    mockedGetPL.mockResolvedValueOnce(current).mockResolvedValueOnce(previous)

    const result = await computeCB07('org1', '2026-02')
    expect(result.computable).toBe(false)
    expect(result.data.sourceQuality).toBeNull()
  })
})

describe('CB-10 — Cash Conversion Cycle', () => {
  it('computes the three legs and the overall cycle from A/R, A/P, Inventory, Revenue, COGS', async () => {
    // 90-day quarter. Revenue 9000, COGS 3600, A/R 1000 -> days to collect = 1000/9000*90 = 10
    // Inventory 200 -> days in inventory = 200/3600*90 = 5; A/P 600 -> days to pay = 600/3600*90 = 15
    // cycle = 10 + 5 - 15 = 0
    const current = snapshot({
      startDate: '2026-01-01',
      endDate: '2026-03-31', // 90 days inclusive-ish
      income: [{ account: 'Rev', amounts: { Total: 9000 } }],
      cogs: [{ account: 'Cogs', amounts: { Total: 3600 } }],
      accountsReceivable: 1000,
      accountsPayable: 600,
      inventoryValue: 200
    })
    mockedGetPL.mockResolvedValueOnce(current).mockResolvedValue(null)

    const result = await computeCB10('org1', '2026-02')
    expect(result.data.daysToCollect).toBeCloseTo(10, 0)
    expect(result.data.daysInInventory).toBeCloseTo(5, 0)
    expect(result.data.daysToPay).toBeCloseTo(15, 0)
    expect(result.value).toBeCloseTo(0, 0)
    expect(result.data.hasInventory).toBe(true)
  })

  it('hides the inventory leg (but still returns a cycle) for a service company with no inventory report', async () => {
    const current = snapshot({
      income: [{ account: 'Rev', amounts: { Total: 9000 } }],
      cogs: [{ account: 'Cogs', amounts: { Total: 3600 } }],
      accountsReceivable: 1000,
      accountsPayable: 600
      // inventoryValue intentionally omitted
    })
    mockedGetPL.mockResolvedValueOnce(current).mockResolvedValue(null)

    const result = await computeCB10('org1', '2026-02')
    expect(result.data.hasInventory).toBe(false)
    expect(result.data.daysInInventory).toBeNull()
    expect(result.computable).toBe(true) // the cycle itself still computes with a 0 inventory leg
  })

  it('flags act_now when the cycle lengthened more than 15 days over two quarters', async () => {
    const makeSnap = (ar: number) =>
      snapshot({
        income: [{ account: 'Rev', amounts: { Total: 9000 } }],
        cogs: [{ account: 'Cogs', amounts: { Total: 3600 } }],
        accountsReceivable: ar,
        accountsPayable: 600,
        inventoryValue: 0
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
    // Current quarter is missing accountsPayable -> daysToPay is null -> legs.cycle is null ->
    // not computable. But daysToCollect alone resolves fine and did slow a lot vs. last quarter --
    // that alone must not be enough to set a flag on a "not computable" response.
    const current = snapshot({
      income: [{ account: 'Rev', amounts: { Total: 9000 } }],
      cogs: [{ account: 'Cogs', amounts: { Total: 3600 } }],
      accountsReceivable: 3000 // days to collect = 30
      // accountsPayable intentionally omitted
    })
    const prev = snapshot({
      income: [{ account: 'Rev', amounts: { Total: 9000 } }],
      cogs: [{ account: 'Cogs', amounts: { Total: 3600 } }],
      accountsReceivable: 500, // days to collect = 5 -- a 25-day slowdown vs. current
      accountsPayable: 600,
      inventoryValue: 0
    })
    mockedGetPL.mockResolvedValueOnce(current).mockResolvedValueOnce(prev).mockResolvedValueOnce(null)

    const result = await computeCB10('org1', '2026-02')
    expect(result.computable).toBe(false)
    expect(result.data.daysToCollect).toBeCloseTo(30, 0) // confirms the collections data really was there
    expect(result.flag).toBeNull()
  })
})
