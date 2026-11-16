import type ExcelJS from 'exceljs'
import { RecurringRevenueTrendDetailResult, RecurringRevenueTrendGranularity, RecurringRevenueTrendPoint } from '../api/productRevenueGrowthApi'

interface ExportRecurringRevenueTrendDetailParams {
  granularity: RecurringRevenueTrendGranularity
  points: RecurringRevenueTrendPoint[]
  detail: RecurringRevenueTrendDetailResult
}

const HEADER_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F2937' } } as const
const HEADER_FONT = { bold: true, color: { argb: 'FFFFFFFF' } } as const

function styleHeaderRow(row: ExcelJS.Row): void {
  row.eachCell((cell) => {
    cell.fill = HEADER_FILL
    cell.font = HEADER_FONT
  })
}

const CATEGORY_LABEL: Record<'recurring' | 'non_recurring', string> = { recurring: 'Recurring', non_recurring: 'Non-recurring' }

/**
 * Builds a workbook for the "Recurring vs. non-recurring revenue VC-13"
 * chart: a summary table matching what the chart plots (both series, plus
 * each period's growth %), and the per-product revenue that rolled into
 * each bucket — read straight from the same sources the chart itself uses
 * (PLItemSnapshot for 'quarterly', synced invoice line items for 'monthly'),
 * so this always ties out exactly to what's on screen.
 */
export async function exportRecurringRevenueTrendDetailToExcel({ granularity, points, detail }: ExportRecurringRevenueTrendDetailParams): Promise<void> {
  // Loaded on demand — ExcelJS is a heavy library, and most sessions never click "export".
  const { default: ExcelJS } = await import('exceljs')
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'DriverInsights'
  workbook.created = new Date()

  const summarySheet = workbook.addWorksheet('Summary')
  summarySheet.addRow(['Recurring vs. non-recurring revenue VC-13'])
  summarySheet.addRow([granularity === 'quarterly' ? 'Trailing 6 quarters, split by how each product is categorized in Settings.' : 'Trailing 18 months, split by how each product is categorized in Settings.'])
  summarySheet.addRow([`Granularity: ${granularity}`])
  summarySheet.addRow([`Generated: ${new Date().toISOString()}`])
  summarySheet.addRow([])
  const summaryHeaderRow = summarySheet.addRow(['Period', 'Recurring revenue', 'Non-recurring revenue', 'Recurring growth %', 'Non-recurring growth %'])
  styleHeaderRow(summaryHeaderRow)
  for (const p of points) {
    summarySheet.addRow([p.period, p.recurringRevenue, p.nonRecurringRevenue, p.recurringGrowthPct, p.nonRecurringGrowthPct])
  }
  summarySheet.columns = [{ width: 12 }, { width: 20 }, { width: 24 }, { width: 20 }, { width: 24 }]

  const detailSheet = workbook.addWorksheet('Product Detail')
  detailSheet.columns = [
    { header: 'Period', key: 'period', width: 12 },
    { header: 'Product', key: 'productName', width: 32 },
    { header: 'Category', key: 'category', width: 16 },
    { header: 'Revenue', key: 'revenue', width: 18 }
  ]
  styleHeaderRow(detailSheet.getRow(1))
  for (const row of detail.rows) {
    detailSheet.addRow({ period: row.period, productName: row.productName, category: CATEGORY_LABEL[row.category], revenue: row.revenue })
  }

  const invoiceSheet = workbook.addWorksheet('Invoice Detail')
  invoiceSheet.addRow(['Every QuickBooks invoice line (for a categorized product) imported in this window.'])
  invoiceSheet.addRow(
    granularity === 'quarterly'
      ? ['Quarterly totals above come from QuickBooks’ own accrual P&L snapshot, not these invoices directly — amounts here may not sum to the exact same totals (different recognition timing, and P&L can include non-invoice documents like credit memos or journal entries).']
      : ['Monthly totals above are summed from these same invoice lines, so they always tie out exactly.']
  )
  invoiceSheet.addRow([])
  const invoiceHeaderRow = invoiceSheet.addRow(['Invoice date', 'Invoice ID', 'Customer', 'Product', 'Category', 'Line amount', 'Invoice total'])
  styleHeaderRow(invoiceHeaderRow)
  for (const line of detail.invoiceLines) {
    invoiceSheet.addRow([line.txnDate, line.invoiceId, line.customerName ?? '(unknown customer)', line.productName, CATEGORY_LABEL[line.category], line.lineAmount, line.invoiceTotalAmount])
  }
  invoiceSheet.columns = [{ width: 14 }, { width: 16 }, { width: 28 }, { width: 28 }, { width: 16 }, { width: 14 }, { width: 14 }]

  const buffer = await workbook.xlsx.writeBuffer()
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `recurring-vs-non-recurring-revenue-${granularity}-detail.xlsx`
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}
