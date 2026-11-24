import type ExcelJS from 'exceljs'
import { InvoiceRevenueGrowthByClassDetailResult } from '../api/productRevenueGrowthApi'

interface ExportInvoiceRevenueGrowthByClassDetailParams {
  fromYear?: string
  detail: InvoiceRevenueGrowthByClassDetailResult
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
 * Builds a workbook for one class's series on the invoice-based "Revenue
 * growth by class (from synced invoices)" card — mirrors
 * exportInvoiceRevenueGrowthDetailToExcel exactly, swapping product for
 * class. The chart's own number IS the sum of these lines, so this is a
 * "show your work" export, not a cross-check against a separate live figure.
 */
export async function exportInvoiceRevenueGrowthByClassDetailToExcel({ fromYear, detail }: ExportInvoiceRevenueGrowthByClassDetailParams): Promise<void> {
  const { default: ExcelJS } = await import('exceljs')
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'DriverInsights'
  workbook.created = new Date()

  const summarySheet = workbook.addWorksheet('Summary')
  summarySheet.addRow([`Revenue growth by class (from synced invoices): ${detail.className}`])
  summarySheet.addRow(['Computed entirely from this org\'s own synced QuickBooks invoice line items\' Class reference — no live QuickBooks call.'])
  summarySheet.addRow([`Class ID: ${detail.classId}`])
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
    { header: 'Line amount (this class)', key: 'lineAmount', width: 22 },
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
  const safeName = detail.className.replace(/[^a-z0-9-]/gi, '-')
  link.href = url
  link.download = `invoice-revenue-growth-by-class-${safeName}-detail.xlsx`
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}
