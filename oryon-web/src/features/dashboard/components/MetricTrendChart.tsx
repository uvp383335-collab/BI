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
  /** For VC-13: which revenue value to display ('percentage' or 'absolute') */
  viewMode?: 'percentage' | 'absolute'
  /** Which metric is this chart for — used to determine how to extract values from TrendPoint */
  metricId?: string
}

const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** "Feb '24" — a bare month name is ambiguous once the "From year" filter spans more than one calendar year. */
function formatMonth(month: string): string {
  const monthIndex = Number(month.slice(5, 7)) - 1
  const label = MONTH_LABELS[monthIndex]
  if (!label) return month
  return `${label} '${month.slice(2, 4)}`
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
// Fixed px-per-month so a wide "From year" range (e.g. 2018 to now) never has to drop
// or thin out points to stay readable — every month gets the same guaranteed label
// width, and the chart scrolls horizontally instead (matches ProductRevenueGrowthChart's
// same approach to the same problem).
const PX_PER_MONTH = 100
const MIN_CHART_WIDTH = 360

export const MetricTrendChart: React.FC<MetricTrendChartProps> = ({ title, description, color, points, isLoading, embedded = false, viewMode, metricId }) => {
  const rows = points.map((p) => {
    let value = p.value
    // For VC-13, select between revenue (absolute) and revenueGrowthPct (percentage) based on viewMode
    if (metricId === 'vc-13') {
      if (viewMode === 'absolute' && p.revenue !== null && p.revenue !== undefined) {
        value = p.revenue
      } else if (viewMode === 'percentage' && p.revenueGrowthPct !== null && p.revenueGrowthPct !== undefined) {
        value = p.revenueGrowthPct
      }
    }
    return { month: formatMonth(p.month), value }
  })
  const hasAnyData = rows.some((row) => row.value !== null)
  const chartHeight = embedded ? 'h-44' : 'h-64'
  const chartWidth = Math.max(MIN_CHART_WIDTH, rows.length * PX_PER_MONTH)

  const chart = isLoading ? (
    <div className={`flex ${chartHeight} items-center justify-center text-xs text-ink-3`}>Loading trend…</div>
  ) : !hasAnyData ? (
    <div className={`flex ${chartHeight} items-center justify-center text-xs text-ink-3`}>No trend data available yet.</div>
  ) : (
    <div className={`${embedded ? 'mt-3' : 'mt-4'} ${chartHeight} overflow-x-auto metric-trend-scroll`}>
      <div style={{ width: chartWidth }} className="h-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={rows} margin={{ top: 8, right: 8, left: 12, bottom: 0 }}>
            <CartesianGrid stroke="var(--color-line)" vertical={false} />
            <XAxis
              dataKey="month"
              stroke="var(--color-ink-3)"
              tick={{ fill: 'var(--color-ink-2)', fontSize: 14 }}
              tickLine={false}
              axisLine={{ stroke: 'var(--color-line)' }}
              interval={0}
            />
            <YAxis
              stroke="var(--color-ink-3)"
              tick={{ fill: 'var(--color-ink-2)', fontSize: 14 }}
              tickLine={false}
              axisLine={false}
              tickFormatter={(v: number) => metricId === 'vc-13' && viewMode === 'absolute' ? `$${(v / 1000).toFixed(0)}k` : `${Number(v.toFixed(1))}%`}
              width={70}
              domain={paddedDomain}
            />
            <Tooltip
              contentStyle={{ background: 'var(--color-surface-3)', border: '1px solid var(--color-line-strong)', borderRadius: 8, fontSize: 12 }}
              labelStyle={{ color: 'var(--color-ink)', fontWeight: 600, marginBottom: 4 }}
              formatter={(value: any) => {
                if (value == null) return 'No data'
                if (metricId === 'vc-13' && viewMode === 'absolute') {
                  return `$${(Number(value) / 1000).toFixed(1)}k`
                }
                return `${Number(value).toFixed(1)}%`
              }}
            />
            <Line type="monotone" dataKey="value" name={title} stroke={color} strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 5 }} connectNulls />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  )

  if (embedded) return chart

  return (
    <div className="card border-line-strong p-5">
      <h3 className="text-base font-semibold text-ink">{title}</h3>
      <p className="text-sm text-ink-2">{description}</p>
      {chart}
    </div>
  )
}
