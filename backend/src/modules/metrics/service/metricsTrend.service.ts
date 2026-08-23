import { MetricResult, MetricUnit } from '../metrics.types'
import { computeVC04, computeVC09, computeVC10 } from './plMetrics.service'
import { latestClosedMonth, shiftMonth } from './revenueRollForward.service'

export const TREND_METRIC_IDS = ['vc-04', 'vc-09', 'vc-10'] as const
export type TrendMetricId = (typeof TREND_METRIC_IDS)[number]

const TREND_COMPUTE_FNS: Record<TrendMetricId, (orgId: string, period?: string) => Promise<MetricResult>> = {
  'vc-04': computeVC04,
  'vc-09': computeVC09,
  'vc-10': computeVC10
}

export interface TrendPoint {
  month: string
  value: number | null
}

export interface MetricTrend {
  id: TrendMetricId
  unit: MetricUnit
  points: TrendPoint[]
}

/**
 * Monthly series from January of the current year (the year `latestClosedMonth`
 * falls in) through the latest closed month — the fixed range the dashboard's
 * trend charts need. Reuses each metric's own single-period compute function
 * per month rather than a bespoke aggregation, so the trend can never drift
 * from what the single-period card shows for the same month.
 */
export async function computeMetricTrend(orgId: string, id: TrendMetricId): Promise<MetricTrend> {
  const endMonth = latestClosedMonth()
  const year = endMonth.slice(0, 4)
  const months: string[] = []
  for (let month = `${year}-01`; month <= endMonth; month = shiftMonth(month, 1)) {
    months.push(month)
  }

  const computeFn = TREND_COMPUTE_FNS[id]
  const results = await Promise.all(months.map((month) => computeFn(orgId, month)))

  return {
    id,
    unit: results[0]?.unit ?? 'percent',
    points: months.map((month, index) => ({ month, value: results[index].value }))
  }
}
