import React, { useState } from 'react'
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Download, Loader2 } from 'lucide-react'
import { StageConversionGranularity } from '../api/metricsApi'

export interface StageConversionTrendChartPoint {
  periodStart: string
  fromCount: number
  toCount: number
  conversionRatePct: number | null
}

interface StageConversionTrendChartProps {
  title: string
  /** e.g. "Lead" / "MQL" — used for the tooltip's "x of y <fromLabel>s" phrasing. */
  fromLabel: string
  granularity: StageConversionGranularity
  points: StageConversionTrendChartPoint[]
  isLoading: boolean
  /** Fetches the record-level detail and downloads it as an Excel workbook — omitted hides the export button entirely. */
  onExport?: () => Promise<void>
}

const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** "Feb '24" / "Q1 '24" / "2024" depending on granularity — same cross-year disambiguation as MetricTrendChart's "Feb '24" for the month/quarter cases. */
function formatPeriod(periodStart: string, granularity: StageConversionGranularity): string {
  const [year, month] = periodStart.split('-').map(Number)
  if (!year || !month) return periodStart
  if (granularity === 'yearly') return String(year)
  if (granularity === 'monthly') return `${MONTH_LABELS[month - 1]} '${String(year).slice(2, 4)}`
  const quarter = Math.floor((month - 1) / 3) + 1
  return `Q${quarter} '${String(year).slice(2, 4)}`
}

const PX_PER_POINT = 110
const MIN_CHART_WIDTH = 360

/**
 * Stage-to-stage cohort conversion rate over time, as a trend line, at
 * monthly/quarterly/yearly granularity. Each point is CM-06's own cohort
 * math (records that first entered the "from" stage that period, and the
 * share of them that went on to enter the "to" stage), so this reads as
 * "the same rate CM-06 alerts on, traced over time" rather than a separate
 * definition of conversion. Shared by the Lead -> MQL and MQL -> SQL charts
 * — only the data and labels differ.
 */
export const StageConversionTrendChart: React.FC<StageConversionTrendChartProps> = ({ title, fromLabel, granularity, points, isLoading, onExport }) => {
  const [isExporting, setIsExporting] = useState(false)

  const handleExport = async () => {
    if (!onExport || isExporting) return
    setIsExporting(true)
    try {
      await onExport()
    } catch (err) {
      console.error('Failed to export conversion detail to Excel', err)
    } finally {
      setIsExporting(false)
    }
  }

  const rows = points.map((p) => ({
    period: formatPeriod(p.periodStart, granularity),
    rate: p.conversionRatePct,
    fromCount: p.fromCount,
    toCount: p.toCount
  }))
  const hasAnyData = rows.some((row) => row.rate !== null)
  const chartWidth = Math.max(MIN_CHART_WIDTH, rows.length * PX_PER_POINT)

  const chart = isLoading ? (
    <div className="flex h-64 items-center justify-center text-xs text-ink-3">Loading trend…</div>
  ) : !hasAnyData ? (
    <div className="flex h-64 items-center justify-center text-xs text-ink-3">No conversion data available yet.</div>
  ) : (
    <div className="mt-4 h-64 overflow-x-auto metric-trend-scroll">
      <div style={{ width: '100%', minWidth: chartWidth }} className="h-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={rows} margin={{ top: 8, right: 36, left: 12, bottom: 0 }}>
            <CartesianGrid stroke="var(--color-line)" vertical={false} />
            <XAxis
              dataKey="period"
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
              tickFormatter={(v: number) => `${Number(v.toFixed(1))}%`}
              width={56}
              domain={[0, (max: number) => Math.max(10, Math.ceil(max * 1.15))]}
            />
            <Tooltip
              contentStyle={{ background: 'var(--color-surface-3)', border: '1px solid var(--color-line-strong)', borderRadius: 8, fontSize: 12 }}
              labelStyle={{ color: 'var(--color-ink)', fontWeight: 600, marginBottom: 4 }}
              formatter={(value: any, _name: any, item: any) => {
                if (value == null) return ['No data', title]
                const { fromCount, toCount } = item.payload
                return [`${Number(value).toFixed(1)}% (${toCount} of ${fromCount} ${fromLabel}s)`, title]
              }}
            />
            <Line
              type="monotone"
              dataKey="rate"
              name={title}
              stroke="var(--color-brand)"
              strokeWidth={2}
              dot={{ r: 3 }}
              activeDot={{ r: 5 }}
              connectNulls
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  )

  return (
    <div className="card border-line-strong p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-base font-semibold text-ink">{title}</h3>
          <p className="text-sm text-ink-2">Share of each period's cohort that went on to reach the next stage.</p>
        </div>
        {onExport && (
          <button
            type="button"
            onClick={handleExport}
            disabled={isExporting}
            className="flex shrink-0 items-center gap-1.5 rounded-md border border-line-strong px-2.5 py-1.5 text-xs font-medium text-ink-2 transition-colors hover:bg-surface-3 hover:text-brand disabled:cursor-not-allowed disabled:opacity-60"
            title="Export each period's underlying records to Excel, to verify the calculation"
          >
            {isExporting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
            Excel
          </button>
        )}
      </div>
      {chart}
    </div>
  )
}
