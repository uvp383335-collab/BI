import type ExcelJS from 'exceljs'
import { ProductRevenueGrowthDetailResult, ProductRevenueGrowthOptions } from '../api/productRevenueGrowthApi'

interface ExportProductRevenueGrowthDetailParams {
  options: ProductRevenueGrowthOptions
  detail: ProductRevenueGrowthDetailResult
}

const HEADER_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F2937' } } as const
const HEADER_FONT = { bold: true, color: { argb: 'FFFFFFFF' } } as const

function styleHeaderRow(row: ExcelJS.Row): void {
  row.eachCell((cell) => {
    cell.fill = HEADER_FILL
    cell.font = HEADER_FONT
  })
}

const round2 = (n: number): number => Math.round(n * 100) / 100

/**
 * Builds a workbook for one product's "Revenue growth by product" series:
 * a monthly reconciliation table (QuickBooks' own live P&L revenue next to
 * the sum of locally-synced invoice lines, so a mismatch is visible at a
 * glance) and every individual invoice line behind the synced-invoice-total
 * column, for line-by-line verification against QuickBooks. The two revenue
 * columns are NOT guaranteed to match exactly — see the caveat row and
 * `detail.caveat` for why — but a close, consistent match is itself the
 * evidence the calculation is reading the right data.
 */
export async function exportProductRevenueGrowthDetailToExcel({ options, detail }: ExportProductRevenueGrowthDetailParams): Promise<void> {
  // Loaded on demand — ExcelJS is a heavy library, and most sessions never click "export".
  const { default: ExcelJS } = await import('exceljs')
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'DriverInsights'
  workbook.created = new Date()

  const summarySheet = workbook.addWorksheet('Summary')
  summarySheet.addRow([`Revenue growth by product: ${detail.productName}`])
  summarySheet.addRow(['QuickBooks revenue is fetched live from that product\'s own Profit & Loss report (accrual basis) — the same number the chart shows.'])
  summarySheet.addRow(['Synced invoice total is the sum of locally-synced Invoice line items for this product — the closest local, invoice-level data, for drill-down verification.'])
  summarySheet.addRow([`Product ID: ${detail.productId}`])
  summarySheet.addRow([`From year: ${options.fromYear ?? '2018'}`, `Department filter: ${options.department ?? 'All'}`, `State filter: ${options.state ?? 'All'}`])
  summarySheet.addRow([`Generated: ${new Date().toISOString()}`])
  if (detail.caveat) {
    summarySheet.addRow([`Caveat: ${detail.caveat}`])
  }
  summarySheet.addRow([])
  const summaryHeaderRow = summarySheet.addRow(['Month', 'QuickBooks column', 'QuickBooks revenue', 'QuickBooks growth %', 'Synced invoice total', 'Difference'])
  styleHeaderRow(summaryHeaderRow)
  for (const m of detail.months) {
    summarySheet.addRow([m.month, m.quickbooksColumnLabel, m.quickbooksRevenue, m.quickbooksRevenueGrowthPct, m.syncedInvoiceTotal, round2(m.quickbooksRevenue - m.syncedInvoiceTotal)])
  }
  summarySheet.columns = [{ width: 12 }, { width: 16 }, { width: 18 }, { width: 18 }, { width: 18 }, { width: 14 }]

  const detailSheet = workbook.addWorksheet('Invoice Line Detail')
  detailSheet.columns = [
    { header: 'Invoice #', key: 'providerRecordId', width: 16 },
    { header: 'Customer', key: 'customerName', width: 28 },
    { header: 'Customer ID', key: 'customerRecordId', width: 16 },
    { header: 'Invoice date', key: 'txnDate', width: 14 },
    { header: 'Line amount (this product)', key: 'lineAmount', width: 22 },
    { header: 'Invoice total amount', key: 'invoiceTotalAmount', width: 18 }
  ]
  styleHeaderRow(detailSheet.getRow(1))
  for (const line of detail.lines) {
    detailSheet.addRow({
      providerRecordId: line.providerRecordId,
      customerName: line.customerName ?? '(unknown customer)',
      customerRecordId: line.customerRecordId,
      txnDate: line.txnDate,
      lineAmount: line.lineAmount,
      invoiceTotalAmount: line.invoiceTotalAmount
    })
  }

  const buffer = await workbook.xlsx.writeBuffer()
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  const safeName = detail.productName.replace(/[^a-z0-9-]/gi, '-')
  link.href = url
  link.download = `revenue-growth-${safeName}-detail.xlsx`
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}
