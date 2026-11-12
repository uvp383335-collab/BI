import React from 'react'
import { Link } from 'react-router-dom'
import { Bar, BarChart, CartesianGrid, Cell, LabelList, ResponsiveContainer, Tooltip, TooltipContentProps, XAxis, YAxis } from 'recharts'
import { LeadVolumeVsTargetPoint, LeadVolumeVsTargetResult } from '../api/metricsApi'
import { formatMetricValue } from '../utils/formatMetricValue'

interface LeadVolumeVsTargetMqlChartProps {
  data?: LeadVolumeVsTargetResult
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

type Status = 'on-target' | 'below-target' | 'no-target'

// No existing business rule for this ratio (unlike CM-04's 2x/3x coverage bands) — "met vs.
// missed" is the simplest defensible default for a brand-new metric with no precedent.
function statusOf(ratioPct: number | null): Status {
  if (ratioPct === null) return 'no-target'
  return ratioPct >= 100 ? 'on-target' : 'below-target'
}

const STATUS_COLOR: Record<Status, string> = {
  'on-target': 'var(--color-brand)',
  'below-target': 'var(--color-danger)',
  'no-target': 'var(--color-line-strong)'
}

const STATUS_LABEL: Record<Status, string> = {
  'on-target': 'On target',
  'below-target': 'Below target',
  'no-target': 'No target set'
}

interface ChartRow {
  monthLabel: string
  ratioPct: number | null
  leadVolume: number
  target: number | null
  status: Status
}

function toChartRow(point: LeadVolumeVsTargetPoint): ChartRow {
  return {
    monthLabel: formatMonth(point.month),
    ratioPct: point.ratioPct,
    leadVolume: point.leadVolume,
    target: point.target,
    status: statusOf(point.ratioPct)
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
        <span style={{ color: 'var(--color-ink)', fontWeight: 700, fontSize: 15 }}>{row.ratioPct === null ? '—' : formatMetricValue(row.ratioPct, 'percent')}</span>
        <span style={{ color, fontWeight: 500 }}>{STATUS_LABEL[row.status]}</span>
      </div>
      <div style={{ marginTop: 6, color: 'var(--color-ink-2)' }}>
        {row.leadVolume} leads at Lead stage{row.target !== null ? ` of ${row.target} target` : ' — no target set for this month'}
      </div>
    </div>
  )
}

const LEGEND_ITEMS: { status: Status; label: string }[] = [
  { status: 'on-target', label: 'On target (≥ 100%)' },
  { status: 'below-target', label: 'Below target (< 100%)' }
]

/**
 * Dashboard chart, below "Competitor Analysis": same visual convention as
 * CM-04's "Pipeline Coverage Ratio (Monthly)" (QualifiedPipelineTrendChart)
 * — bars plot the ratio itself (not the raw count), color-coded by status,
 * with every bar carrying its own printed value. The underlying ratio is
 * leadVolume (contacts sitting at the Lead stage as of each month's start)
 * divided by the "Lead Volume target (Target MQL)" set in Settings. Unlike
 * CM-04's 2x/3x watch/act-now bands, this metric has no established
 * thresholds yet, so it's a simple met-target/below-target split. See
 * leadVolumeVsTarget.service.ts for how the snapshot is computed.
 */
export const LeadVolumeVsTargetMqlChart: React.FC<LeadVolumeVsTargetMqlChartProps> = ({ data, isLoading }) => {
  const points = data?.points ?? []
  const rows: ChartRow[] = points.map(toChartRow)
  const missingTargetMonths = data?.missingTargetMonths ?? []
  const chartWidth = Math.max(MIN_CHART_WIDTH, rows.length * PX_PER_MONTH)

  return (
    <div className="card p-6">
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div>
          <h2 className="text-lg font-semibold text-ink">Lead Volume vs. Target MQL</h2>
          <p className="mt-1 max-w-xl text-sm text-ink-2">
            HubSpot contacts sitting at the Lead stage at the start of each month, divided by that month's target set in Settings.
          </p>
        </div>
        {rows.length > 0 && (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-ink-2">
            {LEGEND_ITEMS.map(({ status, label }) => (
              <span key={status} className="flex items-center gap-1.5 whitespace-nowrap">
                <span className="inline-block h-2.5 w-2.5 rounded-[2px]" style={{ backgroundColor: STATUS_COLOR[status] }} />
                {label}
              </span>
            ))}
          </div>
        )}
      </div>

      {isLoading ? (
        <p className="mt-6 text-sm text-ink-3">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="mt-6 text-sm text-ink-3">Not enough synced HubSpot data yet for this view — check back after the next sync.</p>
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
                    tickFormatter={(v: number) => `${Math.round(v)}%`}
                    width={48}
                  />
                  <Tooltip cursor={{ fill: 'var(--color-surface-3)' }} content={CustomTooltip} />
                  <Bar dataKey="ratioPct" name="ratioPct" radius={[4, 4, 0, 0]} maxBarSize={MAX_BAR_SIZE} isAnimationActive={false}>
                    {rows.map((row, index) => (
                      <Cell key={index} fill={STATUS_COLOR[row.status]} />
                    ))}
                    <LabelList
                      dataKey="ratioPct"
                      position="top"
                      offset={8}
                      fill="var(--color-ink-2)"
                      fontSize={10.5}
                      formatter={(value: unknown) => (value === null || value === undefined ? '–' : formatMetricValue(Number(value), 'percent'))}
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
