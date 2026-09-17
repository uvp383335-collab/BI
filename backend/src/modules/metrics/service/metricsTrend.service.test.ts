import { computeMetricTrend } from './metricsTrend.service'
import { computeVC04, computeVC09, computeVC10, computeVC13 } from './plMetrics.service'
import * as revenueRollForward from './revenueRollForward.service'

jest.mock('./plMetrics.service')
jest.mock('./revenueRollForward.service', () => {
  const actual = jest.requireActual('./revenueRollForward.service')
  return { ...actual, latestClosedMonth: jest.fn() }
})

const mockedComputeVC04 = computeVC04 as jest.Mock
const mockedComputeVC09 = computeVC09 as jest.Mock
const mockedComputeVC10 = computeVC10 as jest.Mock
const mockedComputeVC13 = computeVC13 as jest.Mock
const mockedLatestClosedMonth = revenueRollForward.latestClosedMonth as jest.Mock

function metricResult(period: string, value: number | null) {
  return { id: 'vc-04', period, computable: value !== null, value, unit: 'percent', data: {}, flag: null, asOf: '' }
}

describe('computeMetricTrend', () => {
  beforeEach(() => {
    mockedComputeVC04.mockReset()
    mockedComputeVC09.mockReset()
    mockedComputeVC10.mockReset()
    mockedComputeVC13.mockReset()
    mockedLatestClosedMonth.mockReset()
  })

  it('builds one point per month from January of the current year through the latest closed month', async () => {
    mockedLatestClosedMonth.mockReturnValue('2026-04')
    mockedComputeVC04.mockImplementation((_orgId, period) => Promise.resolve(metricResult(period, 10)))

    const result = await computeMetricTrend('org1', 'vc-04')

    expect(result.id).toBe('vc-04')
    expect(result.unit).toBe('percent')
    expect(result.points.map((p) => p.month)).toEqual(['2026-01', '2026-02', '2026-03', '2026-04'])
    expect(mockedComputeVC04).toHaveBeenCalledTimes(4)
  })

  it('keeps a null value for a not-computable month instead of dropping it', async () => {
    mockedLatestClosedMonth.mockReturnValue('2026-02')
    mockedComputeVC09.mockImplementation((_orgId, period) =>
      Promise.resolve(metricResult(period, period === '2026-01' ? null : 15))
    )

    const result = await computeMetricTrend('org1', 'vc-09')

    expect(result.points).toEqual([
      { month: '2026-01', value: null },
      { month: '2026-02', value: 15 }
    ])
  })

  it('routes vc-10 to computeVC10, not one of the other two', async () => {
    mockedLatestClosedMonth.mockReturnValue('2026-01')
    mockedComputeVC10.mockResolvedValue(metricResult('2026-01', 22))

    await computeMetricTrend('org1', 'vc-10')

    expect(mockedComputeVC10).toHaveBeenCalledWith('org1', '2026-01', undefined)
    expect(mockedComputeVC04).not.toHaveBeenCalled()
    expect(mockedComputeVC09).not.toHaveBeenCalled()
  })

  it('forwards an itemId to every month\'s compute call, for the product filter', async () => {
    mockedLatestClosedMonth.mockReturnValue('2026-02')
    mockedComputeVC13.mockImplementation((_orgId, period) => Promise.resolve(metricResult(period, 5)))

    await computeMetricTrend('org1', 'vc-13', 'item-123')

    expect(mockedComputeVC13).toHaveBeenCalledTimes(2)
    expect(mockedComputeVC13).toHaveBeenNthCalledWith(1, 'org1', '2026-01', 'item-123')
    expect(mockedComputeVC13).toHaveBeenNthCalledWith(2, 'org1', '2026-02', 'item-123')
  })

  it('starts the series from `fromYear` instead of the current year when given', async () => {
    mockedLatestClosedMonth.mockReturnValue('2026-02')
    mockedComputeVC04.mockImplementation((_orgId, period) => Promise.resolve(metricResult(period, 1)))

    const result = await computeMetricTrend('org1', 'vc-04', undefined, '2024')

    expect(result.points.map((p) => p.month)).toEqual([
      '2024-01', '2024-02', '2024-03', '2024-04', '2024-05', '2024-06',
      '2024-07', '2024-08', '2024-09', '2024-10', '2024-11', '2024-12',
      '2025-01', '2025-02', '2025-03', '2025-04', '2025-05', '2025-06',
      '2025-07', '2025-08', '2025-09', '2025-10', '2025-11', '2025-12',
      '2026-01', '2026-02'
    ])
  })

  it('returns an empty series (no infinite loop) when fromYear is after the latest closed month', async () => {
    mockedLatestClosedMonth.mockReturnValue('2026-02')
    mockedComputeVC04.mockResolvedValue(metricResult('2030-01', 1))

    const result = await computeMetricTrend('org1', 'vc-04', undefined, '2030')

    expect(result.points).toEqual([])
    expect(mockedComputeVC04).not.toHaveBeenCalled()
  })
})
