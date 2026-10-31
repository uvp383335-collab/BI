import type ExcelJS from 'exceljs'
import { InvoiceRevenueGrowthByProductDetailResult } from '../api/productRevenueGrowthApi'

interface ExportInvoiceRevenueGrowthDetailParams {
  fromYear?: string
  detail: InvoiceRevenueGrowthByProductDetailResult
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
 * Builds a workbook for one product's series on the invoice-based "Revenue
 * growth by product (from synced invoices)" card: a monthly summary table
 * matching what the chart plots, and every individual synced invoice line
 * behind it. Unlike the live card's export, there's no separate live figure
 * to reconcile against here — the chart's own number IS the sum of these
 * lines — so this is a straightforward "show your work," not a cross-check.
 */
export async function exportInvoiceRevenueGrowthDetailToExcel({ fromYear, detail }: ExportInvoiceRevenueGrowthDetailParams): Promise<void> {
  // Loaded on demand — ExcelJS is a heavy library, and most sessions never click "export".
  const { default: ExcelJS } = await import('exceljs')
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'DriverInsights'
  workbook.created = new Date()

  const summarySheet = workbook.addWorksheet('Summary')
  summarySheet.addRow([`Revenue growth by product (from synced invoices): ${detail.productName}`])
  summarySheet.addRow(['Computed entirely from this org\'s own synced QuickBooks invoice line items — no live QuickBooks call.'])
  summarySheet.addRow([`Product ID: ${detail.productId}`])
  summarySheet.addRow([`From year: ${fromYear ?? '2018'}`])
  summarySheet.addRow([`Generated: ${new Date().toISOString()}`])
  summarySheet.addRow([])
  const summaryHeaderRow = summarySheet.addRow(['Month', 'Revenue', 'Growth %'])
  styleHeaderRow(summaryHeaderRow)
  for (const m of detail.months) {
    summarySheet.addRow([m.month, m.revenue, m.revenueGrowthPct])
  }
  summarySheet.columns = [{ width: 12 }, { width: 16 }, { width: 14 }]

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
  link.download = `invoice-revenue-growth-${safeName}-detail.xlsx`
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}
