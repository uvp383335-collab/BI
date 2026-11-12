import React, { useState } from 'react'
import { Bar, BarChart, CartesianGrid, LabelList, ResponsiveContainer, Tooltip, TooltipContentProps, XAxis, YAxis } from 'recharts'
import { Download, Loader2 } from 'lucide-react'
import {
  CustomerRevenueConcentrationByMonthResult,
  CustomerRevenueConcentrationMonthPoint,
  StageConversionGranularity,
  getCustomerRevenueConcentrationByMonthDetailRequest
} from '../api/metricsApi'
import { Product } from '../api/syncApi'
import { formatMetricValue } from '../utils/formatMetricValue'
import { exportCustomerRevenueConcentrationByMonthDetailToExcel } from '../utils/exportCustomerRevenueConcentrationByMonthDetailToExcel'

interface CustomerRevenueConcentrationByMonthChartProps {
  data?: CustomerRevenueConcentrationByMonthResult
  isLoading: boolean
  granularity: StageConversionGranularity
  onGranularityChange: (granularity: StageConversionGranularity) => void
  products: Product[]
  /** '' = every product's revenue blended together (default); an id narrows to just that product's revenue. */
  selectedProductId: string
  onProductChange: (productId: string) => void
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

function CustomTooltip({ active, payload }: TooltipContentProps) {
  const row = payload?.[0]?.payload as (CustomerRevenueConcentrationMonthPoint & { periodLabel: string }) | undefined
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
      <div style={{ color: 'var(--color-ink)', fontWeight: 600, marginBottom: 4 }}>{row.periodLabel}</div>
      <div style={{ color: 'var(--color-ink-2)' }}>{formatMetricValue(row.top10Pct, 'percent')} top 10</div>
      <div style={{ marginTop: 2, color: 'var(--color-ink-2)' }}>
        {formatMetricValue(row.top10Revenue, 'usd')} of {formatMetricValue(row.totalRevenue, 'usd')}
      </div>
    </div>
  )
}

/**
 * Dashboard chart below "Customer Concentration": the same top-10-of-total
 * revenue ratio, traced over time at monthly/quarterly/yearly granularity
 * (button group, same convention as "Opportunities by Lead Source by
 * Month") — bar chart, same convention as every other "by month" chart on
 * this dashboard, rather than a line. Each bar independently re-ranks that
 * period's customers (not the same top 10 held fixed across periods), so a
 * rising trend means revenue is concentrating into fewer accounts, not
 * just that the same 10 accounts grew. Carries its own product dropdown
 * (like CustomerRevenueConcentrationChart above it — passed the same
 * selectedProductId/onProductChange from the parent, so the two charts stay
 * in sync). The trailing-window cap (12 months / 8 quarters / 5 years) and
 * the omission of empty periods both happen server-side — see
 * customerRevenueConcentrationByMonth.service.ts.
 */
export const CustomerRevenueConcentrationByMonthChart: React.FC<CustomerRevenueConcentrationByMonthChartProps> = ({
  data,
  isLoading,
  granularity,
  onGranularityChange,
  products,
  selectedProductId,
  onProductChange
}) => {
  const points = data?.points ?? []
  const chartRows = points.map((point) => ({ ...point, periodLabel: formatPeriod(point.periodStart, granularity) }))
  const chartWidth = Math.max(MIN_CHART_WIDTH, chartRows.length * PX_PER_PERIOD)
  const selectedProductName = products.find((p) => p.id === selectedProductId)?.name
  const [isExporting, setIsExporting] = useState(false)

  const handleExport = async () => {
    if (isExporting) return
    setIsExporting(true)
    try {
      const detail = await getCustomerRevenueConcentrationByMonthDetailRequest(selectedProductId || undefined, granularity)
      await exportCustomerRevenueConcentrationByMonthDetailToExcel({ productName: selectedProductName, granularity, detail })
    } catch (err) {
      console.error('Failed to export customer concentration by month detail to Excel', err)
    } finally {
      setIsExporting(false)
    }
  }

  return (
    <div className="card p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-ink">Customer Concentration by Month CM-02</h2>
          <p className="mt-1 max-w-xl text-sm text-ink-2">Share of each period's invoiced revenue coming from that period's top 10 QuickBooks customers.</p>
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

          {products.length > 0 && (
            <select
              className="form-input-dark w-56 truncate sm:w-72"
              value={selectedProductId}
              onChange={(e) => onProductChange(e.target.value)}
              aria-label="Product"
              title={selectedProductName}
            >
              <option value="">All products</option>
              {products.map((product) => (
                <option key={product.id} value={product.id}>
                  {product.name}
                </option>
              ))}
            </select>
          )}

          {chartRows.length > 0 && (
            <button
              type="button"
              onClick={handleExport}
              disabled={isExporting}
              className="flex shrink-0 items-center gap-1.5 rounded-md border border-line-strong px-2.5 py-1.5 text-xs font-medium text-ink-2 transition-colors hover:bg-surface-3 hover:text-brand disabled:cursor-not-allowed disabled:opacity-60"
              title="Export each period's top 10 customers, invoice by invoice, to Excel — to verify it"
            >
              {isExporting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
              Excel
            </button>
          )}
        </div>
      </div>

      {isLoading ? (
        <p className="mt-6 text-sm text-ink-3">Loading…</p>
      ) : chartRows.length === 0 ? (
        <p className="mt-6 text-sm text-ink-3">{selectedProductId ? 'No invoiced revenue for this product yet.' : 'No invoiced revenue synced yet — check back after the next sync.'}</p>
      ) : (
        <div className="mt-5 overflow-x-auto">
          <div style={{ minWidth: chartWidth, height: 340 }}>
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
                  tickFormatter={(v: number) => `${v}%`}
                  width={40}
                  domain={[0, (max: number) => Math.max(20, Math.ceil(max * 1.15))]}
                />
                <Tooltip cursor={{ fill: 'var(--color-surface-3)' }} content={CustomTooltip} />
                <Bar dataKey="top10Pct" name="top10Pct" fill="var(--color-brand)" radius={[4, 4, 0, 0]} maxBarSize={MAX_BAR_SIZE} isAnimationActive={false}>
                  <LabelList dataKey="top10Pct" position="top" offset={8} fill="var(--color-ink-2)" fontSize={10.5} formatter={(value: unknown) => `${value}%`} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </div>
  )
}
