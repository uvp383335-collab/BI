import type ExcelJS from 'exceljs'
import { CustomerRetentionAdjustedTrendDetailResult, CustomerUpgradesTrendGranularity } from '../api/productRevenueGrowthApi'

interface ExportCustomerRetentionAdjustedDetailParams {
  itemName?: string
  granularity: CustomerUpgradesTrendGranularity
  detail: CustomerRetentionAdjustedTrendDetailResult
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
 * Builds a workbook for "Customer retention (GRR/NRR) — Adjusted": a
 * period-by-period summary matching what the chart plots (including the
 * suppressedChurnCount/suppressedChurnAmount this adjustment held back),
 * and every existing customer's prior/current revenue for that period —
 * classified into upgrade/downgrade/churn/suppressed-churn exactly the way
 * the chart counts them. The Detail sheet's `suppressed-churn` rows are the
 * whole point of this export: they're exactly which customers' repeat
 * drop-to-zero got excluded from churnAmount, so the adjustment itself can
 * be verified customer by customer, not just trusted as an aggregate.
 */
export async function exportCustomerRetentionAdjustedDetailToExcel({ itemName, granularity, detail }: ExportCustomerRetentionAdjustedDetailParams): Promise<void> {
  // Loaded on demand — ExcelJS is a heavy library, and most sessions never click "export".
  const { default: ExcelJS } = await import('exceljs')
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'DriverInsights'
  workbook.created = new Date()

  const periodLabel = granularity === 'monthly' ? 'Month' : 'Year'
  const title = 'Customer retention (GRR/NRR) — Adjusted' + (itemName ? ` — ${itemName}` : '')

  const summarySheet = workbook.addWorksheet('Summary')
  summarySheet.addRow([title])
  summarySheet.addRow(['Same GRR/NRR as the unadjusted card, except a customer’s revenue dropping to $0 only counts as a churn once across this window.'])
  summarySheet.addRow([`Granularity: ${granularity}`])
  summarySheet.addRow([`Generated: ${new Date().toISOString()}`])
  summarySheet.addRow([])
  const summaryHeaderRow = summarySheet.addRow([
    periodLabel,
    'Starting revenue',
    'Downgrade amount',
    'Churn amount (adjusted)',
    'Upgrade amount',
    'GRR % (adjusted)',
    'NRR % (adjusted)',
    'Suppressed churn count',
    'Suppressed churn amount'
  ])
  styleHeaderRow(summaryHeaderRow)
  for (const p of detail.periods) {
    summarySheet.addRow([
      p.period,
      p.startingRevenue,
      p.downgradeAmount,
      p.churnAmount,
      p.upgradeAmount,
      p.grrPct,
      p.nrrPct,
      p.suppressedChurnCount,
      p.suppressedChurnAmount
    ])
  }
  summarySheet.columns = [{ width: 12 }, { width: 18 }, { width: 18 }, { width: 20 }, { width: 16 }, { width: 14 }, { width: 14 }, { width: 18 }, { width: 18 }]

  const detailSheet = workbook.addWorksheet('Customer Detail')
  detailSheet.columns = [
    { header: periodLabel, key: 'period', width: 12 },
    { header: 'Bucket', key: 'bucket', width: 16 },
    { header: 'Customer', key: 'customerName', width: 28 },
    { header: 'Customer ID', key: 'customerRecordId', width: 16 },
    { header: 'Prior revenue', key: 'priorRevenue', width: 16 },
    { header: 'Current revenue', key: 'currentRevenue', width: 16 },
    { header: 'Delta', key: 'delta', width: 14 }
  ]
  styleHeaderRow(detailSheet.getRow(1))
  for (const p of detail.periods) {
    for (const entry of p.entries) {
      detailSheet.addRow({
        period: p.period,
        bucket: entry.bucket,
        customerName: entry.customerName ?? '(unknown customer)',
        customerRecordId: entry.customerRecordId,
        priorRevenue: entry.priorRevenue,
        currentRevenue: entry.currentRevenue,
        delta: entry.delta
      })
    }
  }

  const buffer = await workbook.xlsx.writeBuffer()
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  const safeName = (itemName ?? 'all-products').replace(/[^a-z0-9-]/gi, '-')
  link.href = url
  link.download = `customer-retention-adjusted-${safeName}-${granularity}-detail.xlsx`
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}
