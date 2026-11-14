import React, { useState } from 'react'
import { Bar, BarChart, CartesianGrid, LabelList, ResponsiveContainer, Tooltip, TooltipContentProps, XAxis, YAxis } from 'recharts'
import { Download, Loader2 } from 'lucide-react'
import { CampaignWonOpportunitiesResult, CampaignWonOpportunitiesRow, getCampaignWonOpportunitiesDetailRequest } from '../api/metricsApi'
import { formatMetricValue } from '../utils/formatMetricValue'
import { exportCampaignWonOpportunitiesDetailToExcel } from '../utils/exportCampaignWonOpportunitiesDetailToExcel'
import { AnalyzeButton } from '../../aiAnalysis/components/AnalyzeButton'

export type CampaignWonOpportunitiesViewMode = 'count' | 'amount'
export type CampaignWonOpportunitiesTopN = 5 | 10 | 15 | 20 | 'all'

const TOP_N_OPTIONS: CampaignWonOpportunitiesTopN[] = [5, 10, 15, 20, 'all']

interface CampaignWonOpportunitiesChartProps {
  data?: CampaignWonOpportunitiesResult
  isLoading: boolean
  viewMode: CampaignWonOpportunitiesViewMode
  onViewModeChange: (mode: CampaignWonOpportunitiesViewMode) => void
  topN: CampaignWonOpportunitiesTopN
  onTopNChange: (topN: CampaignWonOpportunitiesTopN) => void
}

const PX_PER_CAMPAIGN = 90
const MIN_CHART_WIDTH = 420
const MAX_BAR_SIZE = 40

function CustomTooltip({ active, payload }: TooltipContentProps) {
  const row = payload?.[0]?.payload as (CampaignWonOpportunitiesRow & { value: number }) | undefined
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
      <div style={{ color: 'var(--color-ink-2)' }}>{row.wonCount} opportunit{row.wonCount === 1 ? 'y' : 'ies'} won</div>
      <div style={{ marginTop: 2, color: 'var(--color-ink-2)' }}>{formatMetricValue(row.wonAmount, 'usd')} won</div>
    </div>
  )
}

/**
 * Dashboard chart, below "Pipeline Coverage Trend": closed-won Salesforce
 * Opportunities grouped by Campaign. Single-series bar chart (one color —
 * identity here is the x-axis category, not the bar color), toggled between
 * opportunity count and won $ amount per campaign via the viewMode prop,
 * same radio-pill pattern as InvoiceRevenueGrowthByStateCard's view toggle.
 * Sorted descending by whichever metric is active so the top campaign is
 * always leftmost, then capped to the topN prop (5/10/15/20/all) — with
 * potentially dozens of campaigns, an uncapped chart gets unreadable, so
 * this lets the viewer narrow to just the top performers.
 */
export const CampaignWonOpportunitiesChart: React.FC<CampaignWonOpportunitiesChartProps> = ({
  data,
  isLoading,
  viewMode,
  onViewModeChange,
  topN,
  onTopNChange
}) => {
  const rows = data?.rows ?? []
  const sortedRows = [...rows].sort((a, b) => (viewMode === 'amount' ? b.wonAmount - a.wonAmount : b.wonCount - a.wonCount))
  const cappedRows = topN === 'all' ? sortedRows : sortedRows.slice(0, topN)
  const chartRows = cappedRows.map((row) => ({ ...row, value: viewMode === 'amount' ? row.wonAmount : row.wonCount }))
  const chartWidth = Math.max(MIN_CHART_WIDTH, chartRows.length * PX_PER_CAMPAIGN)
  const unit = viewMode === 'amount' ? 'usd' : 'count'

  const [isExporting, setIsExporting] = useState(false)

  const handleExport = async () => {
    if (isExporting) return
    setIsExporting(true)
    try {
      const detail = await getCampaignWonOpportunitiesDetailRequest()
      await exportCampaignWonOpportunitiesDetailToExcel({ detail })
    } catch (err) {
      console.error('Failed to export opportunities won by campaign detail to Excel', err)
    } finally {
      setIsExporting(false)
    }
  }

  return (
    <div className="card p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <h2 className="text-lg font-semibold text-ink">Opportunities Won by Campaign CM-07</h2>
            <AnalyzeButton chartKey="campaign-won-opportunities" chartTitle="Opportunities Won by Campaign" />
          </div>
          <p className="mt-1 max-w-xl text-sm text-ink-2">Closed-won Salesforce Opportunities attributed to a Campaign, grouped by campaign.</p>
        </div>

        {rows.length > 0 && (
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-3 rounded-lg border border-line-strong bg-surface-3 px-3 py-1.5 text-sm text-ink-2">
              <label className="flex items-center gap-1.5">
                <input type="radio" name="campaignWonOpportunitiesViewMode" checked={viewMode === 'count'} onChange={() => onViewModeChange('count')} />
                Number
              </label>
              <label className="flex items-center gap-1.5">
                <input type="radio" name="campaignWonOpportunitiesViewMode" checked={viewMode === 'amount'} onChange={() => onViewModeChange('amount')} />
                Amount
              </label>
            </div>

            <select
              className="form-input-dark w-32"
              value={String(topN)}
              onChange={(e) => onTopNChange((e.target.value === 'all' ? 'all' : Number(e.target.value)) as CampaignWonOpportunitiesTopN)}
              aria-label="Number of campaigns to show"
            >
              {TOP_N_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option === 'all' ? 'All campaigns' : `Top ${option}`}
                </option>
              ))}
            </select>

            <button
              type="button"
              onClick={handleExport}
              disabled={isExporting}
              className="flex shrink-0 items-center gap-1.5 rounded-md border border-line-strong px-2.5 py-1.5 text-xs font-medium text-ink-2 transition-colors hover:bg-surface-3 hover:text-brand disabled:cursor-not-allowed disabled:opacity-60"
              title="Export every campaign's won count/amount, opportunity by opportunity, to Excel — to verify it"
            >
              {isExporting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
              Excel
            </button>
          </div>
        )}
      </div>

      {isLoading ? (
        <p className="mt-6 text-sm text-ink-3">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="mt-6 text-sm text-ink-3">No closed-won opportunities attributed to a campaign yet — check back after the next sync.</p>
      ) : (
        <div className="mt-5 overflow-x-auto">
          <div style={{ minWidth: chartWidth, height: 340 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartRows} margin={{ top: 22, right: 12, left: 0, bottom: 4 }} barCategoryGap="38%">
                <CartesianGrid stroke="var(--color-line)" vertical={false} />
                <XAxis
                  dataKey="campaignName"
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
                  tickFormatter={(v: number) => formatMetricValue(v, unit)}
                  width={unit === 'usd' ? 64 : 40}
                />
                <Tooltip cursor={{ fill: 'var(--color-surface-3)' }} content={CustomTooltip} />
                <Bar dataKey="value" name="value" fill="var(--color-brand)" radius={[4, 4, 0, 0]} maxBarSize={MAX_BAR_SIZE} isAnimationActive={false}>
                  <LabelList dataKey="value" position="top" offset={8} fill="var(--color-ink-2)" fontSize={10.5} formatter={(value: unknown) => formatMetricValue(Number(value), unit)} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </div>
  )
}
