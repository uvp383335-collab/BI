import React, { useState } from 'react'
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, TooltipContentProps, XAxis, YAxis } from 'recharts'
import type { LegendPayload } from 'recharts/types/component/DefaultLegendContent'
import { OpportunitiesByLeadSourceByMonthResult, StageConversionGranularity } from '../api/metricsApi'
import { MultiSelectDropdown } from './MultiSelectDropdown'

interface OpportunitiesByLeadSourceByMonthChartProps {
  data?: OpportunitiesByLeadSourceByMonthResult
  isLoading: boolean
  granularity: StageConversionGranularity
  onGranularityChange: (granularity: StageConversionGranularity) => void
}

const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** "2026-04" -> "Apr '26" / "Q2 '26" / "2026" depending on granularity, same convention as StageConversionTrendChart's formatPeriod. */
function formatPeriod(periodStart: string, granularity: StageConversionGranularity): string {
  const [year, month] = periodStart.split('-').map(Number)
  if (!year || !month) return periodStart
  if (granularity === 'yearly') return String(year)
  if (granularity === 'monthly') return `${MONTH_LABELS[month - 1]} '${String(year).slice(2, 4)}`
  const quarter = Math.floor((month - 1) / 3) + 1
  return `Q${quarter} '${String(year).slice(2, 4)}`
}

const PX_PER_PERIOD = 60
const MIN_CHART_WIDTH = 420
const MAX_BAR_SIZE = 40

// Fixed categorical order drawn from this app's existing semantic tokens (style.css)
// — assigned by each lead source's position in the full (stable, alphabetical) lead
// source list, never by selection order, so a color never repaints when another lead
// source is toggled on/off. The two closest-looking pair (success/warning) are placed
// furthest apart; a legend + per-bar tooltip always carry identity too, so color is
// never the only signal. Same palette/ordering as LeadsByMonthByCampaignChart.
const LEAD_SOURCE_COLORS = ['var(--color-brand)', 'var(--color-danger)', 'var(--color-violet)', 'var(--color-teal)', 'var(--color-warning)', 'var(--color-success)']

function colorForLeadSource(leadSource: string, allLeadSources: string[]): string {
  const index = allLeadSources.indexOf(leadSource)
  return LEAD_SOURCE_COLORS[(index < 0 ? 0 : index) % LEAD_SOURCE_COLORS.length]
}

/** Factory rather than a plain component so the tooltip can label values "total opportunities to date" vs "opportunities" depending on the current Monthly/Cumulative toggle. */
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
              {entry.name}: {entry.value} {viewMode === 'cumulative' ? 'total opportunities to date' : `opportunit${entry.value === 1 ? 'y' : 'ies'}`}
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
 * Dashboard chart below "Opportunities by Lead Source": a multi-select
 * lead-source picker over an Opportunity-creation-date histogram, one
 * grouped bar series per selected lead source so several lead sources'
 * period-over-period opportunity volume can be compared side by side — at
 * monthly/quarterly/yearly granularity (button group, same convention as
 * "Funnel Conversion Trends"), plus a Monthly/Cumulative toggle (running
 * total per lead source across periods instead of each period's own
 * count). Same multi-select-over-histogram pattern as "Leads by Month"
 * (LeadsByMonthByCampaignChart), just keyed off Opportunity.LeadSource
 * instead of Campaign — every lead source's full series already arrives in
 * one request (see opportunitiesByLeadSourceByMonth.service.ts), so toggling
 * a lead source or the Cumulative view never refetches, only changing
 * `granularity` does. Defaults to the first lead source (alphabetical, same
 * order the API returns) once data loads.
 */
export const OpportunitiesByLeadSourceByMonthChart: React.FC<OpportunitiesByLeadSourceByMonthChartProps> = ({ data, isLoading, granularity, onGranularityChange }) => {
  const leadSources = data?.leadSources ?? []
  const allLeadSources = leadSources.map((row) => row.leadSource)
  const [selectedLeadSourceIds, setSelectedLeadSourceIds] = useState<string[]>([])
  const [viewMode, setViewMode] = useState<'monthly' | 'cumulative'>('monthly')
  const effectiveLeadSources = selectedLeadSourceIds.length > 0 ? selectedLeadSourceIds : leadSources[0] ? [leadSources[0].leadSource] : []
  const selectedRows = leadSources.filter((row) => effectiveLeadSources.includes(row.leadSource))

  const toggleLeadSource = (leadSource: string) => {
    setSelectedLeadSourceIds((prev) => {
      // First toggle away from the implicit single-lead-source default — start from exactly that one, not from empty.
      const base = prev.length > 0 ? prev : effectiveLeadSources
      return base.includes(leadSource) ? base.filter((id) => id !== leadSource) : [...base, leadSource]
    })
  }

  // Union of every selected lead source's periods, in order, each row carrying that period's count per lead source (0 where a lead source had none).
  const allPeriods = Array.from(new Set(selectedRows.flatMap((row) => row.series.map((p) => p.periodStart)))).sort()
  const runningTotals = new Map<string, number>()
  const chartRows = allPeriods.map((periodStart) => {
    const row: Record<string, string | number> = { periodLabel: formatPeriod(periodStart, granularity) }
    for (const leadSourceRow of selectedRows) {
      const periodCount = leadSourceRow.series.find((p) => p.periodStart === periodStart)?.count ?? 0
      if (viewMode === 'cumulative') {
        const total = (runningTotals.get(leadSourceRow.leadSource) ?? 0) + periodCount
        runningTotals.set(leadSourceRow.leadSource, total)
        row[leadSourceRow.leadSource] = total
      } else {
        row[leadSourceRow.leadSource] = periodCount
      }
    }
    return row
  })
  const chartWidth = Math.max(MIN_CHART_WIDTH, chartRows.length * PX_PER_PERIOD)

  return (
    <div className="card p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-ink">Opportunities by Lead Source by Month CM-07</h2>
          <p className="mt-1 max-w-xl text-sm text-ink-2">Salesforce opportunities created each period — select one or more lead sources to compare them.</p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="flex rounded-lg bg-surface-3 p-1">
            {(['monthly', 'quarterly', 'yearly'] as const).map((g) => (
              <button
                key={g}
                type="button"
                onClick={() => onGranularityChange(g)}
                className={`rounded-md px-3 py-1 text-sm font-medium capitalize transition-colors ${
                  granularity === g ? 'bg-surface-1 text-ink shadow-sm' : 'text-ink-2 hover:text-ink'
                }`}
              >
                {g}
              </button>
            ))}
          </div>

          {leadSources.length > 0 && (
            <>
              <div className="flex items-center gap-3 rounded-lg border border-line-strong bg-surface-3 px-3 py-1.5 text-sm text-ink-2">
                <label className="flex items-center gap-1.5">
                  <input type="radio" name="opportunitiesByLeadSourceViewMode" checked={viewMode === 'monthly'} onChange={() => setViewMode('monthly')} />
                  Monthly
                </label>
                <label className="flex items-center gap-1.5">
                  <input type="radio" name="opportunitiesByLeadSourceViewMode" checked={viewMode === 'cumulative'} onChange={() => setViewMode('cumulative')} />
                  Cumulative
                </label>
              </div>
              <MultiSelectDropdown
                options={leadSources.map((row) => ({ id: row.leadSource, label: row.leadSource, color: colorForLeadSource(row.leadSource, allLeadSources) }))}
                selectedIds={effectiveLeadSources}
                onToggle={toggleLeadSource}
                placeholder="Select lead sources"
                itemNounPlural="lead sources"
              />
            </>
          )}
        </div>
      </div>

      {isLoading ? (
        <p className="mt-6 text-sm text-ink-3">Loading…</p>
      ) : leadSources.length === 0 ? (
        <p className="mt-6 text-sm text-ink-3">No opportunities synced yet — check back after the next sync.</p>
      ) : chartRows.length === 0 ? (
        <p className="mt-6 text-sm text-ink-3">No opportunities for the selected lead source{selectedRows.length === 1 ? '' : 's'} yet.</p>
      ) : (
        <div className="mt-5 overflow-x-auto">
          <div style={{ minWidth: chartWidth, height: 340 + (selectedRows.length > 1 ? 20 : 0) }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartRows} margin={{ top: 22, right: 12, left: 0, bottom: 4 }} barCategoryGap="30%">
                <CartesianGrid stroke="var(--color-line)" vertical={false} />
                <XAxis
                  dataKey="periodLabel"
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
                {selectedRows.length > 1 && <Legend content={CustomLegend} />}
                {selectedRows.map((row) => (
                  <Bar
                    key={row.leadSource}
                    dataKey={row.leadSource}
                    name={row.leadSource}
                    fill={colorForLeadSource(row.leadSource, allLeadSources)}
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
