import React from 'react'
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, TooltipContentProps, XAxis, YAxis } from 'recharts'
import { CompetitorWinRateResult, CompetitorWinRateRow } from '../api/metricsApi'
import { formatMetricValue } from '../utils/formatMetricValue'

interface CompetitorWinRateChartProps {
  data?: CompetitorWinRateResult
  isLoading: boolean
}

const PX_PER_COMPETITOR = 110
const MIN_CHART_WIDTH = 420
const MAX_BAR_SIZE = 32

function CustomTooltip({ active, payload }: TooltipContentProps) {
  const row = payload?.[0]?.payload as CompetitorWinRateRow | undefined
  if (!active || !row) return null

  return (
    <div
      style={{
        background: 'var(--color-surface-3)',
        border: '1px solid var(--color-line-strong)',
        borderRadius: 8,
        padding: '10px 12px',
        fontSize: 12,
        minWidth: 180
      }}
    >
      <div style={{ color: 'var(--color-ink)', fontWeight: 600, marginBottom: 6 }}>{row.competitor}</div>
      <div style={{ color: 'var(--color-ink-2)' }}>
        {row.wins} won, {row.losses} lost ({row.decided} decided)
      </div>
      <div style={{ marginTop: 2, color: 'var(--color-ink-2)' }}>{formatMetricValue(row.winRatePct, 'percent')} win rate</div>
    </div>
  )
}

/**
 * Dashboard chart, below "Customer Concentration by Month CM-02": every
 * closed Salesforce Opportunity whose "Primary Competitor" custom field is
 * set, grouped by that competitor, won count vs. lost count side by side —
 * same closed-stage resolution as CM-03's Competitive Win Rate
 * (PipelineStageDefinition, never a hardcoded stage name), but reading the
 * competitor name from `customFields` instead of the dedicated
 * competitor/competitors fields. That distinction matters: CM-03 reads
 * nothing for an org that only ever populated "Primary Competitor" as a
 * generic extra display field rather than configuring Settings >
 * Salesforce > Competitor tracking — this chart is what actually has data
 * in that case. See competitorWinRate.service.ts.
 */
export const CompetitorWinRateChart: React.FC<CompetitorWinRateChartProps> = ({ data, isLoading }) => {
  const rows = data?.rows ?? []
  const chartWidth = Math.max(MIN_CHART_WIDTH, rows.length * PX_PER_COMPETITOR)

  return (
    <div className="card p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-ink">Competitor Win Rate CM-03</h2>
          <p className="mt-1 max-w-xl text-sm text-ink-2">
            Closed Salesforce Opportunities naming a competitor (via the "Primary Competitor" field), won vs. lost per competitor.
          </p>
        </div>
      </div>

      {isLoading ? (
        <p className="mt-6 text-sm text-ink-3">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="mt-6 text-sm text-ink-3">No closed opportunities have a "Primary Competitor" recorded yet.</p>
      ) : (
        <div className="mt-5 overflow-x-auto">
          <div style={{ minWidth: chartWidth, height: 340 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={rows} margin={{ top: 8, right: 12, left: 0, bottom: 4 }} barCategoryGap="30%" barGap={2}>
                <CartesianGrid stroke="var(--color-line)" vertical={false} />
                <XAxis
                  dataKey="competitor"
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
                  width={40}
                  allowDecimals={false}
                />
                <Tooltip cursor={{ fill: 'var(--color-surface-3)' }} content={CustomTooltip} />
                <Legend wrapperStyle={{ fontSize: 12, paddingTop: 8 }} iconType="circle" iconSize={8} />
                <Bar dataKey="wins" name="Won" fill="var(--color-success)" radius={[3, 3, 0, 0]} maxBarSize={MAX_BAR_SIZE} isAnimationActive={false} />
                <Bar dataKey="losses" name="Lost" fill="var(--color-danger)" radius={[3, 3, 0, 0]} maxBarSize={MAX_BAR_SIZE} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </div>
  )
}
