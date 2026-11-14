import React, { useState } from 'react'
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, TooltipContentProps, XAxis, YAxis } from 'recharts'
import type { LegendPayload } from 'recharts/types/component/DefaultLegendContent'
import { LeadsByMonthByCampaignResult } from '../api/metricsApi'
import { MultiSelectDropdown } from './MultiSelectDropdown'
import { AnalyzeButton } from '../../aiAnalysis/components/AnalyzeButton'

interface LeadsByMonthByCampaignChartProps {
  data?: LeadsByMonthByCampaignResult
  isLoading: boolean
}

const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** "2026-04" -> "Apr '26", same convention as QualifiedPipelineTrendChart. */
function formatMonth(month: string): string {
  const monthIndex = Number(month.slice(5, 7)) - 1
  const label = MONTH_LABELS[monthIndex]
  if (!label) return month
  return `${label} '${month.slice(2, 4)}`
}

const PX_PER_MONTH = 60
const MIN_CHART_WIDTH = 420
const MAX_BAR_SIZE = 40

// Fixed categorical order drawn from this app's existing semantic tokens (style.css)
// — assigned by each campaign's position in the full (stable, alphabetical) campaign
// list, never by selection order, so a color never repaints when another campaign is
// toggled on/off. The two closest-looking pair (success/warning) are placed furthest
// apart; a legend + per-bar tooltip always carry identity too, so color is never the
// only signal.
const CAMPAIGN_COLORS = ['var(--color-brand)', 'var(--color-danger)', 'var(--color-violet)', 'var(--color-teal)', 'var(--color-warning)', 'var(--color-success)']

function colorForCampaign(campaignId: string, allCampaignIds: string[]): string {
  const index = allCampaignIds.indexOf(campaignId)
  return CAMPAIGN_COLORS[(index < 0 ? 0 : index) % CAMPAIGN_COLORS.length]
}

/** Factory rather than a plain component so the tooltip can label values "total leads to date" vs "leads" depending on the current Monthly/Cumulative toggle. */
function makeCustomTooltip(viewMode: 'monthly' | 'cumulative') {
  return function CustomTooltip({ active, payload, label }: TooltipContentProps) {
    if (!active || !payload || payload.length === 0) return null

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
        <div style={{ color: 'var(--color-ink)', fontWeight: 600, marginBottom: 6 }}>{label}</div>
        {payload.map((entry) => (
          <div key={String(entry.dataKey)} style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: entry.color, flexShrink: 0 }} />
            <span style={{ color: 'var(--color-ink-2)' }}>
              {entry.name}: {entry.value} {viewMode === 'cumulative' ? 'total leads to date' : `lead${entry.value === 1 ? '' : 's'}`}
            </span>
          </div>
        ))}
      </div>
    )
  }
}

function CustomLegend({ payload }: { payload?: readonly LegendPayload[] }) {
  if (!payload) return null
  return (
    <div className="mt-2 flex flex-wrap justify-center gap-x-4 gap-y-1.5 text-xs text-ink-2">
      {payload.map((entry) => (
        <span key={String(entry.dataKey)} className="flex items-center gap-1.5">
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: entry.color, display: 'inline-block' }} />
          {entry.value}
        </span>
      ))}
    </div>
  )
}


/**
 * Dashboard's "Leads by Month" chart: a multi-select campaign picker over a
 * Salesforce Lead-creation-date histogram, one grouped bar series per
 * selected campaign so several campaigns' monthly lead volume can be
 * compared side by side on the same x-axis — month on the x-axis, lead
 * count on the y-axis, computed entirely from synced Lead records
 * (Contact.leadCreatedAt) and CampaignMember attribution, no live
 * Salesforce call. Every campaign's full series already arrives in one
 * request (see leadsByMonth.service.ts); the picker only changes what's
 * plotted client-side, so toggling a campaign on/off never refetches.
 * Colors are assigned by each campaign's position in the full campaign
 * list (never by selection order), so a campaign's color stays stable no
 * matter which others are toggled alongside it. Defaults to the first
 * campaign (alphabetical, same order the API returns) once data loads.
 */
export const LeadsByMonthByCampaignChart: React.FC<LeadsByMonthByCampaignChartProps> = ({ data, isLoading }) => {
  const campaigns = data?.campaigns ?? []
  const allCampaignIds = campaigns.map((c) => c.campaignId)
  const [selectedCampaignIds, setSelectedCampaignIds] = useState<string[]>([])
  const [viewMode, setViewMode] = useState<'monthly' | 'cumulative'>('monthly')
  const effectiveCampaignIds = selectedCampaignIds.length > 0 ? selectedCampaignIds : campaigns[0] ? [campaigns[0].campaignId] : []
  const selectedCampaigns = campaigns.filter((c) => effectiveCampaignIds.includes(c.campaignId))

  const toggleCampaign = (campaignId: string) => {
    setSelectedCampaignIds((prev) => {
      // First toggle away from the implicit single-campaign default — start from exactly that one, not from empty.
      const base = prev.length > 0 ? prev : effectiveCampaignIds
      return base.includes(campaignId) ? base.filter((id) => id !== campaignId) : [...base, campaignId]
    })
  }

  // Union of every selected campaign's months, in order, each row carrying that month's count per campaign (0 where a campaign had none).
  const allMonths = Array.from(new Set(selectedCampaigns.flatMap((c) => c.series.map((p) => p.month)))).sort()
  const runningTotals = new Map<string, number>()
  const chartRows = allMonths.map((month) => {
    const row: Record<string, string | number> = { monthLabel: formatMonth(month) }
    for (const campaign of selectedCampaigns) {
      const monthCount = campaign.series.find((p) => p.month === month)?.count ?? 0
      if (viewMode === 'cumulative') {
        const total = (runningTotals.get(campaign.campaignId) ?? 0) + monthCount
        runningTotals.set(campaign.campaignId, total)
        row[campaign.campaignId] = total
      } else {
        row[campaign.campaignId] = monthCount
      }
    }
    return row
  })
  const chartWidth = Math.max(MIN_CHART_WIDTH, chartRows.length * PX_PER_MONTH)

  return (
    <div className="card p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <h2 className="text-lg font-semibold text-ink">Leads by Month CM-07</h2>
            <AnalyzeButton chartKey="leads-by-month-by-campaign" chartTitle="Leads by Month" />
          </div>
          <p className="mt-1 max-w-xl text-sm text-ink-2">Salesforce leads created each month — select one or more campaigns to compare them.</p>
        </div>

        {campaigns.length > 0 && (
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-3 rounded-lg border border-line-strong bg-surface-3 px-3 py-1.5 text-sm text-ink-2">
              <label className="flex items-center gap-1.5">
                <input type="radio" name="leadsByMonthViewMode" checked={viewMode === 'monthly'} onChange={() => setViewMode('monthly')} />
                Monthly
              </label>
              <label className="flex items-center gap-1.5">
                <input type="radio" name="leadsByMonthViewMode" checked={viewMode === 'cumulative'} onChange={() => setViewMode('cumulative')} />
                Cumulative
              </label>
            </div>
            <MultiSelectDropdown
              options={campaigns.map((c) => ({ id: c.campaignId, label: c.campaignName, color: colorForCampaign(c.campaignId, allCampaignIds) }))}
              selectedIds={effectiveCampaignIds}
              onToggle={toggleCampaign}
              placeholder="Select campaigns"
              itemNounPlural="campaigns"
            />
          </div>
        )}
      </div>

      {isLoading ? (
        <p className="mt-6 text-sm text-ink-3">Loading…</p>
      ) : campaigns.length === 0 ? (
        <p className="mt-6 text-sm text-ink-3">No Salesforce campaigns synced yet — check back after the next sync.</p>
      ) : chartRows.length === 0 ? (
        <p className="mt-6 text-sm text-ink-3">No leads attributed to the selected campaign{selectedCampaigns.length === 1 ? '' : 's'} yet.</p>
      ) : (
        <div className="mt-5 overflow-x-auto">
          <div style={{ minWidth: chartWidth, height: 340 + (selectedCampaigns.length > 1 ? 20 : 0) }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartRows} margin={{ top: 22, right: 12, left: 0, bottom: 4 }} barCategoryGap="30%">
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
                  width={40}
                  allowDecimals={false}
                />
                <Tooltip cursor={{ fill: 'var(--color-surface-3)' }} content={makeCustomTooltip(viewMode)} />
                {selectedCampaigns.length > 1 && <Legend content={CustomLegend} />}
                {selectedCampaigns.map((campaign) => (
                  <Bar
                    key={campaign.campaignId}
                    dataKey={campaign.campaignId}
                    name={campaign.campaignName}
                    fill={colorForCampaign(campaign.campaignId, allCampaignIds)}
                    radius={[4, 4, 0, 0]}
                    maxBarSize={MAX_BAR_SIZE}
                    isAnimationActive={false}
                  />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </div>
  )
}
