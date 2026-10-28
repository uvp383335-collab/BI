import React, { useState } from 'react'
import { Link } from 'react-router-dom'
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { RecurringRevenueTrendGranularity, RecurringRevenueTrendResult } from '../api/productRevenueGrowthApi'
import { formatMetricValue } from '../utils/formatMetricValue'

interface RecurringRevenueTrendChartProps {
  data?: RecurringRevenueTrendResult
  isLoading: boolean
  granularity: RecurringRevenueTrendGranularity
  onGranularityChange: (granularity: RecurringRevenueTrendGranularity) => void
}

type ViewMode = 'revenue' | 'growth'

const QUARTER_LABELS = ['Q1', 'Q2', 'Q3', 'Q4']
const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** "2026-04" -> "Q2 '26" (quarterly) or "Apr '26" (monthly). */
function formatPeriodLabel(period: string, granularity: RecurringRevenueTrendGranularity): string {
  const [year, month] = period.split('-').map(Number)
  const yearSuffix = String(year).slice(2)
  if (granularity === 'quarterly') return `${QUARTER_LABELS[Math.floor((month - 1) / 3)]} '${yearSuffix}`
  return `${MONTH_LABELS[month - 1]} '${yearSuffix}`
}

function formatValue(value: number | null | undefined, viewMode: ViewMode): string {
  if (value === null || value === undefined) return '—'
  return viewMode === 'revenue' ? formatMetricValue(value, 'usd') : formatMetricValue(value, 'percent')
}

/**
 * Dashboard bar chart: recurring vs. non-recurring revenue over the trailing
 * 6 quarters or 18 months — the same product-category split VC-13 uses
 * for a single quarter (see backend's recurringRevenueTrend.service.ts),
 * plotted as a trend so growth or decline in each stream is visible at a
 * glance instead of only as one ratio. Not a `MetricCard` — there's no
 * single headline value here, just two series, so this renders its own
 * standalone card.
 */
export const RecurringRevenueTrendChart: React.FC<RecurringRevenueTrendChartProps> = ({ data, isLoading, granularity, onGranularityChange }) => {
  const [viewMode, setViewMode] = useState<ViewMode>('revenue')

  const points = data?.points ?? []
  const rows = points.map((point) => ({
    period: formatPeriodLabel(point.period, granularity),
    recurring: viewMode === 'revenue' ? point.recurringRevenue : point.recurringGrowthPct,
    nonRecurring: viewMode === 'revenue' ? point.nonRecurringRevenue : point.nonRecurringGrowthPct
  }))

  // Monthly view has 3x the bars of quarterly (18 vs 6) — scroll horizontally rather than
  // compressing bars, same approach as ProductRevenueGrowthChart/MetricTrendChart.
  const perPointWidth = granularity === 'monthly' ? 56 : 90
  const chartWidth = Math.max(360, rows.length * perPointWidth)

  return (
    <div className="card p-6 lg:col-span-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-ink">Recurring vs. non-recurring revenue</h2>
          <p className="mt-1 text-sm text-ink-2">
            {granularity === 'quarterly' ? 'Trailing 6 quarters' : 'Trailing 18 months'}, split by how each product is categorized in Settings.
          </p>
        </div>
        {data?.hasCategorizedProducts && (
          <div className="flex flex-wrap items-center gap-4 text-sm text-ink-2">
            <div className="flex items-center gap-4">
              <label className="flex items-center gap-1.5">
                <input type="radio" name="recurringRevenueTrendGranularity" checked={granularity === 'quarterly'} onChange={() => onGranularityChange('quarterly')} />
                Quarterly
              </label>
              <label className="flex items-center gap-1.5">
                <input type="radio" name="recurringRevenueTrendGranularity" checked={granularity === 'monthly'} onChange={() => onGranularityChange('monthly')} />
                Monthly
              </label>
            </div>
            {points.length > 0 && (
              <div className="flex items-center gap-4">
                <label className="flex items-center gap-1.5">
                  <input type="radio" name="recurringRevenueTrendViewMode" checked={viewMode === 'revenue'} onChange={() => setViewMode('revenue')} />
                  Revenue
                </label>
                <label className="flex items-center gap-1.5">
                  <input type="radio" name="recurringRevenueTrendViewMode" checked={viewMode === 'growth'} onChange={() => setViewMode('growth')} />
                  Growth %
                </label>
              </div>
            )}
          </div>
        )}
      </div>

      {isLoading ? (
        <p className="mt-4 text-sm text-ink-3">Loading…</p>
      ) : data?.needsResync ? (
        <p className="mt-4 text-sm text-ink-3">
          The monthly view needs a one-time full resync to read per-product detail from your QuickBooks invoices. Go to{' '}
          <Link to="/settings" className="text-brand hover:underline">
            Settings
          </Link>
          {' '}and click "Force full resync" next to QuickBooks, then check back once it finishes.
        </p>
      ) : points.length === 0 ? (
        <p className="mt-4 text-sm text-ink-3">
          No categorized products yet — mark products as recurring or non-recurring in{' '}
          <Link to="/settings" className="text-brand hover:underline">
            Settings
          </Link>{' '}
          to see this trend.
        </p>
      ) : (
        <div className="mt-4 overflow-x-auto">
          {/* `minWidth` (not `width`) so the chart fills the card on a normal-width screen — it only
              grows past 100% (triggering the scrollbar above) once there are too many bars to fit. */}
          <div style={{ minWidth: chartWidth, height: 340 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={rows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barCategoryGap="22%" barGap={2}>
                <CartesianGrid stroke="var(--color-line)" vertical={false} />
                <XAxis
                  dataKey="period"
                  stroke="var(--color-ink-3)"
                  tick={{ fill: 'var(--color-ink-2)', fontSize: 12 }}
                  tickLine={false}
                  axisLine={{ stroke: 'var(--color-line)' }}
                  interval="preserveStartEnd"
                  minTickGap={12}
                  padding={{ left: 12, right: 12 }}
                />
                <YAxis
                  stroke="var(--color-ink-3)"
                  tick={{ fill: 'var(--color-ink-2)', fontSize: 11 }}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(v: number) => formatValue(v, viewMode)}
                  width={76}
                />
                <Tooltip
                  cursor={{ fill: 'var(--color-surface-3)' }}
                  contentStyle={{ background: 'var(--color-surface-3)', border: '1px solid var(--color-line-strong)', borderRadius: 8, fontSize: 12 }}
                  labelStyle={{ color: 'var(--color-ink)', fontWeight: 600, marginBottom: 4 }}
                  formatter={(value, name) => [formatValue(typeof value === 'number' ? value : null, viewMode), name]}
                />
                <Legend wrapperStyle={{ fontSize: 12, paddingTop: 8 }} iconType="circle" iconSize={8} />
                <Bar dataKey="recurring" name="Recurring" fill="var(--color-brand)" radius={[3, 3, 0, 0]} maxBarSize={40} />
                <Bar dataKey="nonRecurring" name="Non-recurring" fill="var(--color-violet)" radius={[3, 3, 0, 0]} maxBarSize={40} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </div>
  )
}
