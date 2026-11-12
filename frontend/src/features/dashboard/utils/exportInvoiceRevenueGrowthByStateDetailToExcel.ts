import type ExcelJS from 'exceljs'
import { InvoiceRevenueGrowthByStateDetailResult } from '../api/productRevenueGrowthApi'

interface ExportInvoiceRevenueGrowthByStateDetailParams {
  fromYear?: string
  detail: InvoiceRevenueGrowthByStateDetailResult
}

const HEADER_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F2937' } } as const
const HEADER_FONT = { bold: true, color: { argb: 'FFFFFFFF' } } as const

function styleHeaderRow(row: ExcelJS.Row): void {
  row.eachCell((cell) => {
    cell.fill = HEADER_FILL
    cell.font = HEADER_FONT
  })
}

/**
 * Builds a workbook for one state's series on "Revenue growth by location":
 * a monthly summary table matching what the chart plots, and every
 * individual synced invoice (or invoice line, when a product filter is
 * active) behind it. Same posture as the by-product invoice export — the
 * chart's own number IS the sum of these rows, so this is "show your work,"
 * not a cross-check against a separate live figure.
 */
export async function exportInvoiceRevenueGrowthByStateDetailToExcel({ fromYear, detail }: ExportInvoiceRevenueGrowthByStateDetailParams): Promise<void> {
  // Loaded on demand — ExcelJS is a heavy library, and most sessions never click "export".
  const { default: ExcelJS } = await import('exceljs')
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'DriverInsights'
  workbook.created = new Date()

  const title = detail.productName ? `Revenue growth by location: ${detail.state} — ${detail.productName}` : `Revenue growth by location: ${detail.state} — All products`

  const summarySheet = workbook.addWorksheet('Summary')
  summarySheet.addRow([title])
  summarySheet.addRow(['Computed entirely from this org\'s own synced QuickBooks invoices — no live QuickBooks call.'])
  summarySheet.addRow([`State: ${detail.state}`])
  summarySheet.addRow([`Product filter: ${detail.productName ?? 'All products'}`])
  summarySheet.addRow([`From year: ${fromYear ?? '2018'}`])
  summarySheet.addRow([`Generated: ${new Date().toISOString()}`])
  summarySheet.addRow([])
  const summaryHeaderRow = summarySheet.addRow(['Month', 'Revenue', 'Growth %'])
  styleHeaderRow(summaryHeaderRow)
  for (const m of detail.months) {
    summarySheet.addRow([m.month, m.revenue, m.revenueGrowthPct])
  }
  summarySheet.columns = [{ width: 12 }, { width: 16 }, { width: 14 }]

  const detailSheet = workbook.addWorksheet('Invoice Detail')
  detailSheet.columns = [
    { header: 'Invoice #', key: 'providerRecordId', width: 16 },
    { header: 'Customer', key: 'customerName', width: 28 },
    { header: 'Customer ID', key: 'customerRecordId', width: 16 },
    { header: 'Invoice date', key: 'txnDate', width: 14 },
    { header: detail.productName ? 'Line amount (this product)' : 'Invoice amount', key: 'amount', width: 22 },
    { header: 'Invoice total amount', key: 'invoiceTotalAmount', width: 18 }
  ]
  styleHeaderRow(detailSheet.getRow(1))
  for (const line of detail.lines) {
    detailSheet.addRow({
      providerRecordId: line.providerRecordId,
      customerName: line.customerName ?? '(unknown customer)',
      customerRecordId: line.customerRecordId,
      txnDate: line.txnDate,
      amount: line.amount,
      invoiceTotalAmount: line.invoiceTotalAmount
    })
  }

  const buffer = await workbook.xlsx.writeBuffer()
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  const safeProduct = (detail.productName ?? 'all-products').replace(/[^a-z0-9-]/gi, '-')
  link.href = url
  link.download = `revenue-growth-by-location-${detail.state}-${safeProduct}-detail.xlsx`
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}
