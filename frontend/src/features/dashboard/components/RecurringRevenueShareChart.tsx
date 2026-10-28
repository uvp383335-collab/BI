import React from 'react'
import { Link } from 'react-router-dom'
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { RecurringRevenueTrendGranularity, RecurringRevenueTrendResult } from '../api/productRevenueGrowthApi'
import { formatMetricValue } from '../utils/formatMetricValue'

interface RecurringRevenueShareChartProps {
  data?: RecurringRevenueTrendResult
  isLoading: boolean
  granularity: RecurringRevenueTrendGranularity
}

const QUARTER_LABELS = ['Q1', 'Q2', 'Q3', 'Q4']
const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** "2026-04" -> "Q2 '26" (quarterly) or "Apr '26" (monthly) — same formatting as RecurringRevenueTrendChart. */
function formatPeriodLabel(period: string, granularity: RecurringRevenueTrendGranularity): string {
  const [year, month] = period.split('-').map(Number)
  const yearSuffix = String(year).slice(2)
  if (granularity === 'quarterly') return `${QUARTER_LABELS[Math.floor((month - 1) / 3)]} '${yearSuffix}`
  return `${MONTH_LABELS[month - 1]} '${yearSuffix}`
}

function formatPct(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—'
  return formatMetricValue(value, 'percent')
}

/**
 * Dashboard bar chart: recurring revenue as a share of total revenue
 * (recurring + non-recurring), over the same trailing window as "Recurring
 * vs. non-recurring revenue" directly above it — same `granularity` toggle,
 * same data, no second backend call. One calculation: recurring / (recurring
 * + non-recurring) * 100 per period, derived client-side from the same
 * points that chart already fetched.
 */
export const RecurringRevenueShareChart: React.FC<RecurringRevenueShareChartProps> = ({ data, isLoading, granularity }) => {
  const points = data?.points ?? []
  const rows = points.map((point) => {
    const total = point.recurringRevenue + point.nonRecurringRevenue
    return { period: formatPeriodLabel(point.period, granularity), sharePct: total > 0 ? (point.recurringRevenue / total) * 100 : null }
  })

  // Monthly view has 3x the bars of quarterly (18 vs 6) — scroll horizontally rather than
  // compressing bars, same approach as RecurringRevenueTrendChart.
  const perPointWidth = granularity === 'monthly' ? 56 : 90
  const chartWidth = Math.max(360, rows.length * perPointWidth)

  return (
    <div className="card p-6 lg:col-span-3">
      <div>
        <h2 className="text-lg font-semibold text-ink">Recurring revenue % of total</h2>
        <p className="mt-1 text-sm text-ink-2">
          {granularity === 'quarterly' ? 'Trailing 6 quarters' : 'Trailing 18 months'}, recurring revenue as a share of recurring + non-recurring combined.
        </p>
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
          {/* `minWidth` (not `width`) so the chart fills the card on a normal-width screen. */}
          <div style={{ minWidth: chartWidth, height: 320 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={rows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barCategoryGap="22%">
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
                  domain={[0, 100]}
                  tickFormatter={(v: number) => formatPct(v)}
                  width={56}
                />
                <Tooltip
                  cursor={{ fill: 'var(--color-surface-3)' }}
                  contentStyle={{ background: 'var(--color-surface-3)', border: '1px solid var(--color-line-strong)', borderRadius: 8, fontSize: 12 }}
                  labelStyle={{ color: 'var(--color-ink)', fontWeight: 600, marginBottom: 4 }}
                  formatter={(value) => [formatPct(typeof value === 'number' ? value : null), 'Recurring share']}
                />
                <Bar dataKey="sharePct" name="Recurring share" fill="var(--color-brand)" radius={[3, 3, 0, 0]} maxBarSize={40} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </div>
  )
}
