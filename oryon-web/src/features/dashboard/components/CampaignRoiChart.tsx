import React from 'react'
import { Bar, BarChart, CartesianGrid, LabelList, ResponsiveContainer, Tooltip, TooltipContentProps, XAxis, YAxis } from 'recharts'
import { CampaignRoiResult, CampaignRoiRow } from '../api/metricsApi'
import { formatMetricValue } from '../utils/formatMetricValue'
import { AnalyzeButton } from '../../aiAnalysis/components/AnalyzeButton'

export type CampaignRoiTopN = 5 | 10 | 15

const TOP_N_OPTIONS: CampaignRoiTopN[] = [5, 10, 15]

interface CampaignRoiChartProps {
  data?: CampaignRoiResult
  isLoading: boolean
  topN: CampaignRoiTopN
  onTopNChange: (topN: CampaignRoiTopN) => void
}

const PX_PER_CAMPAIGN = 42
const MIN_CHART_HEIGHT = 200
const MAX_BAR_SIZE = 28

function CustomTooltip({ active, payload }: TooltipContentProps) {
  const row = payload?.[0]?.payload as CampaignRoiRow | undefined
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
      <div style={{ color: 'var(--color-ink)', fontWeight: 600, marginBottom: 6 }}>{row.campaignName}</div>
      <div style={{ color: 'var(--color-ink-2)' }}>{formatMetricValue(row.roi, 'multiple')} ROI</div>
      <div style={{ marginTop: 2, color: 'var(--color-ink-2)' }}>{formatMetricValue(row.wonAmount, 'usd')} won / {formatMetricValue(row.actualCost, 'usd')} cost</div>
    </div>
  )
}

/**
 * Dashboard chart, below "Opportunities Won by Campaign": ROI per Salesforce
 * Campaign — closed-won Opportunity amount attributed to the campaign,
 * divided by the campaign's own ActualCost. Horizontal bar chart (campaign
 * name on the y-axis, ROI on the x-axis) since campaign names are long and
 * there can be many of them — a vertical bar chart's x-axis labels would
 * collide the way "Opportunities Won by Campaign"'s did before that grid
 * layout bug was fixed. Campaigns with no ActualCost set are excluded by
 * the service, not plotted as a zero/blank bar. Rows arrive pre-sorted
 * descending by ROI, so capping to the topN prop (5/10/15, same picker
 * pattern as CampaignWonOpportunitiesChart) always keeps the top performers.
 * See campaignRoi.service.ts.
 */
export const CampaignRoiChart: React.FC<CampaignRoiChartProps> = ({ data, isLoading, topN, onTopNChange }) => {
  const rows = data?.rows ?? []
  const chartRows = rows.slice(0, topN)
  const chartHeight = Math.max(MIN_CHART_HEIGHT, chartRows.length * PX_PER_CAMPAIGN)

  return (
    <div className="card p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <h2 className="text-lg font-semibold text-ink">Campaign ROI CM-07</h2>
            <AnalyzeButton chartKey="campaign-roi" chartTitle="Campaign ROI" />
          </div>
          <p className="mt-1 max-w-xl text-sm text-ink-2">Closed-won Salesforce Opportunity amount per Campaign, divided by the campaign's actual cost.</p>
        </div>

        {rows.length > 0 && (
          <select
            className="form-input-dark w-32"
            value={String(topN)}
            onChange={(e) => onTopNChange(Number(e.target.value) as CampaignRoiTopN)}
            aria-label="Number of campaigns to show"
          >
            {TOP_N_OPTIONS.map((option) => (
              <option key={option} value={option}>
                Top {option}
              </option>
            ))}
          </select>
        )}
      </div>

      {isLoading ? (
        <p className="mt-6 text-sm text-ink-3">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="mt-6 text-sm text-ink-3">No campaigns with an actual cost set yet — check back after the next sync.</p>
      ) : (
        <div className="mt-5" style={{ height: chartHeight }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartRows} layout="vertical" margin={{ top: 4, right: 48, left: 0, bottom: 4 }} barCategoryGap="30%">
              <CartesianGrid stroke="var(--color-line)" horizontal={false} />
              <XAxis
                type="number"
                stroke="var(--color-ink-3)"
                tick={{ fill: 'var(--color-ink-2)', fontSize: 11 }}
                tickLine={false}
                axisLine={{ stroke: 'var(--color-line)' }}
                tickFormatter={(v: number) => formatMetricValue(v, 'multiple')}
              />
              <YAxis
                type="category"
                dataKey="campaignName"
                stroke="var(--color-ink-3)"
                tick={{ fill: 'var(--color-ink-2)', fontSize: 12 }}
                tickLine={false}
                axisLine={false}
                width={160}
                interval={0}
              />
              <Tooltip cursor={{ fill: 'var(--color-surface-3)' }} content={CustomTooltip} />
              <Bar dataKey="roi" name="roi" fill="var(--color-brand)" radius={[0, 4, 4, 0]} maxBarSize={MAX_BAR_SIZE} isAnimationActive={false}>
                <LabelList dataKey="roi" position="right" offset={8} fill="var(--color-ink-2)" fontSize={10.5} formatter={(value: unknown) => formatMetricValue(Number(value), 'multiple')} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  )
}
