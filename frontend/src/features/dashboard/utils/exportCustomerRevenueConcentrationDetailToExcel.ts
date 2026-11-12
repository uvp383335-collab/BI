import type ExcelJS from 'exceljs'
import { CustomerRevenueConcentrationDetailResult } from '../api/metricsApi'

interface ExportCustomerRevenueConcentrationDetailParams {
  productName?: string
  detail: CustomerRevenueConcentrationDetailResult
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
 * Builds a workbook for "Customer Concentration CM-02": the top-10 summary
 * table matching exactly what the chart plots, and every individual synced
 * invoice (or invoice line, when a product filter is active) billed to
 * those 10 customers or their subsidiaries — so each bar's revenue can be
 * traced back to actual invoices, not just trusted as an aggregate. No
 * per-customer selector on this chart, so this exports all 10 at once, same
 * as exportCampaignWonOpportunitiesDetailToExcel.
 */
export async function exportCustomerRevenueConcentrationDetailToExcel({ productName, detail }: ExportCustomerRevenueConcentrationDetailParams): Promise<void> {
  // Loaded on demand — ExcelJS is a heavy library, and most sessions never click "export".
  const { default: ExcelJS } = await import('exceljs')
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'DriverInsights'
  workbook.created = new Date()

  const summarySheet = workbook.addWorksheet('Summary')
  summarySheet.addRow(['Customer Concentration CM-02'])
  summarySheet.addRow(['All-time invoiced revenue from the top 10 QuickBooks customers, as a share of total revenue.'])
  summarySheet.addRow([`Product filter: ${productName ?? 'All products'}`])
  summarySheet.addRow([`Top 10 share: ${detail.top10Pct}% of ${detail.totalRevenue} total revenue`])
  summarySheet.addRow([`Generated: ${new Date().toISOString()}`])
  summarySheet.addRow([])
  const summaryHeaderRow = summarySheet.addRow(['Customer', 'Customer ID', 'Revenue', '% of total'])
  styleHeaderRow(summaryHeaderRow)
  for (const row of detail.rows) {
    summarySheet.addRow([row.customerName, row.customerId, row.revenue, row.pctOfTotal])
  }
  summarySheet.columns = [{ width: 28 }, { width: 18 }, { width: 16 }, { width: 14 }]

  const detailSheet = workbook.addWorksheet('Invoice Detail')
  detailSheet.columns = [
    { header: 'Invoice #', key: 'providerRecordId', width: 16 },
    { header: 'Top-10 customer', key: 'rootCustomerName', width: 28 },
    { header: 'Top-10 customer ID', key: 'rootCustomerId', width: 18 },
    { header: 'Billed customer', key: 'customerName', width: 28 },
    { header: 'Billed customer ID', key: 'customerRecordId', width: 18 },
    { header: 'Invoice date', key: 'txnDate', width: 14 },
    { header: productName ? 'Line amount (this product)' : 'Invoice amount', key: 'amount', width: 22 }
  ]
  styleHeaderRow(detailSheet.getRow(1))
  for (const line of detail.lines) {
    detailSheet.addRow({
      providerRecordId: line.providerRecordId,
      rootCustomerName: line.rootCustomerName,
      rootCustomerId: line.rootCustomerId,
      customerName: line.customerName,
      customerRecordId: line.customerRecordId,
      txnDate: line.txnDate,
      amount: line.amount
    })
  }

  const buffer = await workbook.xlsx.writeBuffer()
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  const safeProduct = (productName ?? 'all-products').replace(/[^a-z0-9-]/gi, '-')
  link.href = url
  link.download = `customer-concentration-${safeProduct}-detail.xlsx`
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}
