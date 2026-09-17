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
  /** Metric-specific filter controls rendered above trend chart (e.g. state filters, view mode toggles for Revenue Growth). */
  controls?: React.ReactNode
  /** An embedded trend chart (see MetricTrendChart's `embedded` mode) shown below the value/extras, inside this same card. */
  trend?: React.ReactNode
  /** Raw points backing `trend` (if any) — included as their own sheet in the Excel export, alongside the chart. */
  trendPoints?: TrendPoint[]
  /** Extra classes on the outer card, e.g. `lg:col-span-3` for a card whose trend/sub-content needs the full section width. */
  wrapperClassName?: string
}

const FLAG_LABEL: Record<'watch' | 'act_now', string> = {
  watch: 'Watch',
  act_now: 'Act now'
}

const FLAG_CLASSES: Record<'watch' | 'act_now', string> = {
  watch: 'bg-warning/15 text-warning',
  act_now: 'bg-danger/15 text-danger'
}

export const MetricCard: React.FC<MetricCardProps> = ({ id, title, description, icon, metric, isLoading, extras, controls, trend, trendPoints, wrapperClassName = '' }) => {
  const borderClass = !metric?.flag ? 'border-t-brand' : metric.flag.level === 'act_now' ? 'border-t-danger' : 'border-t-warning'

  return (
    <div className={`card border-t-2 p-6 ${borderClass} ${wrapperClassName}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <span className="rounded bg-surface-3 px-1.5 py-0.5 font-mono text-[11px] font-medium text-ink-3">{id}</span>
          <p className="mt-1.5 truncate text-sm font-medium text-ink-2">{title}</p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {metric && (
            <button
              type="button"
              onClick={() => {
                exportMetricToExcel({ id, title, description, metric, trendPoints }).catch((err) => console.error('Failed to export metric to Excel', err))
              }}
              className="rounded-md p-1.5 text-ink-3 transition-colors hover:bg-surface-3 hover:text-brand"
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
        <p className="mt-4 text-3xl font-semibold text-ink-3">…</p>
      ) : !metric || !metric.computable || metric.value === null ? (
        <p className="mt-4 text-lg font-medium text-ink-3">Not computable</p>
      ) : (
        <p className="mt-4 text-3xl font-semibold tracking-tight text-ink">{formatMetricValue(metric.value, metric.unit)}</p>
      )}

      <p className="mt-2 text-sm text-ink-3">{metric && metric.computable ? `Period: ${metric.period}` : description}</p>

      {metric?.computable && extras && extras.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1.5 text-sm text-ink-2">
          {extras.map((extra) => (
            <span key={extra.label}>
              {extra.label}: <span className="font-medium text-ink">{extra.value}</span>
            </span>
          ))}
        </div>
      )}

      {metric?.flag && (
        <span className={`mt-4 inline-block rounded-full px-2.5 py-1 text-xs font-medium ${FLAG_CLASSES[metric.flag.level]}`}>
          {FLAG_LABEL[metric.flag.level]} — {metric.flag.reason}
        </span>
      )}

      {controls && <div className="mt-4">{controls}</div>}

      {trend && <div className="mt-4 border-t border-line pt-4">{trend}</div>}
    </div>
  )
}
