import React from 'react'
import { Bar, BarChart, CartesianGrid, LabelList, ResponsiveContainer, Tooltip, TooltipContentProps, XAxis, YAxis } from 'recharts'
import { OpportunitiesByLeadSourceResult, OpportunitiesByLeadSourceRow } from '../api/metricsApi'
import { formatMetricValue } from '../utils/formatMetricValue'

interface OpportunitiesByLeadSourceChartProps {
  data?: OpportunitiesByLeadSourceResult
  isLoading: boolean
}

const PX_PER_SOURCE = 110
const MIN_CHART_WIDTH = 420
const MAX_BAR_SIZE = 48

function CustomTooltip({ active, payload }: TooltipContentProps) {
  const row = payload?.[0]?.payload as OpportunitiesByLeadSourceRow | undefined
  if (!active || !row) return null

  return (
    <div
      style={{
        background: 'var(--color-surface-3)',
        border: '1px solid var(--color-line-strong)',
        borderRadius: 8,
        padding: '10px 12px',
        fontSize: 12,
        minWidth: 160
      }}
    >
      <div style={{ color: 'var(--color-ink)', fontWeight: 600, marginBottom: 6 }}>{row.leadSource}</div>
      <div style={{ color: 'var(--color-ink-2)' }}>{row.count} opportunit{row.count === 1 ? 'y' : 'ies'}</div>
    </div>
  )
}

/**
 * Dashboard chart, below "Leads by Month": every Salesforce Opportunity,
 * grouped by `Opportunity.LeadSource` (the "Additional Information" picklist
 * on the opportunity record). Single-series bar chart, same pattern as
 * CampaignWonOpportunitiesChart — identity here is the x-axis category, not
 * the bar color. Opportunities with no LeadSource set are bucketed under
 * "Unknown" by the service, so bars always sum to the org's total opportunity
 * count.
 */
export const OpportunitiesByLeadSourceChart: React.FC<OpportunitiesByLeadSourceChartProps> = ({ data, isLoading }) => {
  const rows = data?.rows ?? []
  const chartWidth = Math.max(MIN_CHART_WIDTH, rows.length * PX_PER_SOURCE)

  return (
    <div className="card p-6">
      <div>
        <h2 className="text-lg font-semibold text-ink">Opportunities by Lead Source CM-07</h2>
        <p className="mt-1 max-w-xl text-sm text-ink-2">Every Salesforce Opportunity, grouped by its Lead Source.</p>
      </div>

      {isLoading ? (
        <p className="mt-6 text-sm text-ink-3">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="mt-6 text-sm text-ink-3">No opportunities synced yet — check back after the next sync.</p>
      ) : (
        <div className="mt-5 overflow-x-auto">
          <div style={{ minWidth: chartWidth, height: 340 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={rows} margin={{ top: 22, right: 12, left: 0, bottom: 4 }} barCategoryGap="38%">
                <CartesianGrid stroke="var(--color-line)" vertical={false} />
                <XAxis
                  dataKey="leadSource"
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
                  tickFormatter={(v: number) => formatMetricValue(v, 'count')}
                  width={40}
                  allowDecimals={false}
                />
                <Tooltip cursor={{ fill: 'var(--color-surface-3)' }} content={CustomTooltip} />
                <Bar dataKey="count" name="count" fill="var(--color-brand)" radius={[4, 4, 0, 0]} maxBarSize={MAX_BAR_SIZE} isAnimationActive={false}>
                  <LabelList dataKey="count" position="top" offset={8} fill="var(--color-ink-2)" fontSize={10.5} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </div>
  )
}
