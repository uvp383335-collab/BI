import { QuickBooksService } from '../../integrations/service/quickbooks.service'
import { getQuickBooksAuth } from './plReport.service'
import { getProductRevenueGrowth, getQuickBooksDepartments, getQuickBooksCustomerStates } from './productRevenueGrowth.service'

jest.mock('./plReport.service', () => ({ getQuickBooksAuth: jest.fn() }))
jest.mock('../../integrations/service/quickbooks.service', () => {
  const actual = jest.requireActual('../../integrations/service/quickbooks.service')
  return {
    ...actual,
    QuickBooksService: {
      getItems: jest.fn(),
      getProfitAndLossReport: jest.fn(),
      getDepartments: jest.fn(),
      getCustomersWithBillingAddress: jest.fn()
    }
  }
})

const mockedGetAuth = getQuickBooksAuth as jest.Mock
const mockedGetItems = QuickBooksService.getItems as jest.Mock
const mockedGetPL = QuickBooksService.getProfitAndLossReport as jest.Mock
const mockedGetDepartments = QuickBooksService.getDepartments as jest.Mock
const mockedGetCustomers = QuickBooksService.getCustomersWithBillingAddress as jest.Mock

function monthlyReport(months: { label: string; revenue: number }[]) {
  return {
    Columns: { Column: [{ ColTitle: '', ColType: 'Account' }, ...months.map((m) => ({ ColTitle: m.label, ColType: 'Money' }))] },
    Rows: {
      Row: [
        {
          group: 'Income',
          Summary: { ColData: [{ value: 'Total Income' }, ...months.map((m) => ({ value: String(m.revenue) }))] }
        }
      ]
    }
  }
}

beforeEach(() => {
  mockedGetAuth.mockReset().mockResolvedValue({ accessToken: 'token', realmId: 'realm1' })
  mockedGetItems.mockReset()
  mockedGetPL.mockReset()
  mockedGetDepartments.mockReset()
  mockedGetCustomers.mockReset()
})

describe('getProductRevenueGrowth', () => {
  it('runs one Month-summarized, item-filtered report per sellable item and computes growth per product', async () => {
    mockedGetItems.mockResolvedValue({
      records: [
        { Id: '1', Name: 'Widget', Type: 'Service' },
        { Id: '2', Name: 'Discount Row', Type: 'Discount' } // non-sellable — must be skipped
      ],
      hasMore: false
    })
    mockedGetPL.mockResolvedValue(
      monthlyReport([
        { label: 'Jan 2026', revenue: 1000 },
        { label: 'Feb 2026', revenue: 1100 }
      ])
    )

    const result = await getProductRevenueGrowth('org1', {})

    expect(result.products).toHaveLength(1)
    expect(result.products[0]).toEqual({
      id: '1',
      name: 'Widget',
      months: [
        { month: 'Jan 2026', revenue: 1000, revenueGrowthPct: null },
        { month: 'Feb 2026', revenue: 1100, revenueGrowthPct: 10 }
      ]
    })
    expect(mockedGetPL).toHaveBeenCalledTimes(1)
    expect(mockedGetPL).toHaveBeenCalledWith('token', 'realm1', '2018-01-01', expect.any(String), 'Month', '1', undefined, undefined)
  })

  it('uses the given fromYear as the report start date', async () => {
    mockedGetItems.mockResolvedValue({ records: [{ Id: '1', Name: 'Widget', Type: 'Service' }], hasMore: false })
    mockedGetPL.mockResolvedValue(monthlyReport([{ label: 'Jan 2024', revenue: 500 }]))

    await getProductRevenueGrowth('org1', { fromYear: '2024' })

    expect(mockedGetPL).toHaveBeenCalledWith('token', 'realm1', '2024-01-01', expect.any(String), 'Month', '1', undefined, undefined)
  })

  it('resolves a billing-state filter to matching customer ids and forwards them as the customer param', async () => {
    mockedGetCustomers.mockResolvedValue([
      { Id: 'c1', BillAddr: { CountrySubDivisionCode: 'NJ' } },
      { Id: 'c2', BillAddr: { CountrySubDivisionCode: 'NY' } },
      { Id: 'c3', BillAddr: { CountrySubDivisionCode: 'NJ' } }
    ])
    mockedGetItems.mockResolvedValue({ records: [{ Id: '1', Name: 'Widget', Type: 'Service' }], hasMore: false })
    mockedGetPL.mockResolvedValue(monthlyReport([{ label: 'Jan 2026', revenue: 100 }]))

    await getProductRevenueGrowth('org1', { state: 'NJ', department: 'dept-1' })

    expect(mockedGetPL).toHaveBeenCalledWith('token', 'realm1', expect.any(String), expect.any(String), 'Month', '1', 'dept-1', 'c1,c3')
  })

  it('returns an empty result with a message when no customer matches the requested state', async () => {
    mockedGetCustomers.mockResolvedValue([{ Id: 'c1', BillAddr: { CountrySubDivisionCode: 'CA' } }])

    const result = await getProductRevenueGrowth('org1', { state: 'ZZ' })

    expect(result).toEqual({ products: [], failedProducts: [], message: 'No customers found with a billing address in ZZ.' })
    expect(mockedGetItems).not.toHaveBeenCalled()
  })

  it('reports a failed product without aborting the others', async () => {
    mockedGetItems.mockResolvedValue({
      records: [
        { Id: '1', Name: 'Good', Type: 'Service' },
        { Id: '2', Name: 'Bad', Type: 'Service' }
      ],
      hasMore: false
    })
    mockedGetPL.mockImplementation((_token, _realm, _start, _end, _summarize, itemId) => {
      if (itemId === '2') return Promise.reject(new Error('boom'))
      return Promise.resolve(monthlyReport([{ label: 'Jan 2026', revenue: 10 }]))
    })

    const result = await getProductRevenueGrowth('org1', {})

    expect(result.products).toEqual([{ id: '1', name: 'Good', months: [{ month: 'Jan 2026', revenue: 10, revenueGrowthPct: null }] }])
    expect(result.failedProducts).toEqual([{ id: '2', name: 'Bad', message: 'boom' }])
  })
})

describe('getQuickBooksDepartments', () => {
  it('maps QuickBooks Departments to {id, name}', async () => {
    mockedGetDepartments.mockResolvedValue([{ Id: '1', Name: 'East' }, { Id: '2', Name: 'West' }])

    const result = await getQuickBooksDepartments('org1')

    expect(result).toEqual([{ id: '1', name: 'East' }, { id: '2', name: 'West' }])
  })
})

describe('getQuickBooksCustomerStates', () => {
  it('returns the sorted, de-duplicated set of billing states', async () => {
    mockedGetCustomers.mockResolvedValue([
      { Id: 'c1', BillAddr: { CountrySubDivisionCode: 'NY' } },
      { Id: 'c2', BillAddr: { CountrySubDivisionCode: 'NJ' } },
      { Id: 'c3', BillAddr: { CountrySubDivisionCode: 'NY' } },
      { Id: 'c4', BillAddr: undefined }
    ])

    const result = await getQuickBooksCustomerStates('org1')

    expect(result).toEqual(['NJ', 'NY'])
  })
})
