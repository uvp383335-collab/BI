import React from 'react'
import { MetricResult } from '../api/metricsApi'

interface MetricCardExtra {
  label: string
  value: string
}

interface MetricCardProps {
  id: string
  title: string
  description: string
  icon: React.ReactNode
  metric?: MetricResult
  isLoading: boolean
  /** Small supporting facts shown below the headline value (e.g. CAC/LTV:CAC alongside VC-06's Payback) — only rendered once the metric is computable. */
  extras?: MetricCardExtra[]
}

const FLAG_LABEL: Record<'watch' | 'act_now', string> = {
  watch: 'Watch',
  act_now: 'Act now'
}

const FLAG_CLASSES: Record<'watch' | 'act_now', string> = {
  watch: 'bg-warning/15 text-warning',
  act_now: 'bg-danger/15 text-danger'
}

function formatValue(value: number, unit: MetricResult['unit']): string {
  switch (unit) {
    case 'percent':
      return `${value.toFixed(1)}%`
    case 'months':
      return `${value.toFixed(1)} mo`
    case 'multiple':
      return `${value.toFixed(2)}x`
    case 'usd':
      return `$${value.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
    case 'days':
      return `${value.toFixed(1)} days`
    case 'count':
      return value.toLocaleString()
    default:
      return value.toFixed(1)
  }
}

export const MetricCard: React.FC<MetricCardProps> = ({ id, title, description, icon, metric, isLoading, extras }) => {
  const borderClass = !metric?.flag ? 'border-t-brand' : metric.flag.level === 'act_now' ? 'border-t-danger' : 'border-t-warning'

  return (
    <div className={`card border-t-2 p-5 ${borderClass}`}>
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-wide text-ink-3">
          {id} · {title}
        </p>
        <div className="text-brand">{icon}</div>
      </div>

      {isLoading ? (
        <p className="mt-3 text-3xl font-semibold text-ink-3">…</p>
      ) : !metric || !metric.computable || metric.value === null ? (
        <p className="mt-3 text-lg font-medium text-ink-3">Not computable</p>
      ) : (
        <p className="mt-3 text-3xl font-semibold text-ink">{formatValue(metric.value, metric.unit)}</p>
      )}

      <p className="mt-1 text-xs text-ink-2">
        {metric && metric.computable ? `Period: ${metric.period}` : description}
      </p>

      {metric?.computable && extras && extras.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-xs text-ink-2">
          {extras.map((extra) => (
            <span key={extra.label}>
              {extra.label}: <span className="font-medium text-ink">{extra.value}</span>
            </span>
          ))}
        </div>
      )}

      {metric?.flag && (
        <span className={`mt-3 inline-block rounded-full px-2.5 py-1 text-xs font-medium ${FLAG_CLASSES[metric.flag.level]}`}>
          {FLAG_LABEL[metric.flag.level]} — {metric.flag.reason}
        </span>
      )}
    </div>
  )
}
