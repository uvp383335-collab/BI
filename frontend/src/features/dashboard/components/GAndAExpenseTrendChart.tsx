import React from 'react'
import { Link } from 'react-router-dom'
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { GAndAExpenseTrendGranularity, GAndAExpenseTrendResult } from '../api/productRevenueGrowthApi'
import { formatMetricValue } from '../utils/formatMetricValue'

interface GAndAExpenseTrendChartProps {
  data?: GAndAExpenseTrendResult
  isLoading: boolean
  granularity: GAndAExpenseTrendGranularity
  onGranularityChange: (granularity: GAndAExpenseTrendGranularity) => void
}

const QUARTER_LABELS = ['Q1', 'Q2', 'Q3', 'Q4']
const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** "2026-04" -> "Q2 '26" (quarterly) or "Apr '26" (monthly); "2026" -> "2026" as-is (yearly). */
function formatPeriodLabel(period: string, granularity: GAndAExpenseTrendGranularity): string {
  if (granularity === 'yearly') return period
  const [year, month] = period.split('-').map(Number)
  const yearSuffix = String(year).slice(2)
  if (granularity === 'quarterly') return `${QUARTER_LABELS[Math.floor((month - 1) / 3)]} '${yearSuffix}`
  return `${MONTH_LABELS[month - 1]} '${yearSuffix}`
}

function formatPct(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—'
  return formatMetricValue(value, 'percent')
}

const GRANULARITY_DESCRIPTION: Record<GAndAExpenseTrendGranularity, string> = {
  quarterly: 'Trailing 6 quarters',
  monthly: 'Trailing 18 months',
  yearly: 'Trailing 3 years'
}

/**
 * Dashboard bar chart: G&A % of Revenue — sums exactly the G&A expense
 * accounts the org picked in Settings (never guessed from account names)
 * divided by total revenue, per period. Monthly/Quarterly/Yearly all read
 * pre-synced storage (PLSnapshot/PLMonthlySnapshot), zero live QuickBooks
 * calls. Single-series bar, same visual language as RecurringRevenueShareChart.
 */
export const GAndAExpenseTrendChart: React.FC<GAndAExpenseTrendChartProps> = ({ data, isLoading, granularity, onGranularityChange }) => {
  const points = data?.points ?? []
  const rows = points.map((point) => ({ period: formatPeriodLabel(point.period, granularity), gaPct: point.gaPct }))

  // Monthly view has the most bars — scroll horizontally rather than compressing bars,
  // same approach as every other trend chart on this dashboard.
  const perPointWidth = granularity === 'monthly' ? 56 : 90
  const chartWidth = Math.max(360, rows.length * perPointWidth)

  return (
    <div className="card p-6 lg:col-span-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-ink">G&A % of Revenue</h2>
          <p className="mt-1 text-sm text-ink-2">{GRANULARITY_DESCRIPTION[granularity]}, G&A expense (as configured in Settings) as a share of total revenue.</p>
        </div>
        {data?.hasConfiguredAccounts && (
          <div className="flex items-center gap-4 text-sm text-ink-2">
            <label className="flex items-center gap-1.5">
              <input type="radio" name="gaExpenseTrendGranularity" checked={granularity === 'monthly'} onChange={() => onGranularityChange('monthly')} />
              Monthly
            </label>
            <label className="flex items-center gap-1.5">
              <input type="radio" name="gaExpenseTrendGranularity" checked={granularity === 'quarterly'} onChange={() => onGranularityChange('quarterly')} />
              Quarterly
            </label>
            <label className="flex items-center gap-1.5">
              <input type="radio" name="gaExpenseTrendGranularity" checked={granularity === 'yearly'} onChange={() => onGranularityChange('yearly')} />
              Yearly
            </label>
          </div>
        )}
      </div>

      {isLoading ? (
        <p className="mt-4 text-sm text-ink-3">Loading…</p>
      ) : !data?.hasConfiguredAccounts ? (
        <p className="mt-4 text-sm text-ink-3">
          No G&A expense accounts configured yet — pick which QuickBooks expense accounts count as G&A in{' '}
          <Link to="/settings" className="text-brand hover:underline">
            Settings
          </Link>{' '}
          to see this trend.
        </p>
      ) : points.length === 0 ? (
        <p className="mt-4 text-sm text-ink-3">Not enough synced data yet for this view — check back after the next sync.</p>
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
                  tickFormatter={(v: number) => formatPct(v)}
                  width={56}
                />
                <Tooltip
                  cursor={{ fill: 'var(--color-surface-3)' }}
                  contentStyle={{ background: 'var(--color-surface-3)', border: '1px solid var(--color-line-strong)', borderRadius: 8, fontSize: 12 }}
                  labelStyle={{ color: 'var(--color-ink)', fontWeight: 600, marginBottom: 4 }}
                  formatter={(value) => [formatPct(typeof value === 'number' ? value : null), 'G&A % of Revenue']}
                />
                <Bar dataKey="gaPct" name="G&A % of Revenue" fill="var(--color-violet)" radius={[3, 3, 0, 0]} maxBarSize={40} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </div>
  )
}
