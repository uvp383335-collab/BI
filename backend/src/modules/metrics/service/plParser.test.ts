import { QuickBooksReport } from '../../integrations/service/quickbooks.service'
import {
  parseProfitAndLoss,
  classifyExpenseAccount,
  sumColumn,
  sumDepreciationAndAmortization,
  sumExpensesByCategory,
  buildMonthlyRevenueGrowth
} from './plParser'

// Shaped after QuickBooks' real ProfitAndLoss report JSON: a recursive
// Rows/Summary tree keyed by `group`, single "Total" amount column.
const FIXTURE_REPORT: QuickBooksReport = {
  Columns: { Column: [{ ColTitle: '', ColType: 'Account' }, { ColTitle: 'Total', ColType: 'Money' }] },
  Rows: {
    Row: [
      {
        type: 'Section',
        group: 'Income',
        Header: { ColData: [{ value: 'Income' }] },
        Rows: {
          Row: [
            { ColData: [{ value: 'Subscription Revenue' }, { value: '80000.00' }] },
            { ColData: [{ value: 'Professional Services Revenue' }, { value: '15000.00' }] },
            { ColData: [{ value: 'Hardware Revenue' }, { value: '5000.00' }] }
          ]
        },
        Summary: { ColData: [{ value: 'Total Income' }, { value: '100000.00' }] }
      },
      {
        type: 'Section',
        group: 'COGS',
        Header: { ColData: [{ value: 'Cost of Goods Sold' }] },
        Rows: {
          Row: [
            { ColData: [{ value: 'Hosting & Infrastructure COGS' }, { value: '12000.00' }] },
            { ColData: [{ value: 'Depreciation (COGS-embedded)' }, { value: '1000.00' }] }
          ]
        },
        Summary: { ColData: [{ value: 'Total COGS' }, { value: '13000.00' }] }
      },
      { group: 'GrossProfit', Summary: { ColData: [{ value: 'Gross Profit' }, { value: '87000.00' }] } },
      {
        type: 'Section',
        group: 'Expenses',
        Header: { ColData: [{ value: 'Expenses' }] },
        Rows: {
          Row: [
            { ColData: [{ value: 'Sales & Marketing - Advertising' }, { value: '10000.00' }] },
            { ColData: [{ value: 'Sales & Marketing - Salaries' }, { value: '15000.00' }] },
            { ColData: [{ value: 'G&A - Salaries', id: '55' }, { value: '22000.00' }] },
            { ColData: [{ value: 'G&A - Rent & Facilities' }, { value: '3200.00' }] },
            { ColData: [{ value: 'Depreciation & Amortization' }, { value: '1800.00' }] }
          ]
        },
        Summary: { ColData: [{ value: 'Total Expenses' }, { value: '52000.00' }] }
      },
      { group: 'NetOperatingIncome', Summary: { ColData: [{ value: 'Net Operating Income' }, { value: '35000.00' }] } },
      { group: 'NetIncome', Summary: { ColData: [{ value: 'Net Income' }, { value: '35000.00' }] } }
    ]
  }
}

describe('parseProfitAndLoss', () => {
  it('buckets line items into their correct section', () => {
    const pl = parseProfitAndLoss(FIXTURE_REPORT)
    expect(pl.income.map((i) => i.account)).toEqual(['Subscription Revenue', 'Professional Services Revenue', 'Hardware Revenue'])
    expect(pl.cogs.map((i) => i.account)).toEqual(['Hosting & Infrastructure COGS', 'Depreciation (COGS-embedded)'])
    expect(pl.expenses).toHaveLength(5)
  })

  it('captures each leaf row\'s QuickBooks account id when the report includes one', () => {
    const pl = parseProfitAndLoss(FIXTURE_REPORT)
    expect(pl.expenses.find((i) => i.account === 'G&A - Salaries')?.accountId).toBe('55')
    // Rows with no id on ColData[0] (most of this fixture) simply have no accountId — never a guessed/fabricated one.
    expect(pl.expenses.find((i) => i.account === 'Sales & Marketing - Advertising')?.accountId).toBeUndefined()
  })

  it('captures QuickBooks\' own section subtotals', () => {
    const pl = parseProfitAndLoss(FIXTURE_REPORT)
    expect(pl.sectionTotals.Income.Total).toBe(100000)
    expect(pl.sectionTotals.COGS.Total).toBe(13000)
    expect(pl.sectionTotals.NetIncome.Total).toBe(35000)
  })

  it('sums a bucket by column', () => {
    const pl = parseProfitAndLoss(FIXTURE_REPORT)
    expect(sumColumn(pl.income, 'Total')).toBe(100000)
    expect(sumColumn(pl.cogs, 'Total')).toBe(13000)
  })
})

describe('classifyExpenseAccount', () => {
  it('classifies sales & marketing accounts', () => {
    expect(classifyExpenseAccount('Sales & Marketing - Salaries')).toBe('sales_marketing')
  })
  it('classifies D&A ahead of everything else', () => {
    expect(classifyExpenseAccount('Depreciation & Amortization')).toBe('d_and_a')
    expect(classifyExpenseAccount('Depreciation (COGS-embedded)')).toBe('d_and_a')
  })
  it('falls back to other for unrecognized accounts', () => {
    expect(classifyExpenseAccount('Miscellaneous')).toBe('other')
  })
})

describe('cross-section D&A rollup (the "D&A hiding inside COGS" case the guide warns about)', () => {
  it('finds D&A both inside COGS and inside Expenses', () => {
    const pl = parseProfitAndLoss(FIXTURE_REPORT)
    // 1000 (COGS-embedded) + 1800 (top-level Expenses) = 2800
    expect(sumDepreciationAndAmortization(pl, 'Total')).toBe(2800)
  })

  it('sums sales & marketing independently', () => {
    const pl = parseProfitAndLoss(FIXTURE_REPORT)
    expect(sumExpensesByCategory(pl, 'sales_marketing', 'Total')).toBe(25000) // 10000 + 15000
  })
})

describe('buildMonthlyRevenueGrowth', () => {
  // Shaped after a real summarize_column_by=Month report: one Income amount per month column,
  // PLUS the trailing grand-total "Total" column QuickBooks always appends to these reports.
  const MONTHLY_REPORT: QuickBooksReport = {
    Columns: {
      Column: [
        { ColTitle: '', ColType: 'Account' },
        { ColTitle: 'Jan 2026', ColType: 'Money' },
        { ColTitle: 'Feb 2026', ColType: 'Money' },
        { ColTitle: 'Mar 2026', ColType: 'Money' },
        { ColTitle: 'Total', ColType: 'Money' }
      ]
    },
    Rows: {
      Row: [
        {
          group: 'Income',
          Rows: { Row: [{ ColData: [{ value: 'Subscription Revenue' }, { value: '10000.00' }, { value: '0.00' }, { value: '12000.00' }, { value: '22000.00' }] }] },
          Summary: { ColData: [{ value: 'Total Income' }, { value: '10000.00' }, { value: '0.00' }, { value: '12000.00' }, { value: '22000.00' }] }
        }
      ]
    }
  }

  it('computes month-over-month growth %, null for the first month and after a zero-revenue month', () => {
    const pl = parseProfitAndLoss(MONTHLY_REPORT)
    const months = buildMonthlyRevenueGrowth(pl)

    expect(months).toEqual([
      { month: 'Jan 2026', revenue: 10000, revenueGrowthPct: null },
      { month: 'Feb 2026', revenue: 0, revenueGrowthPct: -100 },
      // Prior month's revenue was 0 — growth % is null (server.js's own "divide by zero" guard), not Infinity.
      { month: 'Mar 2026', revenue: 12000, revenueGrowthPct: null }
    ])
  })

  it('drops the report\'s trailing grand-total column instead of treating it as a 4th month', () => {
    const pl = parseProfitAndLoss(MONTHLY_REPORT)
    const months = buildMonthlyRevenueGrowth(pl)
    expect(months.map((m) => m.month)).toEqual(['Jan 2026', 'Feb 2026', 'Mar 2026'])
    expect(months.some((m) => m.month === 'Total')).toBe(false)
  })

  it('returns an empty array for a report with no Income section', () => {
    const pl = parseProfitAndLoss({ Columns: { Column: [{ ColTitle: '', ColType: 'Account' }, { ColTitle: 'Jan 2026', ColType: 'Money' }] }, Rows: { Row: [] } })
    expect(buildMonthlyRevenueGrowth(pl)).toEqual([{ month: 'Jan 2026', revenue: 0, revenueGrowthPct: null }])
  })
})
