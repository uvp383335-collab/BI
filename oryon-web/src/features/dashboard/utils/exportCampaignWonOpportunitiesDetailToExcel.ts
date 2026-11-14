import type ExcelJS from 'exceljs'
import { CampaignWonOpportunitiesDetailResult } from '../api/metricsApi'

interface ExportCampaignWonOpportunitiesDetailParams {
  detail: CampaignWonOpportunitiesDetailResult
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
 * Builds a workbook for "Opportunities Won by Campaign": a per-campaign
 * summary table matching exactly what the chart plots, and every individual
 * closed-won Opportunity behind it — so one campaign's won count/$ can be
 * traced back to the actual deals, not just trusted as an aggregate. No
 * per-campaign selector on this chart (unlike the invoice revenue growth
 * cards), so this exports every campaign at once, same as
 * exportStageConversionDetailToExcel.
 */
export async function exportCampaignWonOpportunitiesDetailToExcel({ detail }: ExportCampaignWonOpportunitiesDetailParams): Promise<void> {
  // Loaded on demand — ExcelJS is a heavy library, and most sessions never click "export".
  const { default: ExcelJS } = await import('exceljs')
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'DriverInsights'
  workbook.created = new Date()

  const summarySheet = workbook.addWorksheet('Summary')
  summarySheet.addRow(['Opportunities Won by Campaign'])
  summarySheet.addRow(['Closed-won Salesforce Opportunities attributed to a Campaign, grouped by campaign.'])
  summarySheet.addRow([`Generated: ${new Date().toISOString()}`])
  summarySheet.addRow([])
  const summaryHeaderRow = summarySheet.addRow(['Campaign', 'Campaign ID', 'Won count', 'Won amount'])
  styleHeaderRow(summaryHeaderRow)
  for (const row of detail.rows) {
    summarySheet.addRow([row.campaignName, row.campaignId, row.wonCount, row.wonAmount])
  }
  summarySheet.columns = [{ width: 28 }, { width: 18 }, { width: 14 }, { width: 16 }]

  const detailSheet = workbook.addWorksheet('Opportunity Detail')
  detailSheet.columns = [
    { header: 'Opportunity ID', key: 'dealId', width: 20 },
    { header: 'Opportunity name', key: 'dealName', width: 30 },
    { header: 'Campaign', key: 'campaignName', width: 28 },
    { header: 'Campaign ID', key: 'campaignId', width: 18 },
    { header: 'Pipeline', key: 'pipeline', width: 18 },
    { header: 'Stage', key: 'dealstage', width: 18 },
    { header: 'Amount', key: 'amount', width: 16 },
    { header: 'Close date', key: 'closeDate', width: 14 }
  ]
  styleHeaderRow(detailSheet.getRow(1))
  for (const deal of detail.deals) {
    detailSheet.addRow({
      dealId: deal.dealId,
      dealName: deal.dealName ?? '(unnamed opportunity)',
      campaignName: deal.campaignName,
      campaignId: deal.campaignId,
      pipeline: deal.pipeline,
      dealstage: deal.dealstage,
      amount: deal.amount,
      closeDate: deal.closeDate ?? ''
    })
  }

  const buffer = await workbook.xlsx.writeBuffer()
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = 'opportunities-won-by-campaign-detail.xlsx'
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}
