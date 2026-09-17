import { MetricResult, MetricUnit } from '../metrics.types'
import { computeVC04, computeVC09, computeVC10, computeVC13 } from './plMetrics.service'
import { latestClosedMonth, shiftMonth } from './revenueRollForward.service'

export const TREND_METRIC_IDS = ['vc-04', 'vc-09', 'vc-10', 'vc-13'] as const
export type TrendMetricId = (typeof TREND_METRIC_IDS)[number]

const TREND_COMPUTE_FNS: Record<TrendMetricId, (orgId: string, period?: string, itemId?: string) => Promise<MetricResult>> = {
  'vc-04': computeVC04,
  'vc-09': computeVC09,
  'vc-10': computeVC10,
  'vc-13': computeVC13
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
 * Monthly series from January of `fromYear` (default: the year
 * `latestClosedMonth` falls in, i.e. year-to-date only) through the latest
 * closed month — mirrors docs/server.js's "From year" trend control.
 * Reuses each metric's own single-period compute function per month rather
 * than a bespoke aggregation, so the trend can never drift from what the
 * single-period card shows for the same month. Months older than the
 * synced PLSnapshot/PLItemSnapshot window (6 trailing quarters) simply come
 * back "not computable" (null) — same honest-numbers rule as everywhere
 * else, not a special case here.
 */
export async function computeMetricTrend(orgId: string, id: TrendMetricId, itemId?: string, fromYear?: string): Promise<MetricTrend> {
  const endMonth = latestClosedMonth()
  const year = fromYear ?? endMonth.slice(0, 4)
  const months: string[] = []
  for (let month = `${year}-01`; month <= endMonth; month = shiftMonth(month, 1)) {
    months.push(month)
  }

  const computeFn = TREND_COMPUTE_FNS[id]
  const results = await Promise.all(months.map((month) => computeFn(orgId, month, itemId)))

  return {
    id,
    unit: results[0]?.unit ?? 'percent',
    points: months.map((month, index) => ({ month, value: results[index].value }))
  }
}
