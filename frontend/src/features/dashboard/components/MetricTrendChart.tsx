import React from 'react'
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { TrendPoint } from '../api/metricsApi'

interface MetricTrendChartProps {
  title: string
  description: string
  color: string
  points: TrendPoint[]
  isLoading: boolean
  /** Skips the card wrapper/heading — for embedding directly inside a MetricCard that already shows them. */
  embedded?: boolean
}

const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function formatMonth(month: string): string {
  const monthIndex = Number(month.slice(5, 7)) - 1
  return MONTH_LABELS[monthIndex] ?? month
}

/**
 * Recharts defaults a value axis to start at 0, which flattens a metric that
 * only moves within a narrow band far from zero (e.g. EBITDA margin sitting
 * around 50-56%) into what looks like a nearly straight line. Scaling the
 * domain to the data's own min/max — with a little padding so the line
 * doesn't touch the edges, and a floor so a genuinely flat metric still gets
 * a sane range — keeps the chart legible regardless of a metric's typical
 * magnitude, now or if these numbers grow later.
 */
function paddedDomain([dataMin, dataMax]: readonly [number, number]): [number, number] {
  const span = dataMax - dataMin
  const padding = Math.max(span * 0.15, 1)
  return [Math.floor((dataMin - padding) * 10) / 10, Math.ceil((dataMax + padding) * 10) / 10]
}

/** One metric's own monthly trend, shown as its own small chart — kept separate per metric rather than
 * overlaid, since COGS/G&A/EBITDA each have very different typical scales and ranges. */
export const MetricTrendChart: React.FC<MetricTrendChartProps> = ({ title, description, color, points, isLoading, embedded = false }) => {
  const rows = points.map((p) => ({ month: formatMonth(p.month), value: p.value }))
  const hasAnyData = rows.some((row) => row.value !== null)
  const chartHeight = embedded ? 'h-32' : 'h-56'

  const chart = isLoading ? (
    <div className={`flex ${chartHeight} items-center justify-center text-xs text-ink-3`}>Loading trend…</div>
  ) : !hasAnyData ? (
    <div className={`flex ${chartHeight} items-center justify-center text-xs text-ink-3`}>No trend data available yet.</div>
  ) : (
    <div className={`${embedded ? 'mt-2' : 'mt-3'} ${chartHeight}`}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={rows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid stroke="var(--color-line)" vertical={false} />
          <XAxis dataKey="month" stroke="var(--color-ink-3)" tick={{ fill: 'var(--color-ink-2)', fontSize: 11 }} tickLine={false} axisLine={{ stroke: 'var(--color-line)' }} />
          <YAxis
            stroke="var(--color-ink-3)"
            tick={{ fill: 'var(--color-ink-2)', fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v: number) => `${Number(v.toFixed(1))}%`}
            width={48}
            domain={paddedDomain}
          />
          <Tooltip
            contentStyle={{ background: 'var(--color-surface-3)', border: '1px solid var(--color-line-strong)', borderRadius: 8, fontSize: 12 }}
            labelStyle={{ color: 'var(--color-ink)', fontWeight: 600, marginBottom: 4 }}
            formatter={(value) => [value == null ? 'No data' : `${Number(value).toFixed(1)}%`, title]}
          />
          <Line type="monotone" dataKey="value" name={title} stroke={color} strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 5 }} connectNulls />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )

  if (embedded) return chart

  return (
    <div className="card border-line-strong p-4">
      <h3 className="text-sm font-semibold text-ink">{title}</h3>
      <p className="text-xs text-ink-2">{description}</p>
      {chart}
    </div>
  )
}
