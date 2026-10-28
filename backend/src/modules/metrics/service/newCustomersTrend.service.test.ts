import { getNewCustomersTrend } from './newCustomersTrend.service'
import { invoiceRepository } from '../../sync/repository/invoice.repository'
import { latestClosedMonth } from './revenueRollForward.service'

jest.mock('../../sync/repository/invoice.repository')

const mockedCount = invoiceRepository.count as jest.Mock
const mockedGetNewCustomerCountsByMonth = invoiceRepository.getNewCustomerCountsByMonth as jest.Mock

beforeEach(() => {
  mockedCount.mockReset()
  mockedGetNewCustomerCountsByMonth.mockReset()
})

describe('getNewCustomersTrend', () => {
  it('returns one point per month from January of fromYear through the latest closed month, defaulting missing months to 0', async () => {
    mockedCount.mockResolvedValue(5)
    mockedGetNewCustomerCountsByMonth.mockResolvedValue([
      { month: '2026-01', count: 3, amount: 450 },
      { month: '2026-03', count: 1, amount: 100 }
      // 2026-02 deliberately missing -> must default to 0, not be dropped from the series
    ])

    const result = await getNewCustomersTrend('org1', '2026')

    expect(result.hasInvoices).toBe(true)
    const byMonth = new Map(result.points.map((p) => [p.month, p]))
    expect(byMonth.get('2026-01')!.newCustomerCount).toBe(3)
    expect(byMonth.get('2026-01')!.newCustomerAmount).toBe(450)
    expect(byMonth.get('2026-02')!.newCustomerCount).toBe(0)
    expect(byMonth.get('2026-02')!.newCustomerAmount).toBe(0)
    expect(byMonth.get('2026-03')!.newCustomerCount).toBe(1)
    expect(byMonth.get('2026-03')!.newCustomerAmount).toBe(100)
    // Series runs through the latest closed month, not just through the rows that came back.
    expect(result.points[0].month).toBe('2026-01')
    expect(result.points[result.points.length - 1].month).toBe(latestClosedMonth())
  })

  it('reports hasInvoices: false and no points when this org has never synced any invoice', async () => {
    mockedCount.mockResolvedValue(0)
    const result = await getNewCustomersTrend('org1', '2026')
    expect(result.hasInvoices).toBe(false)
    expect(result.points).toEqual([])
    expect(mockedGetNewCustomerCountsByMonth).not.toHaveBeenCalled()
  })

  it('defaults fromYear to the year latestClosedMonth falls in when omitted', async () => {
    mockedCount.mockResolvedValue(1)
    mockedGetNewCustomerCountsByMonth.mockResolvedValue([])
    const result = await getNewCustomersTrend('org1')
    expect(result.points[0].month).toBe(`${latestClosedMonth().slice(0, 4)}-01`)
  })

  it('forwards the item id so "new" narrows to customers new to that specific product', async () => {
    mockedCount.mockResolvedValue(1)
    mockedGetNewCustomerCountsByMonth.mockResolvedValue([])
    await getNewCustomersTrend('org1', '2026', 'item-42')
    expect(mockedGetNewCustomerCountsByMonth).toHaveBeenCalledWith('org1', 'quickbooks', expect.any(Date), expect.any(Date), 'item-42')
  })
})
