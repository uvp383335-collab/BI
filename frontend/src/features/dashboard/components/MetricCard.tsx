import React from 'react'
import { Download } from 'lucide-react'
import { MetricResult, TrendPoint } from '../api/metricsApi'
import { formatMetricValue } from '../utils/formatMetricValue'
import { exportMetricToExcel } from '../utils/exportMetricToExcel'

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
  /** An embedded trend chart (see MetricTrendChart's `embedded` mode) shown below the value/extras, inside this same card. */
  trend?: React.ReactNode
  /** Raw points backing `trend` (if any) — included as their own sheet in the Excel export, alongside the chart. */
  trendPoints?: TrendPoint[]
}

const FLAG_LABEL: Record<'watch' | 'act_now', string> = {
  watch: 'Watch',
  act_now: 'Act now'
}

const FLAG_CLASSES: Record<'watch' | 'act_now', string> = {
  watch: 'bg-warning/15 text-warning',
  act_now: 'bg-danger/15 text-danger'
}

export const MetricCard: React.FC<MetricCardProps> = ({ id, title, description, icon, metric, isLoading, extras, trend, trendPoints }) => {
  const borderClass = !metric?.flag ? 'border-t-brand' : metric.flag.level === 'act_now' ? 'border-t-danger' : 'border-t-warning'

  return (
    <div className={`card border-t-2 p-5 ${borderClass}`}>
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-wide text-ink-3">
          {id} · {title}
        </p>
        <div className="flex items-center gap-2">
          {metric && (
            <button
              type="button"
              onClick={() => {
                exportMetricToExcel({ id, title, description, metric, trendPoints }).catch((err) => console.error('Failed to export metric to Excel', err))
              }}
              className="rounded-md p-1 text-ink-3 transition-colors hover:bg-surface-3 hover:text-brand"
              aria-label={`Export ${id} to Excel`}
              title="Export to Excel for AI analysis"
            >
              <Download className="h-4 w-4" />
            </button>
          )}
          <div className="text-brand">{icon}</div>
        </div>
      </div>

      {isLoading ? (
        <p className="mt-3 text-3xl font-semibold text-ink-3">…</p>
      ) : !metric || !metric.computable || metric.value === null ? (
        <p className="mt-3 text-lg font-medium text-ink-3">Not computable</p>
      ) : (
        <p className="mt-3 text-3xl font-semibold text-ink">{formatMetricValue(metric.value, metric.unit)}</p>
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

      {trend && <div className="mt-3 border-t border-line pt-3">{trend}</div>}
    </div>
  )
}
