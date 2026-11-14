import type ExcelJS from 'exceljs'
import { NewCustomersTrendDetailResult } from '../api/productRevenueGrowthApi'

interface ExportNewCustomersDetailParams {
  fromYear?: string
  itemName?: string
  detail: NewCustomersTrendDetailResult
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
 * Builds a workbook for the "New customers" chart: a monthly summary table
 * matching what the chart plots, and the exact customer behind each month's
 * count/amount — read straight from synced Invoice records (no live
 * QuickBooks call, so this always ties out exactly to the chart).
 */
export async function exportNewCustomersDetailToExcel({ fromYear, itemName, detail }: ExportNewCustomersDetailParams): Promise<void> {
  // Loaded on demand — ExcelJS is a heavy library, and most sessions never click "export".
  const { default: ExcelJS } = await import('exceljs')
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'DriverInsights'
  workbook.created = new Date()

  const summarySheet = workbook.addWorksheet('Summary')
  summarySheet.addRow(['New customers' + (itemName ? ` — ${itemName}` : '')])
  summarySheet.addRow([itemName ? `Customers whose first invoice containing "${itemName}" fell in each month.` : "Customers whose first-ever QuickBooks invoice fell in each month."])
  summarySheet.addRow([`From year: ${fromYear ?? '(current year)'}`])
  summarySheet.addRow([`Generated: ${new Date().toISOString()}`])
  summarySheet.addRow([])
  const summaryHeaderRow = summarySheet.addRow(['Month', 'New customer count', 'New customer amount'])
  styleHeaderRow(summaryHeaderRow)
  for (const m of detail.months) {
    summarySheet.addRow([m.month, m.newCustomerCount, m.newCustomerAmount])
  }
  summarySheet.columns = [{ width: 12 }, { width: 20 }, { width: 20 }]

  const detailSheet = workbook.addWorksheet('Customer Detail')
  detailSheet.columns = [
    { header: 'Month', key: 'month', width: 12 },
    { header: 'Customer', key: 'customerName', width: 28 },
    { header: 'Customer ID', key: 'customerRecordId', width: 16 },
    { header: 'First invoice date', key: 'firstInvoiceDate', width: 16 },
    { header: 'First invoice amount', key: 'firstAmount', width: 18 }
  ]
  styleHeaderRow(detailSheet.getRow(1))
  for (const m of detail.months) {
    for (const entry of m.entries) {
      detailSheet.addRow({
        month: m.month,
        customerName: entry.customerName ?? '(unknown customer)',
        customerRecordId: entry.customerRecordId,
        firstInvoiceDate: entry.firstInvoiceDate,
        firstAmount: entry.firstAmount
      })
    }
  }

  const buffer = await workbook.xlsx.writeBuffer()
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `new-customers${itemName ? `-${itemName.replace(/[^a-z0-9-]/gi, '-')}` : ''}-detail.xlsx`
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}
