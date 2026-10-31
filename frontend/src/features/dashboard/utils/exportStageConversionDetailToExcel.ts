import type ExcelJS from 'exceljs'
import { StageConversionTrendDetailResult } from '../api/metricsApi'

interface ExportStageConversionDetailParams {
  title: string
  description: string
  provider: 'hubspot' | 'salesforce'
  /** Short label for the "from" stage, e.g. "Lead" — used only for column headers. */
  fromLabel: string
  /** Short label for the "to" stage, e.g. "MQL" — used only for column headers. */
  toLabel: string
  detail: StageConversionTrendDetailResult
}

const HEADER_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F2937' } } as const
const HEADER_FONT = { bold: true, color: { argb: 'FFFFFFFF' } } as const
const PERIOD_COLUMN_LABEL: Record<StageConversionTrendDetailResult['granularity'], string> = {
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
 * Builds a workbook with both the period-by-period aggregate (exactly what
 * the trend chart plots, for a quick visual cross-check) and every
 * individual record behind it (provider record id + the raw stage-entry
 * timestamps the cohort math reads) — so one period's lead/MQL count, or
 * any single contact's inclusion/exclusion, can be checked by hand against
 * HubSpot instead of having to trust the aggregate alone.
 */
export async function exportStageConversionDetailToExcel({ title, description, provider, fromLabel, toLabel, detail }: ExportStageConversionDetailParams): Promise<void> {
  // Loaded on demand — ExcelJS is a heavy library, and most sessions never click "export".
  const { default: ExcelJS } = await import('exceljs')
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'DriverInsights'
  workbook.created = new Date()

  const periodLabel = PERIOD_COLUMN_LABEL[detail.granularity]

  const summarySheet = workbook.addWorksheet('Summary')
  summarySheet.addRow([title])
  summarySheet.addRow([description])
  summarySheet.addRow([`Provider: ${provider}`])
  summarySheet.addRow([`Granularity: ${detail.granularity}`])
  summarySheet.addRow([`Raw stages: "${detail.fromStage}" -> "${detail.toStage}"`])
  summarySheet.addRow([`Generated: ${new Date().toISOString()}`])
  summarySheet.addRow([])
  const summaryHeaderRow = summarySheet.addRow([periodLabel, `${fromLabel} count`, `${toLabel} count`, 'Conversion rate %'])
  styleHeaderRow(summaryHeaderRow)
  for (const p of detail.periods) {
    summarySheet.addRow([p.periodStart, p.fromCount, p.toCount, p.conversionRatePct])
  }
  summarySheet.getColumn(1).width = 14
  summarySheet.getColumn(2).width = 18
  summarySheet.getColumn(3).width = 18
  summarySheet.getColumn(4).width = 20

  const detailSheet = workbook.addWorksheet('Record Detail')
  detailSheet.columns = [
    { header: periodLabel, key: 'period', width: 12 },
    { header: 'Provider record ID', key: 'providerRecordId', width: 22 },
    { header: `${fromLabel} entered at`, key: 'fromEnteredAt', width: 26 },
    { header: `${toLabel} entered at`, key: 'toEnteredAt', width: 26 },
    { header: 'Converted', key: 'converted', width: 12 },
    { header: 'Days to advance', key: 'daysToAdvance', width: 16 }
  ]
  styleHeaderRow(detailSheet.getRow(1))
  for (const p of detail.periods) {
    for (const entry of p.entries) {
      detailSheet.addRow({
        period: p.periodStart,
        providerRecordId: entry.providerRecordId,
        fromEnteredAt: entry.fromEnteredAt,
        toEnteredAt: entry.toEnteredAt ?? '',
        converted: entry.converted ? 'Yes' : 'No',
        daysToAdvance: entry.daysToAdvance ?? ''
      })
    }
  }

  const buffer = await workbook.xlsx.writeBuffer()
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  const safeStages = `${detail.fromStage}-to-${detail.toStage}`.replace(/[^a-z0-9-]/gi, '')
  link.href = url
  link.download = `${safeStages}-${provider}-${detail.granularity}-conversion-detail.xlsx`
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}
