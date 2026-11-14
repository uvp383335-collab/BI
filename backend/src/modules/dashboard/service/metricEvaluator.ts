import { MetricResult } from '../../metrics/metrics.types'
import { MetricDef, Sub, Abs, num } from './metricRegistry'
import { completedQuarterAt, isQuarter, quarterEndMonth } from './periods'
import { dashboardMetricResultRepository } from '../repository/dashboardMetricResult.repository'

/**
 * Evaluates registry metrics at dashboard periods, with an in-process
 * cache backed by a persisted one (tenant DB) and a global concurrency cap. A dashboard screen asks for
 * the same metric at many periods (series, prior period, alert map), so
 * caching by (org, metric, month) collapses that to one service call each,
 * and the cap keeps a cold overview from flooding the tenant database.
 *
 * Entries are keyed by the org's data version (last sync + settings/product
 * changes), so a sync or a settings save starts a fresh cache and results can
 * otherwise live for hours: several CRM metrics take 1-4 s per period.
 */

const TTL_MS = 6 * 60 * 60 * 1000
const MAX_ENTRIES = 20000
const MAX_CONCURRENT = 12
/** Background warm-up never holds more than this many slots, so screens keep DB headroom. */
const MAX_BACKGROUND = 3

const cache = new Map<string, { at: number; promise: Promise<MetricResult | null> }>()

// Two queues: what the user is looking at goes first; background warm-up only gets a slot when
// no screen request is waiting, and only up to MAX_BACKGROUND at once.
type Priority = 'screen' | 'background'
let active = 0
let activeBackground = 0
const queues: Record<Priority, Array<() => void>> = { screen: [], background: [] }
function pump(): void {
  while (active < MAX_CONCURRENT) {
    if (queues.screen.length) {
      active++
      queues.screen.shift()!()
    } else if (queues.background.length && activeBackground < MAX_BACKGROUND) {
      active++
      activeBackground++
      queues.background.shift()!()
    } else return
  }
}
async function withSlot<T>(fn: () => Promise<T>, priority: Priority): Promise<T> {
  await new Promise<void>((resolve) => {
    queues[priority].push(resolve)
    pump()
  })
  try {
    return await fn()
  } finally {
    active--
    if (priority === 'background') activeBackground--
    pump()
  }
}

/** Test hook. */
export function clearMetricCache(): void {
  cache.clear()
}

export interface EvalContext {
  orgId: string
  /** CRM whose funnel/pipeline data CM-04/05/06/08 read. */
  provider: string
  /** Latest closed month ("YYYY-MM"). */
  lastMonth: string
  /** Latest completed quarter ("YYYY-Qn"). */
  lastQuarter: string
  /** Changes whenever the org's synced data or metric settings change; part of every cache key. */
  dataVersion: string
}

export interface Point {
  result: MetricResult | null
  value: number | null
  abs: Abs | null
  subs: Sub[]
  flag: { level: 'act_now' | 'watch'; reason: string } | null
}

const EMPTY: Point = { result: null, value: null, abs: null, subs: [], flag: null }

/**
 * The month passed to the metric service for a dashboard period: a quarter
 * evaluates at its last month; a quarter-grain metric in the monthly view
 * evaluates at the latest quarter completed by that month.
 */
export function evalMonth(def: MetricDef, period: string): string {
  if (isQuarter(period)) return quarterEndMonth(period)
  if (def.grain === 'Q') return quarterEndMonth(completedQuarterAt(period))
  return period
}

function fetchResult(def: MetricDef, ctx: EvalContext, month: string, priority: Priority, item?: string): Promise<MetricResult | null> {
  const key = `${ctx.orgId}|${ctx.dataVersion}|${def.id}|${def.latestOnly ? 'latest' : month}|${ctx.provider}|${item ?? '-'}`
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < TTL_MS) return hit.promise
  const promise = (async (): Promise<MetricResult | null> => {
    const stored = await dashboardMetricResultRepository.find<MetricResult>(ctx.orgId, key).catch(() => null)
    if (stored) return stored
    const result = await withSlot(() => def.compute(ctx.orgId, month, ctx.provider, item), priority)
    void dashboardMetricResultRepository.save(ctx.orgId, key, result).catch(() => undefined)
    return result
  })().catch((err: unknown) => {
    // One failing metric/period must not take the whole screen down; it shows as a gap.
    console.warn(`[dashboard] ${def.id} @ ${month} failed: ${err instanceof Error ? err.message : String(err)}`)
    return null
  })
  if (cache.size >= MAX_ENTRIES) cache.delete(cache.keys().next().value as string)
  cache.set(key, { at: Date.now(), promise })
  return promise
}

/**
 * `item` (a QuickBooks item id) filters metrics that support the product filter and is ignored
 * by the rest, so callers can pass the view's product filter for any metric.
 */
export async function evaluate(def: MetricDef, ctx: EvalContext, period: string, priority: Priority = 'screen', item?: string): Promise<Point> {
  const month = evalMonth(def, period)
  if (month > ctx.lastMonth) return EMPTY
  if (def.latestOnly && period !== ctx.lastMonth && period !== ctx.lastQuarter) return EMPTY
  const r = await fetchResult(def, ctx, month, priority, def.filters === 'P' ? item : undefined)
  if (!r) return EMPTY
  const data = (r.data ?? {}) as Record<string, unknown>
  const value = r.computable ? (def.value ? def.value(r) : num(r.value)) : null
  return {
    result: r,
    value,
    abs: def.abs ? def.abs(data) : null,
    subs: def.subs(data, r),
    flag: r.flag ?? null
  }
}
