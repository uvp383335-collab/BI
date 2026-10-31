import type ExcelJS from 'exceljs'
import { CustomerUpgradesTrendDetailResult, CustomerUpgradesTrendGranularity } from '../api/productRevenueGrowthApi'

export type CustomerUpgradesBucket = 'upgrade' | 'downgrade' | 'churn'

interface ExportCustomerUpgradesDetailParams {
  /** Which bucket this button/card cares about — picks the Summary sheet's count/amount columns and the title; the Detail sheet still lists all three buckets (a churned customer is itself always also implied by the prior period's downgrade/upgrade history, so seeing the full picture per customer is more useful than a pre-filtered sheet). */
  bucket: CustomerUpgradesBucket
  itemName?: string
  granularity: CustomerUpgradesTrendGranularity
  detail: CustomerUpgradesTrendDetailResult
}

const HEADER_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F2937' } } as const
const HEADER_FONT = { bold: true, color: { argb: 'FFFFFFFF' } } as const

const BUCKET_LABEL: Record<CustomerUpgradesBucket, string> = {
  upgrade: 'Customer upgrades',
  downgrade: 'Customer downgrades',
  churn: 'Customer churn'
}

const BUCKET_COUNT_KEY = {
  upgrade: 'upgradeCount',
  downgrade: 'downgradeCount',
  churn: 'churnCount'
} as const

const BUCKET_AMOUNT_KEY = {
  upgrade: 'upgradeAmount',
  downgrade: 'downgradeAmount',
  churn: 'churnAmount'
} as const

function styleHeaderRow(row: ExcelJS.Row): void {
  row.eachCell((cell) => {
    cell.fill = HEADER_FILL
    cell.font = HEADER_FONT
  })
}

/**
 * Builds a workbook for one of the Upgrades/Downgrades/Churn cards: a
 * period-by-period summary matching what that card's chart plots, and every
 * existing customer's prior/current revenue for that period — classified
 * into upgrade/downgrade/churn exactly the way the chart counts them, read
 * straight from synced Invoice records (no live QuickBooks call, so this
 * always ties out exactly). The Detail sheet includes all three buckets
 * (not just the one this button's card cares about) since they're computed
 * together from the same customer revenue comparison.
 */
export async function exportCustomerUpgradesDetailToExcel({ bucket, itemName, granularity, detail }: ExportCustomerUpgradesDetailParams): Promise<void> {
  // Loaded on demand — ExcelJS is a heavy library, and most sessions never click "export".
  const { default: ExcelJS } = await import('exceljs')
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'DriverInsights'
  workbook.created = new Date()

  const periodLabel = granularity === 'monthly' ? 'Month' : 'Year'
  const title = BUCKET_LABEL[bucket] + (itemName ? ` — ${itemName}` : '')

  const summarySheet = workbook.addWorksheet('Summary')
  summarySheet.addRow([title])
  summarySheet.addRow([`Granularity: ${granularity}`])
  summarySheet.addRow([`Generated: ${new Date().toISOString()}`])
  summarySheet.addRow([])
  const summaryHeaderRow = summarySheet.addRow([periodLabel, 'Count', 'Amount', 'Starting revenue', 'GRR %', 'NRR %'])
  styleHeaderRow(summaryHeaderRow)
  for (const p of detail.periods) {
    summarySheet.addRow([p.period, p[BUCKET_COUNT_KEY[bucket]], p[BUCKET_AMOUNT_KEY[bucket]], p.startingRevenue, p.grrPct, p.nrrPct])
  }
  summarySheet.columns = [{ width: 12 }, { width: 12 }, { width: 16 }, { width: 18 }, { width: 10 }, { width: 10 }]

  const detailSheet = workbook.addWorksheet('Customer Detail')
  detailSheet.columns = [
    { header: periodLabel, key: 'period', width: 12 },
    { header: 'Bucket', key: 'bucket', width: 12 },
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
  link.download = `customer-${bucket}s-${safeName}-${granularity}-detail.xlsx`
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}
