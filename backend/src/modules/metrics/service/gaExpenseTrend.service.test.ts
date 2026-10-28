import { getGAndAExpenseTrend } from './gaExpenseTrend.service'
import { organizationsRepository } from '../../organizations/repository/organizations.repository'
import { plMonthlySnapshotRepository } from '../../sync/repository/plMonthlySnapshot.repository'
import * as plReportService from './plReport.service'
import * as revenueRollForward from './revenueRollForward.service'

jest.mock('../../organizations/repository/organizations.repository')
jest.mock('../../sync/repository/plMonthlySnapshot.repository')
jest.mock('./plReport.service')
jest.mock('./revenueRollForward.service', () => {
  const actual = jest.requireActual('./revenueRollForward.service')
  return { ...actual, latestClosedMonth: jest.fn(), latestClosedQuarterStart: jest.fn() }
})

const mockedFindById = organizationsRepository.findById as jest.Mock
const mockedFindAllForOrg = plMonthlySnapshotRepository.findAllForOrg as jest.Mock
const mockedGetStoredProfitAndLoss = plReportService.getStoredProfitAndLoss as jest.Mock
const mockedLatestClosedMonth = revenueRollForward.latestClosedMonth as jest.Mock
const mockedLatestClosedQuarterStart = revenueRollForward.latestClosedQuarterStart as jest.Mock

function monthlySnapshot(month: string, revenue: number, gaExpense: number) {
  return {
    month,
    income: [{ account: 'Revenue', amounts: { Total: revenue } }],
    expenses: [{ account: 'G&A - Salaries', accountId: 'acct-1', amounts: { Total: gaExpense } }],
    otherExpenses: []
  }
}

beforeEach(() => {
  mockedFindById.mockReset()
  mockedFindAllForOrg.mockReset()
  mockedGetStoredProfitAndLoss.mockReset()
  mockedLatestClosedMonth.mockReset()
  mockedLatestClosedQuarterStart.mockReset()
  mockedLatestClosedMonth.mockReturnValue('2026-06')
  mockedLatestClosedQuarterStart.mockReturnValue('2026-04')
})

describe('getGAndAExpenseTrend — no accounts configured', () => {
  it('is not computable when the org has not picked any G&A accounts yet', async () => {
    mockedFindById.mockResolvedValue({ settings: {} })

    const result = await getGAndAExpenseTrend('org1', 'quarterly')

    expect(result.hasConfiguredAccounts).toBe(false)
    expect(result.points).toEqual([])
    expect(mockedGetStoredProfitAndLoss).not.toHaveBeenCalled()
  })

  it('is not computable when gaExpenseAccountIds is an empty array', async () => {
    mockedFindById.mockResolvedValue({ settings: { gaExpenseAccountIds: [] } })

    const result = await getGAndAExpenseTrend('org1', 'monthly')

    expect(result.hasConfiguredAccounts).toBe(false)
    expect(mockedFindAllForOrg).not.toHaveBeenCalled()
  })
})

describe('getGAndAExpenseTrend — quarterly', () => {
  it('sums only the configured account ids off PLSnapshot and divides by revenue', async () => {
    mockedFindById.mockResolvedValue({ settings: { gaExpenseAccountIds: ['acct-1'] } })
    mockedGetStoredProfitAndLoss.mockResolvedValue({
      income: [{ account: 'Revenue', amounts: { Total: 10000 } }],
      expenses: [
        { account: 'G&A - Salaries', accountId: 'acct-1', amounts: { Total: 800 } },
        { account: 'Sales & Marketing - Advertising', accountId: 'acct-2', amounts: { Total: 500 } } // not configured, must be excluded
      ],
      otherExpenses: [{ account: 'G&A - Rent', accountId: 'acct-1', amounts: { Total: 200 } }]
    })

    const result = await getGAndAExpenseTrend('org1', 'quarterly')

    expect(result.hasConfiguredAccounts).toBe(true)
    expect(result.points).toHaveLength(6)
    expect(result.points[0]).toEqual({ period: '2025-01', revenue: 10000, gaExpense: 1000, gaPct: 10 })
  })

  it('skips a quarter that has not been synced yet rather than fabricating a zero point', async () => {
    mockedFindById.mockResolvedValue({ settings: { gaExpenseAccountIds: ['acct-1'] } })
    mockedGetStoredProfitAndLoss
      .mockResolvedValueOnce(null)
      .mockResolvedValue({
        income: [{ account: 'Revenue', amounts: { Total: 1000 } }],
        expenses: [{ account: 'G&A', accountId: 'acct-1', amounts: { Total: 100 } }],
        otherExpenses: []
      })

    const result = await getGAndAExpenseTrend('org1', 'quarterly')

    expect(result.points).toHaveLength(5)
  })

  it('gaPct is null when revenue is 0, never a divide-by-zero guess', async () => {
    mockedFindById.mockResolvedValue({ settings: { gaExpenseAccountIds: ['acct-1'] } })
    mockedGetStoredProfitAndLoss.mockResolvedValue({
      income: [{ account: 'Revenue', amounts: { Total: 0 } }],
      expenses: [{ account: 'G&A', accountId: 'acct-1', amounts: { Total: 100 } }],
      otherExpenses: []
    })

    const result = await getGAndAExpenseTrend('org1', 'quarterly')

    expect(result.points[0].gaPct).toBeNull()
  })
})

describe('getGAndAExpenseTrend — monthly', () => {
  it('reads the trailing 18 of the stored monthly snapshots', async () => {
    mockedFindById.mockResolvedValue({ settings: { gaExpenseAccountIds: ['acct-1'] } })
    const snapshots = Array.from({ length: 36 }, (_, i) => monthlySnapshot(`2023-${String((i % 12) + 1).padStart(2, '0')}`, 1000, 100))
    mockedFindAllForOrg.mockResolvedValue(snapshots)

    const result = await getGAndAExpenseTrend('org1', 'monthly')

    expect(result.points).toHaveLength(18)
    expect(result.points[0].revenue).toBe(1000)
    expect(result.points[0].gaExpense).toBe(100)
    expect(result.points[0].gaPct).toBe(10)
  })
})

describe('getGAndAExpenseTrend — yearly', () => {
  it('groups the 36 trailing stored months into 3 trailing 12-month chunks', async () => {
    mockedFindById.mockResolvedValue({ settings: { gaExpenseAccountIds: ['acct-1'] } })
    const months = Array.from({ length: 36 }, (_, i) => {
      const year = 2024 + Math.floor(i / 12)
      const month = (i % 12) + 1
      return `${year}-${String(month).padStart(2, '0')}`
    })
    const snapshots = months.map((month) => monthlySnapshot(month, 1000, 100))
    mockedFindAllForOrg.mockResolvedValue(snapshots)

    const result = await getGAndAExpenseTrend('org1', 'yearly')

    expect(result.points).toHaveLength(3)
    expect(result.points.map((p) => p.period)).toEqual(['2024', '2025', '2026'])
    // Each chunk is 12 months of 1000 revenue / 100 G&A -> 12000 / 1200, gaPct still 10.
    expect(result.points[0]).toEqual({ period: '2024', revenue: 12000, gaExpense: 1200, gaPct: 10 })
  })

  it('drops a trailing remainder shorter than 12 months rather than showing an incomplete year', async () => {
    mockedFindById.mockResolvedValue({ settings: { gaExpenseAccountIds: ['acct-1'] } })
    const snapshots = Array.from({ length: 14 }, (_, i) => monthlySnapshot(`2025-${String((i % 12) + 1).padStart(2, '0')}`, 1000, 100))
    mockedFindAllForOrg.mockResolvedValue(snapshots)

    const result = await getGAndAExpenseTrend('org1', 'yearly')

    expect(result.points).toHaveLength(1)
  })
})
