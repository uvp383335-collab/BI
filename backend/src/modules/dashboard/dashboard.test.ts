import { completedQuarterAt, trailingPeriods, prevPeriod, yearAgo, periodRange } from './service/periods'
import { evalMonth, clearMetricCache } from './service/metricEvaluator'
import { METRIC_BY_ID } from './service/metricRegistry'
import { getFamily, getOverview, getAlerts, getMetric, getMeta } from './service/dashboard.service'
import * as oryon from '../metrics/oryon/oryonMetrics.service'
import * as cmMetrics from '../metrics/service/cmMetrics.service'
import { organizationsRepository } from '../organizations/repository/organizations.repository'
import { integrationsRepository } from '../integrations/repository/integrations.repository'
import { productRepository } from '../sync/repository/product.repository'
import { dashboardMetricResultRepository } from './repository/dashboardMetricResult.repository'

jest.mock('../metrics/oryon/oryonMetrics.service')
jest.mock('../metrics/service/cmMetrics.service')
jest.mock('../organizations/repository/organizations.repository')
jest.mock('../integrations/repository/integrations.repository')
jest.mock('../sync/repository/product.repository')
jest.mock('./repository/dashboardMetricResult.repository')
jest.mock('../metrics/service/revenueRollForward.service', () => ({ latestClosedMonth: () => '2026-10' }))

const result = (id: string, value: number | null, data: Record<string, unknown> = {}, flag: unknown = null) => ({
  id, period: '2026-09', computable: value !== null, value, unit: 'percent', data, flag, asOf: '2026-11-01T00:00:00.000Z'
})

const allComputes = [oryon, cmMetrics].flatMap((mod) =>
  Object.entries(mod).filter(([k]) => k.startsWith('compute') || k.startsWith('oryon')).map(([, fn]) => fn as jest.Mock)
)

beforeEach(() => {
  clearMetricCache()
  allComputes.forEach((fn) => fn.mockReset().mockResolvedValue(result('X', 10)))
  ;(organizationsRepository.findById as jest.Mock).mockResolvedValue({ name: 'Acme' })
  ;(integrationsRepository.listByOrg as jest.Mock).mockResolvedValue([{ provider: 'quickbooks' }, { provider: 'hubspot' }])
  ;(productRepository.latestUpdatedAt as jest.Mock).mockResolvedValue(null)
  ;(productRepository.findAllForOrg as jest.Mock).mockResolvedValue([
    { providerRecordId: '21', name: 'Platform' },
    { providerRecordId: '7', name: 'Services' }
  ])
  ;(dashboardMetricResultRepository.find as jest.Mock).mockResolvedValue(null)
  ;(dashboardMetricResultRepository.save as jest.Mock).mockResolvedValue(undefined)
})

describe('dashboard periods', () => {
  it('maps a month to the latest quarter it completes', () => {
    expect(completedQuarterAt('2026-08')).toBe('2026-Q2')
    expect(completedQuarterAt('2026-09')).toBe('2026-Q3')
    expect(completedQuarterAt('2026-02')).toBe('2025-Q4')
  })

  it('walks months and quarters across year boundaries', () => {
    expect(trailingPeriods('2026-Q1', 3)).toEqual(['2025-Q3', '2025-Q4', '2026-Q1'])
    expect(trailingPeriods('2026-01', 2)).toEqual(['2025-12', '2026-01'])
    expect(prevPeriod('2026-Q1')).toBe('2025-Q4')
    expect(yearAgo('2026-03')).toBe('2025-03')
    expect(periodRange('2025-11', '2026-02')).toEqual(['2025-11', '2025-12', '2026-01', '2026-02'])
  })

  it('evaluates quarter-grain metrics at the completed quarter in the monthly view', () => {
    expect(evalMonth(METRIC_BY_ID.get('VC-10')!, '2026-08')).toBe('2026-06')
    expect(evalMonth(METRIC_BY_ID.get('VC-01')!, '2026-08')).toBe('2026-08')
    expect(evalMonth(METRIC_BY_ID.get('VC-01')!, '2026-Q3')).toBe('2026-09')
  })
})

describe('dashboard service', () => {
  it('meta exposes org name, connected sources, QuickBooks items as products and capabilities', async () => {
    const meta = await getMeta('org1')
    expect(meta.company.name).toBe('Acme')
    expect(meta.dataThrough).toBe('2026-10')
    expect(meta.quarters.at(-1)).toBe('2026-Q3')
    expect(meta.products).toEqual(['Platform', 'Services'])
    expect(meta.sources).toEqual(['QuickBooks Online', 'HubSpot'])
    expect(meta.capabilities.ttm).toBe(false)
    // the Oryon calculations are company-wide: no metric takes the QuickBooks item filter
    expect(meta.capabilities.product).toBe(false)
    expect(meta.capabilities.region).toBe(false)
  })

  it('family cards carry a series, prior-period delta and the mapped alert flag', async () => {
    ;(oryon.oryonVC10 as jest.Mock).mockImplementation(async (_o: string, month: string) =>
      result('VC-10', month === '2026-09' ? 12 : 10, { ebitda: 5 }, month === '2026-09' ? { level: 'act_now', reason: 'Margin fell.' } : null)
    )
    const fam = await getFamily('org1', 'VC', { asOf: '2026-Q3', span: '4' })
    expect(fam.metrics).toHaveLength(11)
    const vc10 = fam.metrics.find((m) => m.id === 'VC-10')!
    expect((vc10.series as unknown[]).length).toBe(4)
    expect(vc10.value).toBe(12)
    expect(vc10.delta).toBe(2)
    expect(vc10.alert).toEqual({ id: 'VC-10', period: '2026-Q3', flag: 'Act now', why: 'Margin fell' })
    expect(vc10.abs).toEqual({ label: 'EBITDA', unit: 'USD', value: 5 })
  })

  it('passes the CRM provider through to CM-04 and clamps future periods', async () => {
    await getFamily('org1', 'CM', { asOf: '2027-Q2', span: '4' })
    expect(cmMetrics.computeCM04).toHaveBeenCalledWith('org1', 'hubspot', '2026-09')
  })

  it('a failing metric shows as a gap instead of failing the screen', async () => {
    ;(oryon.oryonVC13 as jest.Mock).mockRejectedValue(new Error('boom'))
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined)
    const fam = await getFamily('org1', 'VC', { asOf: '2026-Q3', span: '4' })
    expect(fam.metrics.find((m) => m.id === 'VC-13')!.value).toBeNull()
    warn.mockRestore()
  })

  it('CB-05 has month-end history: every period is computed', async () => {
    ;(oryon.oryonCB05 as jest.Mock).mockImplementation(async (_o: string, month: string) => result('CB-05', month === '2026-09' ? 500 : 400))
    const m = await getMetric('org1', 'CB-05', { asOf: '2026-Q3', span: '4' })
    const series = m.series as Array<{ value: number | null }>
    expect(series.map((s) => s.value)).toEqual([400, 400, 400, 500])
  })

  it('overview derives gross margin and product comparison from VC-04', async () => {
    ;(oryon.oryonVC04 as jest.Mock).mockResolvedValue(
      result('VC-04', 40, { revenue: 100, cogsTotal: 40, mix: [{ class: 'Platform', revenue: 80, mixPct: 80, cogsPct: 25 }, { class: 'Services', revenue: 20, mixPct: 20, cogsPct: 100 }] })
    )
    const o = await getOverview('org1', { asOf: '2026-Q3', span: '4' })
    expect(o.kpis.find((k) => k.key === 'gm')!.value).toBe(60)
    expect(o.charts.revenue.stacks.map((s) => s.key)).toEqual(['Platform', 'Services'])
    const platform = o.productComparison.rows.find((r) => r?.key === 'Platform')!
    expect(platform.grossProfit).toBe(60)
    expect(platform.grossMargin).toBe(75)
    expect(o.productComparison.company).toMatchObject({ revenue: 100, grossProfit: 60, grossMargin: 60 })
    expect(o.health.map((h) => h.family)).toEqual(['VC', 'CB', 'CM'])
  })

  it('alerts lists flags per quarter, act-now first in the read', async () => {
    ;(oryon.oryonCM08 as jest.Mock).mockResolvedValue(result('CM-08', 3, {}, { level: 'watch', reason: 'MQLs down.' }))
    const a = await getAlerts('org1', { asOf: '2026-Q3', n: '2' })
    expect(a.quarters).toEqual(['2026-Q2', '2026-Q3'])
    expect(a.alerts.filter((x) => x.id === 'CM-08')).toHaveLength(2)
  })

  it('serves a persisted result without recomputing, and saves fresh ones', async () => {
    ;(dashboardMetricResultRepository.find as jest.Mock).mockImplementation(async (_o: string, key: string) =>
      key.includes('|VC-10|2026-09|') ? result('VC-10', 42) : null
    )
    const m = await getMetric('org1', 'VC-10', { asOf: '2026-Q3', span: '4' })
    expect(m.value).toBe(42)
    expect(oryon.oryonVC10).not.toHaveBeenCalledWith('org1', '2026-09')
    expect(dashboardMetricResultRepository.save).toHaveBeenCalled()
  })

  it('retention reads the Oryon calculation at the quarter-end month', async () => {
    ;(oryon.oryonVC01 as jest.Mock).mockResolvedValue(result('VC-01', 83.3))
    const m = await getMetric('org1', 'VC-01', { asOf: '2026-Q3', span: '4' })
    expect(m.value).toBe(83.3)
    expect(oryon.oryonVC01).toHaveBeenCalledWith('org1', '2026-09')
  })

  it('a product filter leaves every metric company-wide', async () => {
    const fam = await getFamily('org1', 'VC', { asOf: '2026-Q3', span: '4', product: 'Services' })
    expect(oryon.oryonVC10).toHaveBeenCalledWith('org1', '2026-09')
    expect(fam.metrics.every((m) => m.scope === 'company')).toBe(true)
    expect(fam.view.filters.product).toEqual(['Services'])
  })

  it('ignores an unknown product label', async () => {
    const fam = await getFamily('org1', 'VC', { asOf: '2026-Q3', span: '4', product: 'Nope' })
    expect(fam.view.filters.product).toBe('All')
    expect(oryon.oryonVC10).toHaveBeenCalledWith('org1', '2026-09')
  })
})

describe('dashboard metric id validation', () => {
  it('accepts every registry metric id, including ER-05 (regression: its drawer showed "Unknown metric")', async () => {
    const { metricParamsSchema } = await import('./validator/dashboard.validator')
    const { METRICS } = await import('./service/metricRegistry')
    for (const m of METRICS) expect(metricParamsSchema.safeParse({ metricId: m.id }).success).toBe(true)
    expect(metricParamsSchema.safeParse({ metricId: 'XX-01' }).success).toBe(false)
  })
})
