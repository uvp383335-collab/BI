import React, { useState } from 'react'
import { Bar, BarChart, CartesianGrid, LabelList, ResponsiveContainer, Tooltip, TooltipContentProps, XAxis, YAxis } from 'recharts'
import { Download, Loader2 } from 'lucide-react'
import { CustomerRevenueConcentrationResult, CustomerRevenueConcentrationRow, getCustomerRevenueConcentrationDetailRequest } from '../api/metricsApi'
import { Product } from '../api/syncApi'
import { formatMetricValue } from '../utils/formatMetricValue'
import { exportCustomerRevenueConcentrationDetailToExcel } from '../utils/exportCustomerRevenueConcentrationDetailToExcel'
import { AnalyzeButton } from '../../aiAnalysis/components/AnalyzeButton'

interface CustomerRevenueConcentrationChartProps {
  data?: CustomerRevenueConcentrationResult
  isLoading: boolean
  products: Product[]
  /** '' = every product's revenue blended together (default); an id narrows to just that product's revenue. */
  selectedProductId: string
  onProductChange: (productId: string) => void
}

const PX_PER_CUSTOMER = 42
const MIN_CHART_HEIGHT = 200
const MAX_BAR_SIZE = 28

function CustomTooltip({ active, payload }: TooltipContentProps) {
  const row = payload?.[0]?.payload as CustomerRevenueConcentrationRow | undefined
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
      <div style={{ color: 'var(--color-ink)', fontWeight: 600, marginBottom: 6 }}>{row.customerName}</div>
      <div style={{ color: 'var(--color-ink-2)' }}>{formatMetricValue(row.revenue, 'usd')} revenue</div>
      <div style={{ marginTop: 2, color: 'var(--color-ink-2)' }}>{formatMetricValue(row.pctOfTotal, 'percent')} of all-time revenue</div>
    </div>
  )
}

/**
 * Dashboard chart, below "Opportunities by Lead Source by Month": revenue
 * concentration among the top 10 QuickBooks customers — each one's
 * all-time invoiced revenue, horizontal bar chart (customer name on the
 * y-axis, revenue on the x-axis) since customer names can be long, same
 * reasoning as CampaignRoiChart. The header's headline figure is the
 * concentration ratio this chart is named for: what share of *all*
 * invoiced revenue these 10 customers account for. Subsidiaries are rolled
 * up to their QuickBooks parent before ranking, same as CM-02's "Customer
 * Concentration" card — this chart differs from that card only in using
 * all-time revenue instead of a trailing-twelve-month window. Carries its
 * own product dropdown (like InvoiceRevenueGrowthByStateCard) so "which
 * customers make up this product's revenue" is answerable without leaving
 * this card — narrowing to one product re-ranks the top 10 against that
 * product's revenue alone, not the blended total. See
 * customerRevenueConcentration.service.ts.
 */
export const CustomerRevenueConcentrationChart: React.FC<CustomerRevenueConcentrationChartProps> = ({ data, isLoading, products, selectedProductId, onProductChange }) => {
  const rows = data?.rows ?? []
  const chartHeight = Math.max(MIN_CHART_HEIGHT, rows.length * PX_PER_CUSTOMER)
  const selectedProductName = products.find((p) => p.id === selectedProductId)?.name
  const [isExporting, setIsExporting] = useState(false)

  const handleExport = async () => {
    if (isExporting) return
    setIsExporting(true)
    try {
      const detail = await getCustomerRevenueConcentrationDetailRequest(selectedProductId || undefined)
      await exportCustomerRevenueConcentrationDetailToExcel({ productName: selectedProductName, detail })
    } catch (err) {
      console.error('Failed to export customer concentration detail to Excel', err)
    } finally {
      setIsExporting(false)
    }
  }

  return (
    <div className="card p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <h2 className="text-lg font-semibold text-ink">Customer Concentration CM-02</h2>
            <AnalyzeButton chartKey="customer-revenue-concentration" chartTitle="Customer Concentration" />
          </div>
          <p className="mt-1 max-w-xl text-sm text-ink-2">All-time invoiced revenue from the top 10 QuickBooks customers, as a share of total revenue.</p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {data && data.totalRevenue > 0 && (
            <div className="text-right">
              <div className="text-2xl font-semibold text-ink">{formatMetricValue(data.top10Pct, 'percent')}</div>
              <div className="text-xs text-ink-2">of {formatMetricValue(data.totalRevenue, 'usd')} total revenue</div>
            </div>
          )}

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

          {rows.length > 0 && (
            <button
              type="button"
              onClick={handleExport}
              disabled={isExporting}
              className="flex shrink-0 items-center gap-1.5 rounded-md border border-line-strong px-2.5 py-1.5 text-xs font-medium text-ink-2 transition-colors hover:bg-surface-3 hover:text-brand disabled:cursor-not-allowed disabled:opacity-60"
              title="Export the top 10 customers' revenue, invoice by invoice, to Excel — to verify it"
            >
              {isExporting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
              Excel
            </button>
          )}
        </div>
      </div>

      {isLoading ? (
        <p className="mt-6 text-sm text-ink-3">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="mt-6 text-sm text-ink-3">{selectedProductId ? 'No invoiced revenue for this product yet.' : 'No invoiced revenue synced yet — check back after the next sync.'}</p>
      ) : (
        <div className="mt-5" style={{ height: chartHeight }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 56, left: 0, bottom: 4 }} barCategoryGap="30%">
              <CartesianGrid stroke="var(--color-line)" horizontal={false} />
              <XAxis
                type="number"
                stroke="var(--color-ink-3)"
                tick={{ fill: 'var(--color-ink-2)', fontSize: 11 }}
                tickLine={false}
                axisLine={{ stroke: 'var(--color-line)' }}
                tickFormatter={(v: number) => formatMetricValue(v, 'usd')}
              />
              <YAxis
                type="category"
                dataKey="customerName"
                stroke="var(--color-ink-3)"
                tick={{ fill: 'var(--color-ink-2)', fontSize: 12 }}
                tickLine={false}
                axisLine={false}
                width={160}
                interval={0}
              />
              <Tooltip cursor={{ fill: 'var(--color-surface-3)' }} content={CustomTooltip} />
              <Bar dataKey="revenue" name="revenue" fill="var(--color-brand)" radius={[0, 4, 4, 0]} maxBarSize={MAX_BAR_SIZE} isAnimationActive={false}>
                <LabelList dataKey="revenue" position="right" offset={8} fill="var(--color-ink-2)" fontSize={10.5} formatter={(value: unknown) => formatMetricValue(Number(value), 'usd')} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  )
}
