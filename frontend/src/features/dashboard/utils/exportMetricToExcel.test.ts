import { describe, expect, it, vi } from 'vitest'
import ExcelJS from 'exceljs'
import { exportMetricToExcel } from './exportMetricToExcel'
import { MetricResult } from '../api/metricsApi'

function makeAnchor() {
  return { href: '', download: '', click: vi.fn() } as unknown as HTMLAnchorElement
}

describe('exportMetricToExcel', () => {
  const metric: MetricResult = {
    id: 'VC-04',
    period: '2026-08',
    computable: true,
    value: 34.2,
    unit: 'percent',
    data: { revenue: 120000, cogs: 41040, note: { guessed: true } },
    flag: { level: 'watch', reason: 'COGS is trending up.' },
    asOf: '2026-09-01T00:00:00.000Z'
  }

  it('builds a workbook with summary, breakdown, and trend sheets and triggers a download', async () => {
    const anchor = makeAnchor()
    vi.spyOn(document, 'createElement').mockReturnValue(anchor)
    vi.spyOn(document.body, 'appendChild').mockImplementation((node) => node)
    vi.spyOn(document.body, 'removeChild').mockImplementation((node) => node)
    global.URL.createObjectURL = vi.fn().mockReturnValue('blob:mock')
    global.URL.revokeObjectURL = vi.fn()

    let writtenBuffer: ArrayBuffer | undefined
    class CapturingBlob {
      constructor(parts: BlobPart[]) {
        writtenBuffer = parts[0] as ArrayBuffer
      }
    }
    vi.stubGlobal('Blob', CapturingBlob)

    await exportMetricToExcel({
      id: 'vc-04',
      title: 'COGS %',
      description: 'Direct delivery cost as a share of revenue',
      metric,
      trendPoints: [
        { month: '2026-07', value: 33.1 },
        { month: '2026-08', value: 34.2 }
      ]
    })

    expect(anchor.click).toHaveBeenCalledOnce()
    expect(anchor.download).toBe('vc-04-2026-08.xlsx')

    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(writtenBuffer!)
    const sheetNames = workbook.worksheets.map((sheet) => sheet.name)
    expect(sheetNames).toEqual(['Summary', 'Calculation breakdown', 'Trend'])

    const summary = workbook.getWorksheet('Summary')!
    expect(summary.getRow(2).getCell(1).value).toBe('Metric ID')
    expect(summary.getRow(2).getCell(2).value).toBe('VC-04')

    const breakdown = workbook.getWorksheet('Calculation breakdown')!
    expect(breakdown.getRow(2).getCell(1).value).toBe('Revenue')
    expect(breakdown.getRow(2).getCell(2).value).toBe(120000)
    expect(breakdown.getRow(4).getCell(2).value).toBe('{"guessed":true}')

    const trend = workbook.getWorksheet('Trend')!
    expect(trend.getRow(2).getCell(1).value).toBe('2026-07')
    expect(trend.getRow(2).getCell(2).value).toBe(33.1)

    vi.unstubAllGlobals()
  })

  it('omits the trend sheet when no trend points are given', async () => {
    vi.spyOn(document, 'createElement').mockReturnValue(makeAnchor())
    vi.spyOn(document.body, 'appendChild').mockImplementation((node) => node)
    vi.spyOn(document.body, 'removeChild').mockImplementation((node) => node)
    global.URL.createObjectURL = vi.fn().mockReturnValue('blob:mock')
    global.URL.revokeObjectURL = vi.fn()

    let writtenBuffer: ArrayBuffer | undefined
    class CapturingBlob {
      constructor(parts: BlobPart[]) {
        writtenBuffer = parts[0] as ArrayBuffer
      }
    }
    vi.stubGlobal('Blob', CapturingBlob)

    await exportMetricToExcel({ id: 'vc-04', title: 'COGS %', description: 'desc', metric })

    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(writtenBuffer!)
    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual(['Summary', 'Calculation breakdown'])

    vi.unstubAllGlobals()
  })
})
