import { getRecurringRevenueTrend } from './recurringRevenueTrend.service'
import { productRepository } from '../../sync/repository/product.repository'
import { plItemSnapshotRepository } from '../../sync/repository/plItemSnapshot.repository'
import { invoiceRepository } from '../../sync/repository/invoice.repository'

jest.mock('../../sync/repository/product.repository')
jest.mock('../../sync/repository/plItemSnapshot.repository')
jest.mock('../../sync/repository/invoice.repository')

const mockedFindCategorizedForOrg = productRepository.findCategorizedForOrg as jest.Mock
const mockedFindAllForQuarter = plItemSnapshotRepository.findAllForQuarter as jest.Mock
const mockedGetRevenueByCategoryAndMonth = invoiceRepository.getRevenueByCategoryAndMonth as jest.Mock
const mockedHasAnyLineItems = invoiceRepository.hasAnyLineItems as jest.Mock

beforeEach(() => {
  mockedFindCategorizedForOrg.mockReset()
  mockedFindAllForQuarter.mockReset()
  mockedGetRevenueByCategoryAndMonth.mockReset()
  mockedHasAnyLineItems.mockReset()
  // Monthly tests assume backfilled invoice data unless a test says otherwise.
  mockedHasAnyLineItems.mockResolvedValue(true)
})

describe('getRecurringRevenueTrend — quarterly (default)', () => {
  it('returns the trailing 6 quarters, oldest to newest, with growth computed against the prior point', async () => {
    mockedFindCategorizedForOrg.mockResolvedValue([
      { providerRecordId: 'sub-item', category: 'recurring', billingFrequency: 'monthly' },
      { providerRecordId: 'svc-item', category: 'non_recurring' }
    ])

    // 6 quarters' worth of snapshots, recurring item growing steadily, non-recurring item flat.
    const recurringAmounts = [1000, 1100, 1200, 1300, 1400, 1500]
    const nonRecurringAmounts = [500, 500, 500, 500, 500, 500]
    for (let i = 0; i < 6; i++) {
      mockedFindAllForQuarter.mockResolvedValueOnce([
        { itemId: 'sub-item', income: [{ account: 'Subscription Revenue', amounts: { Total: recurringAmounts[i] } }] },
        { itemId: 'svc-item', income: [{ account: 'Professional Services Revenue', amounts: { Total: nonRecurringAmounts[i] } }] }
      ])
    }

    const result = await getRecurringRevenueTrend('org1')

    expect(result.hasCategorizedProducts).toBe(true)
    expect(result.needsResync).toBe(false)
    expect(result.points).toHaveLength(6)
    expect(mockedGetRevenueByCategoryAndMonth).not.toHaveBeenCalled()

    // Strictly increasing "YYYY-MM" period strings (lexicographic == chronological for this format).
    for (let i = 1; i < result.points.length; i++) {
      expect(result.points[i].period > result.points[i - 1].period).toBe(true)
    }

    expect(result.points[0].recurringRevenue).toBe(1000)
    expect(result.points[0].recurringGrowthPct).toBeNull() // no prior quarter to compare
    expect(result.points[0].nonRecurringGrowthPct).toBeNull()

    expect(result.points[1].recurringRevenue).toBe(1100)
    expect(result.points[1].recurringGrowthPct).toBeCloseTo(10, 1) // 1000 -> 1100
    expect(result.points[1].nonRecurringRevenue).toBe(500)
    expect(result.points[1].nonRecurringGrowthPct).toBeCloseTo(0, 1) // flat

    expect(result.points[5].recurringRevenue).toBe(1500)
    expect(result.points[5].recurringGrowthPct).toBeCloseTo(((1500 - 1400) / 1400) * 100, 1)
  })

  it('returns no points when the org has not categorized any product yet (never fabricates a zero trend)', async () => {
    mockedFindCategorizedForOrg.mockResolvedValue([])
    const result = await getRecurringRevenueTrend('org1')
    expect(result.hasCategorizedProducts).toBe(false)
    expect(result.needsResync).toBe(false)
    expect(result.points).toEqual([])
    expect(mockedFindAllForQuarter).not.toHaveBeenCalled()
    expect(mockedGetRevenueByCategoryAndMonth).not.toHaveBeenCalled()
  })
})

describe('getRecurringRevenueTrend — monthly', () => {
  it('returns the trailing 18 months, oldest to newest, reading invoice lines instead of PLItemSnapshot', async () => {
    mockedFindCategorizedForOrg.mockResolvedValue([{ providerRecordId: 'sub-item', category: 'recurring', billingFrequency: 'monthly' }])
    mockedGetRevenueByCategoryAndMonth.mockResolvedValue([])

    const result = await getRecurringRevenueTrend('org1', 'monthly')

    expect(result.hasCategorizedProducts).toBe(true)
    expect(result.points).toHaveLength(18)
    expect(mockedFindAllForQuarter).not.toHaveBeenCalled()
    expect(mockedGetRevenueByCategoryAndMonth).toHaveBeenCalledTimes(1)
    for (let i = 1; i < result.points.length; i++) {
      expect(result.points[i].period > result.points[i - 1].period).toBe(true)
    }
  })

  it('defaults a month with no invoices to 0 rather than dropping it, and computes month-over-month growth', async () => {
    mockedFindCategorizedForOrg.mockResolvedValue([{ providerRecordId: 'sub-item', category: 'recurring' }])

    // Figure out which months the implementation actually built (relative to "today") by probing it first.
    mockedGetRevenueByCategoryAndMonth.mockResolvedValueOnce([])
    const probe = await getRecurringRevenueTrend('org1', 'monthly')
    const firstMonth = probe.points[0].period
    const lastMonth = probe.points[probe.points.length - 1].period
    expect(probe.points.every((p) => p.recurringRevenue === 0 && p.nonRecurringRevenue === 0)).toBe(true)

    mockedGetRevenueByCategoryAndMonth.mockResolvedValueOnce([
      { month: firstMonth, category: 'recurring', revenue: 1000 },
      { month: lastMonth, category: 'recurring', revenue: 1200 }
    ])
    const result = await getRecurringRevenueTrend('org1', 'monthly')
    expect(result.points[0].recurringRevenue).toBe(1000)
    expect(result.points[result.points.length - 1].recurringRevenue).toBe(1200)
    // every month in between had no invoices this run -> defaults to 0, not dropped from the series
    expect(result.points).toHaveLength(18)
  })

  it('reports needsResync instead of a near-empty trend when this org\'s invoices predate the `lines` field', async () => {
    mockedFindCategorizedForOrg.mockResolvedValue([{ providerRecordId: 'sub-item', category: 'recurring', billingFrequency: 'monthly' }])
    mockedHasAnyLineItems.mockResolvedValue(false)

    const result = await getRecurringRevenueTrend('org1', 'monthly')

    expect(result.hasCategorizedProducts).toBe(true)
    expect(result.needsResync).toBe(true)
    expect(result.points).toEqual([])
    expect(mockedGetRevenueByCategoryAndMonth).not.toHaveBeenCalled()
  })
})
