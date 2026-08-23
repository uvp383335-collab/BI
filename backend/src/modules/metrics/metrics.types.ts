export type MetricFlagLevel = 'watch' | 'act_now'

export interface MetricFlag {
  level: MetricFlagLevel
  reason: string
}

/**
 * Shared response envelope every metric endpoint returns. Follows the PDF's
 * "honest numbers" rule (Section 2.3): `computable: false` when the
 * underlying data is missing, rather than silently returning a zero that
 * would look like a real answer.
 */
export type MetricUnit = 'percent' | 'months' | 'multiple' | 'usd' | 'days' | 'count'

export interface MetricResult<TData extends Record<string, unknown> = Record<string, unknown>> {
  id: string
  period: string
  computable: boolean
  value: number | null
  unit: MetricUnit
  data: TData
  flag: MetricFlag | null
  asOf: string
}
