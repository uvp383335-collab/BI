import { getCustomerUpgradesTrend } from './customerUpgradesTrend.service'
import { invoiceRepository } from '../../sync/repository/invoice.repository'
import { productRepository } from '../../sync/repository/product.repository'
import { latestClosedMonth } from './revenueRollForward.service'

jest.mock('../../sync/repository/invoice.repository')
jest.mock('../../sync/repository/product.repository')

const mockedFindCategorizedForOrg = productRepository.findCategorizedForOrg as jest.Mock
const mockedGetCustomerRevenueByMonthForItem = invoiceRepository.getCustomerRevenueByMonthForItem as jest.Mock
const mockedGetRecurringRevenueByCustomerAndMonth = invoiceRepository.getRecurringRevenueByCustomerAndMonth as jest.Mock

beforeEach(() => {
  mockedFindCategorizedForOrg.mockReset()
  mockedGetCustomerRevenueByMonthForItem.mockReset()
  mockedGetRecurringRevenueByCustomerAndMonth.mockReset()
})

describe('getCustomerUpgradesTrend', () => {
  it('is not computable when no item is given and no product is eligible to blend ("All products")', async () => {
    mockedFindCategorizedForOrg.mockResolvedValue([{ providerRecordId: 'item-1', category: 'recurring', billingFrequency: 'yearly' }]) // wrong frequency for 'monthly'
    const result = await getCustomerUpgradesTrend('org1', undefined, 'monthly')
    expect(result.hasData).toBe(false)
    expect(result.points).toEqual([])
    expect(mockedGetRecurringRevenueByCustomerAndMonth).not.toHaveBeenCalled()
  })

  it('is not computable when the product is not categorized recurring', async () => {
    mockedFindCategorizedForOrg.mockResolvedValue([{ providerRecordId: 'item-1', category: 'non_recurring' }])
    const result = await getCustomerUpgradesTrend('org1', 'item-1', 'monthly')
    expect(result.hasData).toBe(false)
  })

  it('is not computable when the product\'s billing frequency does not match the requested granularity', async () => {
    mockedFindCategorizedForOrg.mockResolvedValue([{ providerRecordId: 'item-1', category: 'recurring', billingFrequency: 'yearly' }])
    const result = await getCustomerUpgradesTrend('org1', 'item-1', 'monthly') // monthly view needs a monthly-billed product
    expect(result.hasData).toBe(false)
    expect(mockedGetCustomerRevenueByMonthForItem).not.toHaveBeenCalled()
  })

  it('counts a customer whose bill went from $100 to $115 as an upgrade (monthly)', async () => {
    mockedFindCategorizedForOrg.mockResolvedValue([{ providerRecordId: 'item-1', category: 'recurring', billingFrequency: 'monthly' }])
    const latestMonth = latestClosedMonth()
    const [year, mo] = latestMonth.split('-').map(Number)
    const priorMonth = mo === 1 ? `${year - 1}-12` : `${year}-${String(mo - 1).padStart(2, '0')}`

    mockedGetCustomerRevenueByMonthForItem.mockResolvedValue([
      { customerRecordId: 'abc', month: priorMonth, revenue: 100 },
      { customerRecordId: 'abc', month: latestMonth, revenue: 115 },
      // a flat customer (no change) and a downgrade — neither should count as an upgrade
      { customerRecordId: 'flat', month: priorMonth, revenue: 50 },
      { customerRecordId: 'flat', month: latestMonth, revenue: 50 },
      { customerRecordId: 'down', month: priorMonth, revenue: 200 },
      { customerRecordId: 'down', month: latestMonth, revenue: 150 }
    ])

    const result = await getCustomerUpgradesTrend('org1', 'item-1', 'monthly')

    expect(result.hasData).toBe(true)
    expect(result.points).toHaveLength(12)
    const lastPoint = result.points[result.points.length - 1]
    expect(lastPoint.period).toBe(latestMonth)
    expect(lastPoint.upgradeCount).toBe(1)
    expect(lastPoint.upgradeAmount).toBe(15) // only the $100->$115 upgrade counts toward the amount, not the downgrade or the flat customer
    expect(lastPoint.downgradeCount).toBe(1)
    expect(lastPoint.downgradeAmount).toBe(50) // the $200->$150 customer, not the flat one or the upgrade
    expect(lastPoint.churnCount).toBe(0)
    expect(lastPoint.churnAmount).toBe(0)
    // starting revenue = 100 (abc) + 50 (flat) + 200 (down) = 350
    expect(lastPoint.startingRevenue).toBe(350)
    expect(lastPoint.grrPct).toBeCloseTo(((350 - 50) / 350) * 100, 2) // ~85.71% — downgrade hurts GRR, upgrade doesn't help it
    expect(lastPoint.nrrPct).toBeCloseTo(((350 - 50 + 15) / 350) * 100, 2) // 90% — NRR gives the upgrade credit back
  })

  it('never counts a brand-new customer\'s first bill as an upgrade', async () => {
    mockedFindCategorizedForOrg.mockResolvedValue([{ providerRecordId: 'item-1', category: 'recurring', billingFrequency: 'monthly' }])
    const latestMonth = latestClosedMonth()
    mockedGetCustomerRevenueByMonthForItem.mockResolvedValue([
      { customerRecordId: 'brand-new', month: latestMonth, revenue: 500 } // nothing in the prior month
    ])

    const result = await getCustomerUpgradesTrend('org1', 'item-1', 'monthly')
    const lastPoint = result.points[result.points.length - 1]
    expect(lastPoint.upgradeCount).toBe(0)
    expect(lastPoint.upgradeAmount).toBe(0)
  })

  it('sums every upgrading customer\'s increase into upgradeAmount, independent of the count', async () => {
    mockedFindCategorizedForOrg.mockResolvedValue([{ providerRecordId: 'item-1', category: 'recurring', billingFrequency: 'monthly' }])
    const latestMonth = latestClosedMonth()
    const [year, mo] = latestMonth.split('-').map(Number)
    const priorMonth = mo === 1 ? `${year - 1}-12` : `${year}-${String(mo - 1).padStart(2, '0')}`

    mockedGetCustomerRevenueByMonthForItem.mockResolvedValue([
      { customerRecordId: 'abc', month: priorMonth, revenue: 100 },
      { customerRecordId: 'abc', month: latestMonth, revenue: 115 }, // +15
      { customerRecordId: 'def', month: priorMonth, revenue: 200 },
      { customerRecordId: 'def', month: latestMonth, revenue: 260 } // +60
    ])

    const result = await getCustomerUpgradesTrend('org1', 'item-1', 'monthly')
    const lastPoint = result.points[result.points.length - 1]
    expect(lastPoint.upgradeCount).toBe(2)
    expect(lastPoint.upgradeAmount).toBe(75)
  })

  it('counts a full cancellation (bill drops to $0) as churn, not a downgrade', async () => {
    mockedFindCategorizedForOrg.mockResolvedValue([{ providerRecordId: 'item-1', category: 'recurring', billingFrequency: 'monthly' }])
    const latestMonth = latestClosedMonth()
    const [year, mo] = latestMonth.split('-').map(Number)
    const priorMonth = mo === 1 ? `${year - 1}-12` : `${year}-${String(mo - 1).padStart(2, '0')}`

    mockedGetCustomerRevenueByMonthForItem.mockResolvedValue([
      { customerRecordId: 'cancelled', month: priorMonth, revenue: 80 }
      // no row at all for latestMonth -> current revenue is implicitly 0
    ])

    const result = await getCustomerUpgradesTrend('org1', 'item-1', 'monthly')
    const lastPoint = result.points[result.points.length - 1]
    expect(lastPoint.churnCount).toBe(1)
    expect(lastPoint.churnAmount).toBe(80)
    expect(lastPoint.downgradeCount).toBe(0) // mutually exclusive from churn — not double-counted
    expect(lastPoint.downgradeAmount).toBe(0)
    expect(lastPoint.upgradeCount).toBe(0)
  })

  it('counts a partial decrease that stays above $0 as a downgrade, not churn', async () => {
    mockedFindCategorizedForOrg.mockResolvedValue([{ providerRecordId: 'item-1', category: 'recurring', billingFrequency: 'monthly' }])
    const latestMonth = latestClosedMonth()
    const [year, mo] = latestMonth.split('-').map(Number)
    const priorMonth = mo === 1 ? `${year - 1}-12` : `${year}-${String(mo - 1).padStart(2, '0')}`

    mockedGetCustomerRevenueByMonthForItem.mockResolvedValue([
      { customerRecordId: 'down', month: priorMonth, revenue: 200 },
      { customerRecordId: 'down', month: latestMonth, revenue: 150 }
    ])

    const result = await getCustomerUpgradesTrend('org1', 'item-1', 'monthly')
    const lastPoint = result.points[result.points.length - 1]
    expect(lastPoint.downgradeCount).toBe(1)
    expect(lastPoint.downgradeAmount).toBe(50)
    expect(lastPoint.churnCount).toBe(0)
    expect(lastPoint.churnAmount).toBe(0)
  })

  it('sums every churned customer\'s full prior revenue into churnAmount, independent of the count', async () => {
    mockedFindCategorizedForOrg.mockResolvedValue([{ providerRecordId: 'item-1', category: 'recurring', billingFrequency: 'monthly' }])
    const latestMonth = latestClosedMonth()
    const [year, mo] = latestMonth.split('-').map(Number)
    const priorMonth = mo === 1 ? `${year - 1}-12` : `${year}-${String(mo - 1).padStart(2, '0')}`

    mockedGetCustomerRevenueByMonthForItem.mockResolvedValue([
      { customerRecordId: 'gone1', month: priorMonth, revenue: 80 },
      { customerRecordId: 'gone2', month: priorMonth, revenue: 120 }
      // neither has a row for latestMonth -> both fully churned
    ])

    const result = await getCustomerUpgradesTrend('org1', 'item-1', 'monthly')
    const lastPoint = result.points[result.points.length - 1]
    expect(lastPoint.churnCount).toBe(2)
    expect(lastPoint.churnAmount).toBe(200)
  })

  it('grrPct and nrrPct are null when nobody had revenue to retain (no starting revenue)', async () => {
    mockedFindCategorizedForOrg.mockResolvedValue([{ providerRecordId: 'item-1', category: 'recurring', billingFrequency: 'monthly' }])
    const latestMonth = latestClosedMonth()
    mockedGetCustomerRevenueByMonthForItem.mockResolvedValue([
      { customerRecordId: 'brand-new', month: latestMonth, revenue: 500 } // nothing in the prior month -> startingRevenue is 0
    ])

    const result = await getCustomerUpgradesTrend('org1', 'item-1', 'monthly')
    const lastPoint = result.points[result.points.length - 1]
    expect(lastPoint.startingRevenue).toBe(0)
    expect(lastPoint.grrPct).toBeNull()
    expect(lastPoint.nrrPct).toBeNull()
  })

  it('NRR can exceed 100% when expansion outweighs losses; GRR never gives expansion credit', async () => {
    mockedFindCategorizedForOrg.mockResolvedValue([{ providerRecordId: 'item-1', category: 'recurring', billingFrequency: 'monthly' }])
    const latestMonth = latestClosedMonth()
    const [year, mo] = latestMonth.split('-').map(Number)
    const priorMonth = mo === 1 ? `${year - 1}-12` : `${year}-${String(mo - 1).padStart(2, '0')}`

    mockedGetCustomerRevenueByMonthForItem.mockResolvedValue([
      { customerRecordId: 'big-upgrade', month: priorMonth, revenue: 100 },
      { customerRecordId: 'big-upgrade', month: latestMonth, revenue: 180 } // +80, dwarfing the loss below
    ])

    const result = await getCustomerUpgradesTrend('org1', 'item-1', 'monthly')
    const lastPoint = result.points[result.points.length - 1]
    expect(lastPoint.startingRevenue).toBe(100)
    expect(lastPoint.grrPct).toBe(100) // no downgrade/churn this period -> GRR is a flat 100%
    expect(lastPoint.nrrPct).toBe(180) // (100 - 0 - 0 + 80) / 100 * 100
  })

  it('computes a year-over-year trend for the annually granularity, requiring a yearly-billed product', async () => {
    mockedFindCategorizedForOrg.mockResolvedValue([{ providerRecordId: 'item-1', category: 'recurring', billingFrequency: 'yearly' }])
    const latestYear = Number(latestClosedMonth().slice(0, 4))
    const priorYear = latestYear - 1

    mockedGetCustomerRevenueByMonthForItem.mockResolvedValue([
      { customerRecordId: 'abc', month: `${priorYear}-06`, revenue: 1000 },
      { customerRecordId: 'abc', month: `${latestYear}-06`, revenue: 1200 }
    ])

    const result = await getCustomerUpgradesTrend('org1', 'item-1', 'annually')

    expect(result.hasData).toBe(true)
    expect(result.points).toHaveLength(3)
    const lastPoint = result.points[result.points.length - 1]
    expect(lastPoint.period).toBe(String(latestYear))
    expect(lastPoint.upgradeCount).toBe(1)
    expect(lastPoint.upgradeAmount).toBe(200)
    expect(lastPoint.downgradeCount).toBe(0)
    expect(lastPoint.downgradeAmount).toBe(0)
  })

  describe('"All products" (no item given, blended across every eligible recurring product)', () => {
    it('reads the blended org-wide aggregation instead of the per-item one, and requires only one eligible product to exist', async () => {
      mockedFindCategorizedForOrg.mockResolvedValue([
        { providerRecordId: 'item-1', category: 'recurring', billingFrequency: 'monthly' },
        { providerRecordId: 'item-2', category: 'recurring', billingFrequency: 'yearly' } // ineligible for the 'monthly' view below
      ])
      mockedGetRecurringRevenueByCustomerAndMonth.mockResolvedValue([])

      const result = await getCustomerUpgradesTrend('org1', undefined, 'monthly')

      expect(result.hasData).toBe(true)
      expect(mockedGetCustomerRevenueByMonthForItem).not.toHaveBeenCalled()
      expect(mockedGetRecurringRevenueByCustomerAndMonth).toHaveBeenCalledWith('org1', 'quickbooks', expect.any(Date), expect.any(Date), 'monthly')
    })

    it('blends a customer\'s combined spend across every eligible product into one upgrade/GRR/NRR calculation', async () => {
      mockedFindCategorizedForOrg.mockResolvedValue([
        { providerRecordId: 'item-1', category: 'recurring', billingFrequency: 'monthly' },
        { providerRecordId: 'item-2', category: 'recurring', billingFrequency: 'monthly' }
      ])
      const latestMonth = latestClosedMonth()
      const [year, mo] = latestMonth.split('-').map(Number)
      const priorMonth = mo === 1 ? `${year - 1}-12` : `${year}-${String(mo - 1).padStart(2, '0')}`

      // getRecurringRevenueByCustomerAndMonth already sums across both products per customer per month
      // (that's the backend aggregation's job) — this mock stands in for its already-combined output.
      mockedGetRecurringRevenueByCustomerAndMonth.mockResolvedValue([
        { customerRecordId: 'abc', month: priorMonth, revenue: 150 }, // item-1's 100 + item-2's 50
        { customerRecordId: 'abc', month: latestMonth, revenue: 180 } // item-1's 100 + item-2's 80 -> combined upgrade of +30
      ])

      const result = await getCustomerUpgradesTrend('org1', undefined, 'monthly')
      const lastPoint = result.points[result.points.length - 1]
      expect(lastPoint.upgradeCount).toBe(1)
      expect(lastPoint.upgradeAmount).toBe(30)
      expect(lastPoint.startingRevenue).toBe(150)
      expect(lastPoint.grrPct).toBe(100)
      expect(lastPoint.nrrPct).toBeCloseTo(120, 2)
    })
  })
})
