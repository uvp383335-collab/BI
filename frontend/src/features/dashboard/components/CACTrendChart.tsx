import React from 'react'
import { Link } from 'react-router-dom'
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { CACTrendResult } from '../api/productRevenueGrowthApi'
import { formatMetricValue } from '../utils/formatMetricValue'

interface CACTrendChartProps {
  data?: CACTrendResult
  isLoading: boolean
}

const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** "2026-04" -> "Apr '26". */
function formatMonthLabel(month: string): string {
  const [year, m] = month.split('-').map(Number)
  return `${MONTH_LABELS[m - 1]} '${String(year).slice(2)}`
}

/** A single month renders as "Apr '26"; a multi-month window renders as a range "Jan–Feb '26". */
function formatPeriodLabel(periodStart: string, periodEnd: string): string {
  if (periodStart === periodEnd) return formatMonthLabel(periodStart)
  const [, startMonth] = periodStart.split('-').map(Number)
  const [endYear, endMonth] = periodEnd.split('-').map(Number)
  return `${MONTH_LABELS[startMonth - 1]}–${MONTH_LABELS[endMonth - 1]} '${String(endYear).slice(2)}`
}

function formatCac(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—'
  return formatMetricValue(value, 'usd')
}

interface CACChartRow {
  period: string
  cac: number | null
  expense: number
  newCustomers: number
}

/** Custom tooltip (Recharts' `formatter` prop can only format plotted series, not extra fields) — shows CAC plus the two inputs it's derived from. */
const CACTooltip: React.FC<{ active?: boolean; payload?: { payload: CACChartRow }[]; label?: string }> = ({ active, payload, label }) => {
  if (!active || !payload || payload.length === 0) return null
  const row = payload[0].payload
  return (
    <div style={{ background: 'var(--color-surface-3)', border: '1px solid var(--color-line-strong)', borderRadius: 8, padding: '8px 12px', fontSize: 12 }}>
      <div style={{ color: 'var(--color-ink)', fontWeight: 600, marginBottom: 4 }}>{label}</div>
      <div style={{ color: 'var(--color-teal)', fontWeight: 600 }}>CAC: {formatCac(row.cac)}</div>
      <div style={{ color: 'var(--color-ink-2)', marginTop: 2 }}>Marketing expense: {formatMetricValue(row.expense, 'usd')}</div>
      <div style={{ color: 'var(--color-ink-2)' }}>New customers: {row.newCustomers.toLocaleString()}</div>
    </div>
  )
}

/**
 * Dashboard bar chart: Customer Acquisition Cost — configured acquisition
 * spend ÷ new customers, summed over non-overlapping windows of the org's
 * configured duration (Settings, not a dashboard toggle — unlike every
 * other trend chart here, there's no granularity control). Windows are
 * consecutive and never overlap: a 2-month duration shows Jan+Feb as one
 * bar, then Mar+Apr as the next, never a sliding month-over-month average.
 * Both data sources are pre-synced storage (PLMonthlySnapshot + Invoice),
 * zero live QuickBooks calls.
 */
export const CACTrendChart: React.FC<CACTrendChartProps> = ({ data, isLoading }) => {
  const points = data?.points ?? []
  const rows: CACChartRow[] = points.map((point) => ({
    period: formatPeriodLabel(point.periodStart, point.periodEnd),
    cac: point.cac,
    expense: point.expense,
    newCustomers: point.newCustomers
  }))

  const chartWidth = Math.max(360, rows.length * 90)

  // Weighted by each window's new-customer count (total spend ÷ total new customers across every
  // plotted window) rather than an unweighted mean of each window's CAC — a low-volume window
  // shouldn't count as much as a high-volume one.
  const totalExpense = points.reduce((sum, point) => sum + point.expense, 0)
  const totalNewCustomers = points.reduce((sum, point) => sum + point.newCustomers, 0)
  const averageCac = totalNewCustomers > 0 ? totalExpense / totalNewCustomers : null

  return (
    <div className="card p-6 lg:col-span-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-ink">Customer Acquisition Cost</h2>
          <p className="mt-1 text-sm text-ink-2">Configured acquisition spend ÷ new customers, per non-overlapping window (window size set in Settings).</p>
        </div>
        {points.length > 0 && (
          <div className="text-right">
            <p className="text-xs text-ink-3">Average CAC</p>
            <p className="text-lg font-semibold text-teal">{formatCac(averageCac)}</p>
          </div>
        )}
      </div>

      {isLoading ? (
        <p className="mt-4 text-sm text-ink-3">Loading…</p>
      ) : !data?.hasConfiguredSettings ? (
        <p className="mt-4 text-sm text-ink-3">
          Not configured yet — pick which QuickBooks expense accounts count as acquisition spend and a window duration in{' '}
          <Link to="/settings" className="text-brand hover:underline">
            Settings
          </Link>{' '}
          to see this trend.
        </p>
      ) : points.length === 0 ? (
        <p className="mt-4 text-sm text-ink-3">Not enough synced data yet for a full window — check back after the next sync.</p>
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
                  tickFormatter={(v: number) => formatCac(v)}
                  width={64}
                />
                <Tooltip cursor={{ fill: 'var(--color-surface-3)' }} content={<CACTooltip />} />
                <Bar dataKey="cac" name="CAC" fill="var(--color-teal)" radius={[3, 3, 0, 0]} maxBarSize={40} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </div>
  )
}
