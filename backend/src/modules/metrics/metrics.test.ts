import { computeRollForward, grrFromRollForward, nrrFromRollForward, quarterStartOf, shiftMonth } from './service/revenueRollForward.service'
import { computeVC01, computeVC02, computeVC03 } from './service/metrics.service'
import { invoiceRepository } from '../sync/repository/invoice.repository'

jest.mock('../sync/repository/invoice.repository')

const mockedGetMonthlyRevenue = invoiceRepository.getMonthlyRevenueByCustomer as jest.Mock
const mockedFindCustomerIdsWithInvoiceBefore = invoiceRepository.findCustomerIdsWithInvoiceBefore as jest.Mock

// Every existing test's customers are genuinely new (no prior invoice) unless a test
// says otherwise — keeps the win-back check (gap G-20) a no-op for tests that predate it.
beforeEach(() => mockedFindCustomerIdsWithInvoiceBefore.mockResolvedValue(new Set()))

describe('revenueRollForward month utilities', () => {
  it('shiftMonth crosses year boundaries in both directions', () => {
    expect(shiftMonth('2026-01', -1)).toBe('2025-12')
    expect(shiftMonth('2025-12', 1)).toBe('2026-01')
    expect(shiftMonth('2026-06', 3)).toBe('2026-09')
  })

  it('quarterStartOf maps any month onto its quarter\'s first month', () => {
    expect(quarterStartOf('2026-01')).toBe('2026-01')
    expect(quarterStartOf('2026-03')).toBe('2026-01')
    expect(quarterStartOf('2026-04')).toBe('2026-04')
    expect(quarterStartOf('2025-12')).toBe('2025-10')
  })
})

describe('computeRollForward — the shared per-customer revenue classification', () => {
  beforeEach(() => mockedGetMonthlyRevenue.mockReset())

  it('classifies steady, downgrade, cancellation, expansion, and new-logo customers correctly', async () => {
    mockedGetMonthlyRevenue.mockResolvedValue([
      { customerRecordId: 'steady', month: '2026-02', revenue: 1000 },
      { customerRecordId: 'steady', month: '2026-03', revenue: 1000 },
      { customerRecordId: 'downgrade', month: '2026-02', revenue: 800 },
      { customerRecordId: 'downgrade', month: '2026-03', revenue: 500 },
      { customerRecordId: 'cancelled', month: '2026-02', revenue: 400 },
      // cancelled customer has no 2026-03 row at all — revenue implicitly 0
      { customerRecordId: 'expanded', month: '2026-02', revenue: 600 },
      { customerRecordId: 'expanded', month: '2026-03', revenue: 900 },
      // new-logo customer only appears in the ending month
      { customerRecordId: 'new_logo', month: '2026-03', revenue: 300 }
    ])

    const rf = await computeRollForward('org1', 'quickbooks', '2026-02', '2026-03')

    // starting revenue excludes the new-logo customer (nothing to retain yet)
    expect(rf.startingRevenue).toBe(1000 + 800 + 400 + 600)
    expect(rf.cancellations).toBe(400)
    expect(rf.downgrades).toBe(300) // 800 - 500
    expect(rf.expansion).toBe(300) // 900 - 600
    expect(rf.newLogoRevenue).toBe(300)
    expect(rf.endingRevenue).toBe(1000 + 500 + 0 + 900 + 300)
  })

  it('GRR ignores expansion; NRR includes it', async () => {
    mockedGetMonthlyRevenue.mockResolvedValue([
      { customerRecordId: 'a', month: '2026-02', revenue: 1000 },
      { customerRecordId: 'a', month: '2026-03', revenue: 1500 }
    ])
    const rf = await computeRollForward('org1', 'quickbooks', '2026-02', '2026-03')
    expect(grrFromRollForward(rf)).toBe(100) // upsells never push GRR above 100
    expect(nrrFromRollForward(rf)).toBe(150) // but NRR reflects the expansion
  })

  it('is not computable (returns null, never a silent 0) when there is no starting revenue', async () => {
    mockedGetMonthlyRevenue.mockResolvedValue([{ customerRecordId: 'new', month: '2026-03', revenue: 500 }])
    const rf = await computeRollForward('org1', 'quickbooks', '2026-02', '2026-03')
    expect(grrFromRollForward(rf)).toBeNull()
    expect(nrrFromRollForward(rf)).toBeNull()
  })

  it('a customer with an invoice further back is a win-back, not a new logo (gap G-20)', async () => {
    mockedGetMonthlyRevenue.mockResolvedValue([
      // $0 in the comparison window's start month, same as a true new logo would look...
      { customerRecordId: 'returning', month: '2026-03', revenue: 700 },
      { customerRecordId: 'genuinely_new', month: '2026-03', revenue: 300 }
    ])
    // ...but "returning" has an invoice from well before the window; "genuinely_new" doesn't.
    mockedFindCustomerIdsWithInvoiceBefore.mockResolvedValue(new Set(['returning']))

    const rf = await computeRollForward('org1', 'quickbooks', '2026-02', '2026-03')

    expect(rf.newLogoRevenue).toBe(300)
    expect(rf.newLogoCustomerCount).toBe(1)
    expect(rf.winBackRevenue).toBe(700)
    expect(rf.winBackCustomerCount).toBe(1)
    // Win-back revenue still counts toward ending revenue -- it's real revenue, just not "new."
    expect(rf.endingRevenue).toBe(1000)
  })
})

describe('VC-01 (GRR) flags — exact wording from the metrics PDF', () => {
  beforeEach(() => mockedGetMonthlyRevenue.mockReset())

  it('act_now: retention below the 90% benchmark AND down vs. last quarter, both in the same quarter', async () => {
    mockedGetMonthlyRevenue.mockResolvedValue([
      { customerRecordId: 'a', month: '2025-09', revenue: 1000 }, // start of Q4-2025
      { customerRecordId: 'a', month: '2025-12', revenue: 1000 }, // end of Q4-2025 = start of Q1-2026 -> prior quarter GRR 100%
      { customerRecordId: 'a', month: '2026-02', revenue: 850 },
      { customerRecordId: 'a', month: '2026-03', revenue: 700 } // end of Q1-2026 -> this quarter GRR 70%
    ])

    const result = await computeVC01('org1', '2026-03')

    expect(result.computable).toBe(true)
    expect(result.value).toBeCloseTo(82.4, 1) // monthly Feb->Mar figure
    expect(result.data.currentQuarterGrr).toBeCloseTo(70, 1)
    expect(result.data.previousQuarterGrr).toBeCloseTo(100, 1)
    expect(result.flag).not.toBeNull()
    expect(result.flag?.level).toBe('act_now')
  })

  it('watch only: below benchmark but not down vs. last quarter', async () => {
    mockedGetMonthlyRevenue.mockResolvedValue([
      { customerRecordId: 'a', month: '2025-09', revenue: 1000 },
      { customerRecordId: 'a', month: '2025-12', revenue: 800 }, // prior quarter GRR 80% (already below benchmark)
      { customerRecordId: 'a', month: '2026-02', revenue: 800 },
      { customerRecordId: 'a', month: '2026-03', revenue: 800 } // this quarter GRR 100% of its own start... but vs Dec(800) it's flat
    ])

    const result = await computeVC01('org1', '2026-03')
    // current quarter start = Dec(800), end = Mar(800) -> GRR 100%, not below benchmark, not down vs last quarter(GRR was 100 too since Sep(1000)->Dec(800) is the PREVIOUS quarter calc, not this one)
    expect(result.flag).toBeNull()
  })

  it('not computable when the org has no invoice history at all', async () => {
    mockedGetMonthlyRevenue.mockResolvedValue([])
    const result = await computeVC01('org1', '2026-03')
    expect(result.computable).toBe(false)
    expect(result.value).toBeNull()
    expect(result.flag).toBeNull()
  })

  it('never carries a flag when not computable, even if the quarterly figures alone would trigger one', async () => {
    // No Feb-2026 row at all -> the monthly (Feb vs Mar) comparison has $0 starting revenue,
    // so monthlyGrr (what `computable`/`value` depend on) is null. But the quarterly comparison
    // (Dec-2025 vs Mar-2026) has real data and would, on its own, clearly trigger a flag (70% GRR,
    // down from 100% last quarter, both below the 90% benchmark).
    mockedGetMonthlyRevenue.mockResolvedValue([
      { customerRecordId: 'a', month: '2025-09', revenue: 1000 },
      { customerRecordId: 'a', month: '2025-12', revenue: 1000 },
      { customerRecordId: 'a', month: '2026-03', revenue: 700 }
    ])

    const result = await computeVC01('org1', '2026-03')
    expect(result.computable).toBe(false)
    expect(result.data.currentQuarterGrr).toBeCloseTo(70, 1) // confirms the quarterly figures really were there
    expect(result.flag).toBeNull() // must not survive onto a "not computable" response
  })
})

describe('VC-02 (NRR) flags', () => {
  beforeEach(() => mockedGetMonthlyRevenue.mockReset())

  it('watch: NRR below 100% in the latest period only', async () => {
    mockedGetMonthlyRevenue.mockResolvedValue([
      { customerRecordId: 'a', month: '2025-09', revenue: 1000 },
      { customerRecordId: 'a', month: '2025-12', revenue: 1000 },
      { customerRecordId: 'a', month: '2026-02', revenue: 1000 },
      { customerRecordId: 'a', month: '2026-03', revenue: 950 }
    ])
    const result = await computeVC02('org1', '2026-03')
    expect(result.value).toBeCloseTo(95, 1)
    expect(result.flag?.level).toBe('watch')
  })

  it('act_now: NRR below 100% for two quarters running', async () => {
    mockedGetMonthlyRevenue.mockResolvedValue([
      { customerRecordId: 'a', month: '2025-09', revenue: 1000 }, // prior quarter start
      { customerRecordId: 'a', month: '2025-12', revenue: 900 }, // prior quarter end -> NRR 90%
      { customerRecordId: 'a', month: '2026-02', revenue: 900 },
      { customerRecordId: 'a', month: '2026-03', revenue: 850 } // this quarter: 900(Dec)->850(Mar) -> NRR ~94.4%
    ])
    const result = await computeVC02('org1', '2026-03')
    expect(result.data.previousQuarterNrr).toBeCloseTo(90, 1)
    expect(result.flag?.level).toBe('act_now')
  })
})

describe('VC-03 (New-Logo Revenue Growth Rate) — built entirely from the QuickBooks roll-forward', () => {
  beforeEach(() => mockedGetMonthlyRevenue.mockReset())

  it('act_now: growth rate itself declined two quarters running', async () => {
    mockedGetMonthlyRevenue.mockResolvedValue([
      { customerRecordId: 'c', month: '2025-09', revenue: 1000 }, // new logo in Q3-2025 -> 1000
      { customerRecordId: 'd', month: '2025-12', revenue: 1500 }, // new logo in Q4-2025 -> 1500 (growth vs Q3: +50%)
      { customerRecordId: 'e', month: '2026-03', revenue: 1600 } // new logo in Q1-2026 -> 1600 (growth vs Q4: +6.7%)
    ])

    const result = await computeVC03('org1', '2026-02')

    expect(result.computable).toBe(true)
    expect(result.data.newLogoRevenue).toBeCloseTo(1600, 0)
    expect(result.value).toBeCloseTo(6.7, 1) // (1600-1500)/1500
    expect(result.data.previousQuarterGrowthPct).toBeCloseTo(50, 0) // (1500-1000)/1000
    expect(result.flag?.level).toBe('act_now') // 6.7% growth is a decline from 50% growth
  })

  it('no flag when growth is accelerating, not declining', async () => {
    mockedGetMonthlyRevenue.mockResolvedValue([
      { customerRecordId: 'c', month: '2025-09', revenue: 1000 },
      { customerRecordId: 'd', month: '2025-12', revenue: 1100 }, // +10%
      { customerRecordId: 'e', month: '2026-03', revenue: 1500 } // +36.4% -- accelerating
    ])
    const result = await computeVC03('org1', '2026-02')
    expect(result.flag).toBeNull()
  })

  it('not computable when there was no new-logo revenue in the prior quarter to compare against', async () => {
    mockedGetMonthlyRevenue.mockResolvedValue([{ customerRecordId: 'e', month: '2026-03', revenue: 1600 }])
    const result = await computeVC03('org1', '2026-02')
    expect(result.computable).toBe(false)
    expect(result.value).toBeNull()
  })
})
