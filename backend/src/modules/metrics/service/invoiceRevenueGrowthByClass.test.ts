import { getInvoiceRevenueGrowthByClass, getInvoiceRevenueGrowthByClassDetail } from './productRevenueGrowth.service'
import { invoiceRepository } from '../../sync/repository/invoice.repository'

jest.mock('../../sync/repository/invoice.repository')

const mockedGetRevenueByClassAndMonth = invoiceRepository.getRevenueByClassAndMonth as jest.Mock
const mockedGetInvoiceLinesForClass = invoiceRepository.getInvoiceLinesForClass as jest.Mock

beforeEach(() => {
  mockedGetRevenueByClassAndMonth.mockReset()
  mockedGetInvoiceLinesForClass.mockReset()
})

describe('getInvoiceRevenueGrowthByClass', () => {
  it('groups revenue by class and computes month-over-month growth, naming each class from its own rows', async () => {
    mockedGetRevenueByClassAndMonth.mockResolvedValue([
      { classId: 'class-1', className: 'Platform', month: '2026-01', revenue: 1000 },
      { classId: 'class-1', className: 'Platform', month: '2026-02', revenue: 1100 },
      { classId: 'class-2', className: 'Services', month: '2026-01', revenue: 500 }
    ])

    const result = await getInvoiceRevenueGrowthByClass('org1', { fromYear: '2026' })

    expect(result.classes).toHaveLength(2)
    const platform = result.classes.find((c) => c.id === 'class-1')!
    expect(platform.name).toBe('Platform')
    const jan = platform.months.find((m) => m.month === '2026-01')!
    const feb = platform.months.find((m) => m.month === '2026-02')!
    expect(jan.revenue).toBe(1000)
    expect(jan.revenueGrowthPct).toBeNull()
    expect(feb.revenue).toBe(1100)
    expect(feb.revenueGrowthPct).toBe(10)

    const services = result.classes.find((c) => c.id === 'class-2')!
    expect(services.name).toBe('Services')
  })

  it('returns an empty list, not an error, when no synced invoice line has a classId (Class tracking disabled or not yet resynced)', async () => {
    mockedGetRevenueByClassAndMonth.mockResolvedValue([])

    const result = await getInvoiceRevenueGrowthByClass('org1', { fromYear: '2026' })

    expect(result).toEqual({ classes: [] })
  })

  it('sorts classes alphabetically by name', async () => {
    mockedGetRevenueByClassAndMonth.mockResolvedValue([
      { classId: 'class-2', className: 'Services', month: '2026-01', revenue: 500 },
      { classId: 'class-1', className: 'Platform', month: '2026-01', revenue: 1000 }
    ])

    const result = await getInvoiceRevenueGrowthByClass('org1', { fromYear: '2026' })

    expect(result.classes.map((c) => c.name)).toEqual(['Platform', 'Services'])
  })

  it('forwards the quickbooks provider and the fromYear-derived date range to the repository', async () => {
    mockedGetRevenueByClassAndMonth.mockResolvedValue([])

    await getInvoiceRevenueGrowthByClass('org1', { fromYear: '2024' })

    expect(mockedGetRevenueByClassAndMonth).toHaveBeenCalledWith('org1', 'quickbooks', expect.any(Date), expect.any(Date))
    const [, , from] = mockedGetRevenueByClassAndMonth.mock.calls[0]
    expect(from.toISOString().slice(0, 10)).toBe('2024-01-01')
  })
})

describe('getInvoiceRevenueGrowthByClassDetail', () => {
  it('sums invoice lines for the given class into monthly revenue', async () => {
    mockedGetInvoiceLinesForClass.mockResolvedValue([
      { providerRecordId: 'inv-1', customerRecordId: 'cust-1', customerName: 'Acme', txnDate: new Date('2026-01-15T00:00:00.000Z'), lineAmount: 300, invoiceTotalAmount: 300 },
      { providerRecordId: 'inv-2', customerRecordId: 'cust-2', customerName: null, txnDate: new Date('2026-01-20T00:00:00.000Z'), lineAmount: 200, invoiceTotalAmount: 500 }
    ])

    const result = await getInvoiceRevenueGrowthByClassDetail('org1', 'class-1', 'Platform', { fromYear: '2026' })

    expect(result.classId).toBe('class-1')
    expect(result.className).toBe('Platform')
    expect(result.lines).toHaveLength(2)
    const jan = result.months.find((m) => m.month === '2026-01')!
    expect(jan.revenue).toBe(500)
  })
})
