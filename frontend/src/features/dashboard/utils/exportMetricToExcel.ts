import type ExcelJS from 'exceljs'
import { MetricResult, TrendPoint } from '../api/metricsApi'
import { formatMetricValue } from './formatMetricValue'

interface ExportMetricParams {
  id: string
  title: string
  description: string
  metric: MetricResult
  trendPoints?: TrendPoint[]
}

const HEADER_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F2937' } } as const
const HEADER_FONT = { bold: true, color: { argb: 'FFFFFFFF' } } as const

/** "startingRevenue" -> "Starting Revenue" */
function labelize(key: string): string {
  const spaced = key.replace(/([a-z0-9])([A-Z])/g, '$1 $2')
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

function styleHeaderRow(row: ExcelJS.Row): void {
  row.eachCell((cell) => {
    cell.fill = HEADER_FILL
    cell.font = HEADER_FONT
  })
}

/** Renders a metric field value the way a spreadsheet cell should hold it — a real number where possible, JSON text for anything nested. */
function toCellValue(value: unknown): string | number | boolean | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'string') return value
  return JSON.stringify(value)
}

/**
 * Builds a workbook with everything the app already knows about one metric —
 * headline value, the full calculation breakdown the backend returned in
 * `data`, and its trend history when available — so it can be dropped
 * straight into an AI tool for analysis without hand-copying numbers.
 */
export async function exportMetricToExcel({ id, title, description, metric, trendPoints }: ExportMetricParams): Promise<void> {
  // Loaded on demand — ExcelJS is a heavy library, and most sessions never click "export".
  const { default: ExcelJS } = await import('exceljs')
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'DriverInsights'
  workbook.created = new Date()

  const summarySheet = workbook.addWorksheet('Summary')
  summarySheet.columns = [
    { header: 'Field', key: 'field', width: 22 },
    { header: 'Value', key: 'value', width: 60 }
  ]
  styleHeaderRow(summarySheet.getRow(1))
  summarySheet.addRows([
    { field: 'Metric ID', value: id.toUpperCase() },
    { field: 'Title', value: title },
    { field: 'Description', value: description },
    { field: 'Period', value: metric.period },
    { field: 'Computable', value: metric.computable ? 'Yes' : 'No' },
    { field: 'Value', value: metric.computable && metric.value !== null ? formatMetricValue(metric.value, metric.unit) : 'Not computable' },
    { field: 'Raw value', value: metric.value },
    { field: 'Unit', value: metric.unit },
    { field: 'Flag level', value: metric.flag?.level ?? 'None' },
    { field: 'Flag reason', value: metric.flag?.reason ?? '' },
    { field: 'As of', value: metric.asOf }
  ])

  const dataEntries = Object.entries(metric.data ?? {})
  if (dataEntries.length > 0) {
    const breakdownSheet = workbook.addWorksheet('Calculation breakdown')
    breakdownSheet.columns = [
      { header: 'Field', key: 'field', width: 28 },
      { header: 'Value', key: 'value', width: 40 }
    ]
    styleHeaderRow(breakdownSheet.getRow(1))
    for (const [key, value] of dataEntries) {
      breakdownSheet.addRow({ field: labelize(key), value: toCellValue(value) })
    }
  }

  if (trendPoints && trendPoints.length > 0) {
    const trendSheet = workbook.addWorksheet('Trend')
    trendSheet.columns = [
      { header: 'Month', key: 'month', width: 14 },
      { header: `Value (${metric.unit})`, key: 'value', width: 18 }
    ]
    styleHeaderRow(trendSheet.getRow(1))
    for (const point of trendPoints) {
      trendSheet.addRow({ month: point.month, value: point.value })
    }
  }

  const buffer = await workbook.xlsx.writeBuffer()
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  const safePeriod = metric.period.replace(/[^a-z0-9-]/gi, '')
  link.href = url
  link.download = `${id.toLowerCase()}-${safePeriod || 'latest'}.xlsx`
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}
