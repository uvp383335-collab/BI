import { QuickBooksReport } from '../../integrations/service/quickbooks.service'
import { extractSectionTotals, extractFlatReportGrandTotal } from './reportParser'

const BALANCE_SHEET_FIXTURE: QuickBooksReport = {
  Columns: { Column: [{ ColTitle: '', ColType: 'Account' }, { ColTitle: 'Total', ColType: 'Money' }] },
  Rows: {
    Row: [
      {
        type: 'Section',
        group: 'Assets',
        Rows: {
          Row: [
            {
              group: 'BankAccounts',
              Rows: { Row: [{ ColData: [{ value: 'Checking' }, { value: '250000.00' }] }] },
              Summary: { ColData: [{ value: 'Total Bank Accounts' }, { value: '250000.00' }] }
            },
            {
              group: 'AccountsReceivable',
              Rows: { Row: [{ ColData: [{ value: 'Accounts Receivable (A/R)' }, { value: '48000.00' }] }] },
              Summary: { ColData: [{ value: 'Total Accounts Receivable' }, { value: '48000.00' }] }
            }
          ]
        },
        Summary: { ColData: [{ value: 'Total Assets' }, { value: '298000.00' }] }
      }
    ]
  }
}

const CASH_FLOW_FIXTURE: QuickBooksReport = {
  Columns: { Column: [{ ColTitle: '', ColType: 'Account' }, { ColTitle: 'Total', ColType: 'Money' }] },
  Rows: {
    Row: [
      { group: 'OperatingActivities', Rows: { Row: [] }, Summary: { ColData: [{ value: 'Net cash from operating activities' }, { value: '42000.00' }] } },
      { group: 'InvestingActivities', Rows: { Row: [] }, Summary: { ColData: [{ value: 'Net cash from investing activities' }, { value: '-5000.00' }] } }
    ]
  }
}

const AGED_RECEIVABLES_FIXTURE: QuickBooksReport = {
  Columns: {
    Column: [
      { ColTitle: 'Customer', ColType: 'Account' },
      { ColTitle: 'Current', ColType: 'Money' },
      { ColTitle: '1 - 30', ColType: 'Money' },
      { ColTitle: 'Total', ColType: 'Money' }
    ]
  },
  Rows: {
    Row: [
      { ColData: [{ value: 'Acme Corp' }, { value: '1000.00' }, { value: '0.00' }, { value: '1000.00' }] },
      { ColData: [{ value: 'Beta LLC' }, { value: '500.00' }, { value: '200.00' }, { value: '700.00' }] },
      { Summary: { ColData: [{ value: 'TOTAL' }, { value: '1500.00' }, { value: '200.00' }, { value: '1700.00' }] } }
    ]
  }
}

const INVENTORY_FIXTURE: QuickBooksReport = {
  Columns: {
    Column: [
      { ColTitle: 'Item', ColType: 'Account' },
      { ColTitle: 'Qty', ColType: 'Number' },
      { ColTitle: 'Asset Value', ColType: 'Money' }
    ]
  },
  Rows: {
    Row: [
      { ColData: [{ value: 'GPS Hardware Kit' }, { value: '40' }, { value: '8000.00' }] },
      { Summary: { ColData: [{ value: 'TOTAL' }, { value: '40' }, { value: '8000.00' }] } }
    ]
  }
}

describe('extractSectionTotals', () => {
  it('collects each nested section subtotal keyed by its QuickBooks group name', () => {
    const totals = extractSectionTotals(BALANCE_SHEET_FIXTURE)
    expect(totals.BankAccounts.Total).toBe(250000)
    expect(totals.AccountsReceivable.Total).toBe(48000)
    expect(totals.Assets.Total).toBe(298000)
  })

  it('works for the Cash Flow report shape too', () => {
    const totals = extractSectionTotals(CASH_FLOW_FIXTURE)
    expect(totals.OperatingActivities.Total).toBe(42000)
    expect(totals.InvestingActivities.Total).toBe(-5000)
  })
})

describe('extractFlatReportGrandTotal', () => {
  it('finds the TOTAL row and reads the last column by default', () => {
    expect(extractFlatReportGrandTotal(AGED_RECEIVABLES_FIXTURE)).toBe(1700)
  })

  it('matches a specific column by title when the default last-column guess is wrong', () => {
    expect(extractFlatReportGrandTotal(INVENTORY_FIXTURE, 'value')).toBe(8000)
    // Without the title hint, the last column ("Asset Value") happens to be
    // correct here too, but that's not guaranteed for every report layout.
    expect(extractFlatReportGrandTotal(INVENTORY_FIXTURE)).toBe(8000)
  })

  it('returns null when no TOTAL row exists', () => {
    const empty: QuickBooksReport = { Columns: { Column: [{ ColTitle: '', ColType: 'Account' }] }, Rows: { Row: [] } }
    expect(extractFlatReportGrandTotal(empty)).toBeNull()
  })
})
