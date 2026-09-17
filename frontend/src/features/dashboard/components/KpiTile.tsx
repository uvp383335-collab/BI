import React from 'react'
import { MetricResult } from '../api/metricsApi'
import { formatMetricValue } from '../utils/formatMetricValue'

interface KpiTileProps {
  label: string
  metric?: MetricResult
  isLoading: boolean
}

/**
 * One headline number for the Executive Summary strip — title, a visually
 * dominant value, and (when the metric flagged something) a subtle colored
 * note underneath, never a bright badge. The same metric this reads from
 * also gets its own full MetricCard further down the page with its trend
 * chart and detail — this tile is the "top of the story" version, not a
 * duplicate of that card.
 */
export const KpiTile: React.FC<KpiTileProps> = ({ label, metric, isLoading }) => (
  <div className="card p-6">
    <p className="text-sm font-medium text-ink-2">{label}</p>

    {isLoading ? (
      <p className="mt-3 text-4xl font-bold text-ink-3">…</p>
    ) : !metric || !metric.computable || metric.value === null ? (
      <p className="mt-3 text-lg font-medium text-ink-3">Not computable</p>
    ) : (
      <p className="mt-3 text-4xl font-bold tracking-tight text-ink">{formatMetricValue(metric.value, metric.unit)}</p>
    )}

    {metric?.computable && <p className="mt-2 text-xs text-ink-3">As of {metric.period}</p>}

    {metric?.flag && (
      <p className={`mt-3 text-xs font-medium ${metric.flag.level === 'act_now' ? 'text-danger' : 'text-warning'}`}>
        {metric.flag.level === 'act_now' ? 'Act now' : 'Watch'} — {metric.flag.reason}
      </p>
    )}
  </div>
)
