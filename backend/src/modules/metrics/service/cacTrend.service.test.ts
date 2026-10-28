import { getCACTrend } from './cacTrend.service'
import { organizationsRepository } from '../../organizations/repository/organizations.repository'
import { plMonthlySnapshotRepository } from '../../sync/repository/plMonthlySnapshot.repository'
import { invoiceRepository } from '../../sync/repository/invoice.repository'

jest.mock('../../organizations/repository/organizations.repository')
jest.mock('../../sync/repository/plMonthlySnapshot.repository')
jest.mock('../../sync/repository/invoice.repository')

const mockedFindById = organizationsRepository.findById as jest.Mock
const mockedFindAllForOrg = plMonthlySnapshotRepository.findAllForOrg as jest.Mock
const mockedGetNewCustomerCountsByMonth = invoiceRepository.getNewCustomerCountsByMonth as jest.Mock

function monthlySnapshot(month: string, expense: number) {
  return {
    month,
    income: [{ account: 'Revenue', amounts: { Total: 1000 } }],
    expenses: [{ account: 'Marketing', accountId: 'acct-1', amounts: { Total: expense } }],
    otherExpenses: []
  }
}

beforeEach(() => {
  mockedFindById.mockReset()
  mockedFindAllForOrg.mockReset()
  mockedGetNewCustomerCountsByMonth.mockReset()
  mockedGetNewCustomerCountsByMonth.mockResolvedValue([])
})

describe('getCACTrend — not configured', () => {
  it('is not computable when no accounts are picked', async () => {
    mockedFindById.mockResolvedValue({ settings: { cacDurationMonths: 2 } })

    const result = await getCACTrend('org1')

    expect(result.hasConfiguredSettings).toBe(false)
    expect(result.points).toEqual([])
    expect(mockedFindAllForOrg).not.toHaveBeenCalled()
  })

  it('is not computable when no duration is picked', async () => {
    mockedFindById.mockResolvedValue({ settings: { cacExpenseAccountIds: ['acct-1'] } })

    const result = await getCACTrend('org1')

    expect(result.hasConfiguredSettings).toBe(false)
  })

  it('is configured but empty when nothing has synced yet', async () => {
    mockedFindById.mockResolvedValue({ settings: { cacExpenseAccountIds: ['acct-1'], cacDurationMonths: 2 } })
    mockedFindAllForOrg.mockResolvedValue([])

    const result = await getCACTrend('org1')

    expect(result.hasConfiguredSettings).toBe(true)
    expect(result.points).toEqual([])
  })
})

describe('getCACTrend — duration=1', () => {
  it('produces one non-overlapping window per month', async () => {
    mockedFindById.mockResolvedValue({ settings: { cacExpenseAccountIds: ['acct-1'], cacDurationMonths: 1 } })
    mockedFindAllForOrg.mockResolvedValue([monthlySnapshot('2026-01', 1000), monthlySnapshot('2026-02', 1000)])
    mockedGetNewCustomerCountsByMonth.mockResolvedValue([
      { month: '2026-01', count: 10, amount: 0 },
      { month: '2026-02', count: 20, amount: 0 }
    ])

    const result = await getCACTrend('org1')

    expect(result.points).toEqual([
      { periodStart: '2026-01', periodEnd: '2026-01', expense: 1000, newCustomers: 10, cac: 100 },
      { periodStart: '2026-02', periodEnd: '2026-02', expense: 1000, newCustomers: 20, cac: 50 }
    ])
  })
})

describe('getCACTrend — duration=2', () => {
  it('sums non-overlapping 2-month windows (Jan+Feb, then Mar+Apr), never a sliding Feb+Mar window', async () => {
    mockedFindById.mockResolvedValue({ settings: { cacExpenseAccountIds: ['acct-1'], cacDurationMonths: 2 } })
    mockedFindAllForOrg.mockResolvedValue([
      monthlySnapshot('2026-01', 400),
      monthlySnapshot('2026-02', 600),
      monthlySnapshot('2026-03', 300),
      monthlySnapshot('2026-04', 700)
    ])
    mockedGetNewCustomerCountsByMonth.mockResolvedValue([
      { month: '2026-01', count: 40, amount: 0 },
      { month: '2026-02', count: 60, amount: 0 },
      { month: '2026-03', count: 30, amount: 0 },
      { month: '2026-04', count: 70, amount: 0 }
    ])

    const result = await getCACTrend('org1')

    expect(result.points).toHaveLength(2)
    expect(result.points[0]).toEqual({ periodStart: '2026-01', periodEnd: '2026-02', expense: 1000, newCustomers: 100, cac: 10 })
    expect(result.points[1]).toEqual({ periodStart: '2026-03', periodEnd: '2026-04', expense: 1000, newCustomers: 100, cac: 10 })
  })

  it('drops a trailing (oldest) remainder shorter than the duration', async () => {
    mockedFindById.mockResolvedValue({ settings: { cacExpenseAccountIds: ['acct-1'], cacDurationMonths: 2 } })
    mockedFindAllForOrg.mockResolvedValue([monthlySnapshot('2026-01', 100), monthlySnapshot('2026-02', 100), monthlySnapshot('2026-03', 100)])
    mockedGetNewCustomerCountsByMonth.mockResolvedValue([{ month: '2026-03', count: 5, amount: 0 }])

    const result = await getCACTrend('org1')

    // Only Feb+Mar forms a complete window; the lone leading Jan is dropped, not shown as a half-window.
    expect(result.points).toHaveLength(1)
    expect(result.points[0]).toEqual({ periodStart: '2026-02', periodEnd: '2026-03', expense: 200, newCustomers: 5, cac: 40 })
  })

  it('cac is null when a window has 0 new customers, never a divide-by-zero guess', async () => {
    mockedFindById.mockResolvedValue({ settings: { cacExpenseAccountIds: ['acct-1'], cacDurationMonths: 2 } })
    mockedFindAllForOrg.mockResolvedValue([monthlySnapshot('2026-01', 500), monthlySnapshot('2026-02', 500)])
    mockedGetNewCustomerCountsByMonth.mockResolvedValue([])

    const result = await getCACTrend('org1')

    expect(result.points[0].cac).toBeNull()
    expect(result.points[0].newCustomers).toBe(0)
  })
})
