import type ExcelJS from 'exceljs'
import { CustomerRevenueConcentrationByMonthDetailResult } from '../api/metricsApi'

interface ExportCustomerRevenueConcentrationByMonthDetailParams {
  productName?: string
  granularity: 'monthly' | 'quarterly' | 'yearly'
  detail: CustomerRevenueConcentrationByMonthDetailResult
}

const HEADER_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F2937' } } as const
const HEADER_FONT = { bold: true, color: { argb: 'FFFFFFFF' } } as const
const PERIOD_COLUMN_LABEL: Record<ExportCustomerRevenueConcentrationByMonthDetailParams['granularity'], string> = {
  monthly: 'Month',
  quarterly: 'Quarter',
  yearly: 'Year'
}

function styleHeaderRow(row: ExcelJS.Row): void {
  row.eachCell((cell) => {
    cell.fill = HEADER_FILL
    cell.font = HEADER_FONT
  })
}

/**
 * Builds a workbook for "Customer Concentration by Month CM-02": the
 * period-by-period top10Pct/top10Revenue/totalRevenue matching exactly what
 * the chart plots, a "Top Customers by Period" breakdown (identity the
 * chart itself discards once collapsed to a blended ratio), and every
 * individual synced invoice (or invoice line, when a product filter is
 * active) behind each period's top 10 — so one period's ratio can be traced
 * back to actual invoices, not just trusted as an aggregate.
 */
export async function exportCustomerRevenueConcentrationByMonthDetailToExcel({
  productName,
  granularity,
  detail
}: ExportCustomerRevenueConcentrationByMonthDetailParams): Promise<void> {
  // Loaded on demand — ExcelJS is a heavy library, and most sessions never click "export".
  const { default: ExcelJS } = await import('exceljs')
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'DriverInsights'
  workbook.created = new Date()

  const periodLabel = PERIOD_COLUMN_LABEL[granularity]

  const summarySheet = workbook.addWorksheet('Summary')
  summarySheet.addRow(['Customer Concentration by Month CM-02'])
  summarySheet.addRow(["Share of each period's invoiced revenue coming from that period's top 10 QuickBooks customers."])
  summarySheet.addRow([`Product filter: ${productName ?? 'All products'}`])
  summarySheet.addRow([`Granularity: ${granularity}`])
  summarySheet.addRow([`Generated: ${new Date().toISOString()}`])
  summarySheet.addRow([])
  const summaryHeaderRow = summarySheet.addRow([periodLabel, 'Top 10 %', 'Top 10 revenue', 'Total revenue'])
  styleHeaderRow(summaryHeaderRow)
  for (const p of detail.periods) {
    summarySheet.addRow([p.periodStart, p.top10Pct, p.top10Revenue, p.totalRevenue])
  }
  summarySheet.columns = [{ width: 12 }, { width: 12 }, { width: 18 }, { width: 18 }]

  const topCustomersSheet = workbook.addWorksheet('Top Customers by Period')
  topCustomersSheet.columns = [
    { header: periodLabel, key: 'periodStart', width: 12 },
    { header: 'Customer', key: 'customerName', width: 28 },
    { header: 'Customer ID', key: 'customerId', width: 18 },
    { header: 'Revenue', key: 'revenue', width: 16 },
    { header: '% of period total', key: 'pctOfTotal', width: 16 }
  ]
  styleHeaderRow(topCustomersSheet.getRow(1))
  for (const p of detail.periods) {
    for (const c of p.topCustomers) {
      topCustomersSheet.addRow({ periodStart: p.periodStart, customerName: c.customerName, customerId: c.customerId, revenue: c.revenue, pctOfTotal: c.pctOfTotal })
    }
  }

  const detailSheet = workbook.addWorksheet('Invoice Detail')
  detailSheet.columns = [
    { header: periodLabel, key: 'periodStart', width: 12 },
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
      periodStart: line.periodStart,
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
  link.download = `customer-concentration-by-month-${granularity}-${safeProduct}-detail.xlsx`
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}
