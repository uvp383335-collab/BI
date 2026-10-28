import React from 'react'
import { Link } from 'react-router-dom'
import { Bar, BarChart, CartesianGrid, Cell, LabelList, ResponsiveContainer, Tooltip, TooltipContentProps, XAxis, YAxis } from 'recharts'
import { QualifiedPipelineTrendPoint, QualifiedPipelineTrendResult } from '../api/metricsApi'
import { formatMetricValue } from '../utils/formatMetricValue'

interface QualifiedPipelineTrendChartProps {
  title: string
  data?: QualifiedPipelineTrendResult
  isLoading: boolean
}

const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** "2026-04" -> "Apr '26" */
function formatMonth(month: string): string {
  const monthIndex = Number(month.slice(5, 7)) - 1
  const label = MONTH_LABELS[monthIndex]
  if (!label) return month
  return `${label} '${month.slice(2, 4)}`
}

const PX_PER_MONTH = 76
const MIN_CHART_WIDTH = 420
const MAX_BAR_SIZE = 22

// Mirrors CM-04's own thresholds (cmMetrics.service.ts: CM04_COVERAGE_THRESHOLD / _ACT_NOW_THRESHOLD) —
// same formula applied per month instead of per quarter, so the same read-out bands apply here.
const WATCH_THRESHOLD = 3
const ACT_NOW_THRESHOLD = 2

type Status = 'on-target' | 'watch' | 'act-now' | 'no-target'

function statusOf(ratio: number | null): Status {
  if (ratio === null) return 'no-target'
  if (ratio < ACT_NOW_THRESHOLD) return 'act-now'
  if (ratio < WATCH_THRESHOLD) return 'watch'
  return 'on-target'
}

const STATUS_COLOR: Record<Status, string> = {
  'on-target': 'var(--color-brand)',
  watch: 'var(--color-warning)',
  'act-now': 'var(--color-danger)',
  'no-target': 'var(--color-line-strong)'
}

const STATUS_LABEL: Record<Status, string> = {
  'on-target': 'On target',
  watch: 'Watch',
  'act-now': 'Act now',
  'no-target': 'No target set'
}

interface ChartRow {
  monthLabel: string
  ratio: number | null
  actual: number
  target: number | null
  qualifiedDealCount: number
  status: Status
}

function toChartRow(point: QualifiedPipelineTrendPoint): ChartRow {
  return {
    monthLabel: formatMonth(point.month),
    ratio: point.ratio,
    actual: point.actual,
    target: point.target,
    qualifiedDealCount: point.qualifiedDealCount,
    status: statusOf(point.ratio)
  }
}

function CustomTooltip({ active, payload }: TooltipContentProps) {
  const row = payload?.[0]?.payload as ChartRow | undefined
  if (!active || !row) return null
  const color = STATUS_COLOR[row.status]

  return (
    <div
      style={{
        background: 'var(--color-surface-3)',
        border: '1px solid var(--color-line-strong)',
        borderRadius: 8,
        padding: '10px 12px',
        fontSize: 12,
        minWidth: 200
      }}
    >
      <div style={{ color: 'var(--color-ink)', fontWeight: 600, marginBottom: 6 }}>{row.monthLabel}</div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <span style={{ display: 'inline-block', width: 9, height: 9, borderRadius: 2, background: color, flexShrink: 0 }} />
        <span style={{ color: 'var(--color-ink)', fontWeight: 700, fontSize: 15 }}>{row.ratio === null ? '—' : formatMetricValue(row.ratio, 'multiple')}</span>
        <span style={{ color, fontWeight: 500 }}>{STATUS_LABEL[row.status]}</span>
      </div>
      <div style={{ marginTop: 6, color: 'var(--color-ink-2)' }}>
        {formatMetricValue(row.actual, 'usd')} qualified pipeline
        {row.target !== null ? ` of ${formatMetricValue(row.target, 'usd')} target` : ' — no target set for this month'}
      </div>
      <div style={{ marginTop: 2, color: 'var(--color-ink-3)' }}>
        {row.qualifiedDealCount} qualified {row.qualifiedDealCount === 1 ? 'deal' : 'deals'} created
      </div>
    </div>
  )
}

const LEGEND_ITEMS: { status: Status; label: string }[] = [
  { status: 'on-target', label: `On target (≥ ${WATCH_THRESHOLD}x)` },
  { status: 'watch', label: `Watch (${ACT_NOW_THRESHOLD}–${WATCH_THRESHOLD}x)` },
  { status: 'act-now', label: `Act now (< ${ACT_NOW_THRESHOLD}x)` }
]

/**
 * Dashboard chart: CM-04's own formula (qualified new-business pipeline /
 * target) applied per calendar month instead of per quarter — "how did
 * coverage actually trend month to month," rather than CM-04 card's single
 * forward-looking next-quarter snapshot. Bucketed by the deal's created
 * date, matching the qualification/new-business logic CM-04 itself uses.
 * Bars are colored against CM-04's own watch/act-now bands so a dip reads
 * the same way here as it does on the card. Every bar carries its own
 * printed value (never only a tooltip), so the ratio reads correctly even
 * for colorblind viewers or at a glance across a wide magnitude range.
 */
export const QualifiedPipelineTrendChart: React.FC<QualifiedPipelineTrendChartProps> = ({ title, data, isLoading }) => {
  const points = data?.points ?? []
  const rows: ChartRow[] = points.map(toChartRow)
  const missingTargetMonths = points.filter((p) => p.target === null).map((p) => p.month)
  const chartWidth = Math.max(MIN_CHART_WIDTH, rows.length * PX_PER_MONTH)

  return (
    <div className="card p-6 sm:col-span-2 xl:col-span-3">
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div>
          <h2 className="text-lg font-semibold text-ink">{title}</h2>
          <p className="mt-1 max-w-xl text-sm text-ink-2">
            Qualified new-business pipeline created each month, divided by that month's target set in Settings — CM-04's formula, applied month by month.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-ink-2">
          {LEGEND_ITEMS.map(({ status, label }) => (
            <span key={status} className="flex items-center gap-1.5 whitespace-nowrap">
              <span className="inline-block h-2.5 w-2.5 rounded-[2px]" style={{ backgroundColor: STATUS_COLOR[status] }} />
              {label}
            </span>
          ))}
        </div>
      </div>

      {isLoading ? (
        <p className="mt-6 text-sm text-ink-3">Loading…</p>
      ) : points.length === 0 ? (
        <p className="mt-6 text-sm text-ink-3">Not enough synced data yet for this view — check back after the next sync.</p>
      ) : (
        <>
          <div className="mt-5 overflow-x-auto">
            <div style={{ minWidth: chartWidth, height: 340 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={rows} margin={{ top: 22, right: 12, left: 0, bottom: 4 }} barCategoryGap="38%">
                  <CartesianGrid stroke="var(--color-line)" vertical={false} />
                  <XAxis
                    dataKey="monthLabel"
                    stroke="var(--color-ink-3)"
                    tick={{ fill: 'var(--color-ink-2)', fontSize: 12 }}
                    tickLine={false}
                    axisLine={{ stroke: 'var(--color-line)' }}
                    interval={0}
                    padding={{ left: 16, right: 16 }}
                  />
                  <YAxis
                    stroke="var(--color-ink-3)"
                    tick={{ fill: 'var(--color-ink-2)', fontSize: 11 }}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(v: number) => (v !== 0 && Math.abs(v) < 1 ? `${v.toFixed(1)}x` : `${Math.round(v)}x`)}
                    width={44}
                  />
                  <Tooltip cursor={{ fill: 'var(--color-surface-3)' }} content={CustomTooltip} />
                  <Bar dataKey="ratio" name="ratio" radius={[4, 4, 0, 0]} maxBarSize={MAX_BAR_SIZE} isAnimationActive={false}>
                    {rows.map((row, index) => (
                      <Cell key={index} fill={STATUS_COLOR[row.status]} />
                    ))}
                    <LabelList
                      dataKey="ratio"
                      position="top"
                      offset={8}
                      fill="var(--color-ink-2)"
                      fontSize={10.5}
                      formatter={(value: unknown) => (value === null || value === undefined ? '–' : formatMetricValue(Number(value), 'multiple'))}
                    />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
          {missingTargetMonths.length > 0 && (
            <p className="mt-3 text-xs text-ink-3">
              Target not set for {missingTargetMonths.map(formatMonth).join(', ')} — ratio not computable —{' '}
              <Link to="/settings" className="text-brand hover:underline">
                set it in Settings
              </Link>
              .
            </p>
          )}
        </>
      )}
    </div>
  )
}
