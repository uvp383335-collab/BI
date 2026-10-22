import React, { useEffect } from 'react'
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { CustomerUpgradesTrendGranularity, CustomerUpgradesTrendResult } from '../api/productRevenueGrowthApi'
import { CategorizedProduct } from '../../integrations/api/productCategoriesApi'
import { formatMetricValue } from '../utils/formatMetricValue'

interface CustomerRetentionTrendChartProps {
  data?: CustomerUpgradesTrendResult
  isLoading: boolean
  /** Every categorized product (any category/frequency) — filtered internally to recurring products matching the selected granularity's billing frequency. */
  products: CategorizedProduct[]
  granularity: CustomerUpgradesTrendGranularity
  onGranularityChange: (granularity: CustomerUpgradesTrendGranularity) => void
  selectedProductId: string
  onProductChange: (productId: string) => void
}

const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** "2026-04" -> "Apr '26" (monthly); "2026" stays "2026" (annually). */
function formatPeriodLabel(period: string, granularity: CustomerUpgradesTrendGranularity): string {
  if (granularity === 'annually') return period
  const [year, m] = period.split('-').map(Number)
  return `${MONTH_LABELS[m - 1]} '${String(year).slice(2)}`
}

function formatPct(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—'
  return formatMetricValue(value, 'percent')
}

/**
 * Dashboard bar chart: GRR % and NRR % for one recurring product — or, with
 * "All products" selected (the dropdown's default), blended across every
 * recurring product billed on the selected cadence, the same way VC-01/
 * VC-02's org-wide recurring roll-forward already blends them. Read from
 * the same data and endpoint as "Customer upgrades"/"downgrades"/"churn"
 * (see backend's customerUpgradesTrend.service.ts), using the exact same
 * formula as `grrFromRollForward`/`nrrFromRollForward`. No "Customer wise /
 * Amount wise" toggle here — GRR/NRR are already percentages, there's no
 * second unit to switch to. Carries its own independent product/
 * granularity selection.
 */
export const CustomerRetentionTrendChart: React.FC<CustomerRetentionTrendChartProps> = ({
  data,
  isLoading,
  products,
  granularity,
  onGranularityChange,
  selectedProductId,
  onProductChange
}) => {
  const requiredFrequency = granularity === 'monthly' ? 'monthly' : 'yearly'
  const eligibleProducts = products.filter((p) => p.category === 'recurring' && p.billingFrequency === requiredFrequency)

  // Whenever the granularity changes (or the eligible list itself changes), make sure the
  // current selection is still valid. An empty selection means "All products" — a valid
  // choice in its own right, so it's left alone rather than forced onto a specific product.
  useEffect(() => {
    if (eligibleProducts.length === 0) {
      if (selectedProductId) onProductChange('')
      return
    }
    if (selectedProductId && !eligibleProducts.some((p) => p.providerRecordId === selectedProductId)) {
      onProductChange('')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [granularity, eligibleProducts.map((p) => p.providerRecordId).join(',')])

  const selectedProductName = selectedProductId ? eligibleProducts.find((p) => p.providerRecordId === selectedProductId)?.name : 'All products'
  const points = data?.points ?? []
  const rows = points.map((point) => ({ period: formatPeriodLabel(point.period, granularity), grr: point.grrPct, nrr: point.nrrPct }))

  const perPointWidth = granularity === 'monthly' ? 56 : 90
  const chartWidth = Math.max(360, rows.length * perPointWidth)

  return (
    <div className="card p-6 lg:col-span-3">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-ink">Customer retention (GRR/NRR) — {selectedProductName}</h2>
          <p className="mt-1 text-sm text-ink-2">
            Gross and net revenue retention {selectedProductId ? 'for this product' : 'blended across every eligible product'},{' '}
            {granularity === 'monthly' ? 'month over month' : 'year over year'}. GRR never gives credit for upgrades; NRR does, and can exceed 100%. Only
            recurring products billed {granularity === 'monthly' ? 'monthly' : 'yearly'} are eligible for this view.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {eligibleProducts.length > 0 && (
            <select
              className="form-input-dark w-56 truncate sm:w-72"
              value={selectedProductId}
              onChange={(e) => onProductChange(e.target.value)}
              aria-label="Product"
              title={selectedProductName}
            >
              <option value="">All products (combined)</option>
              {eligibleProducts.map((product) => (
                <option key={product.providerRecordId} value={product.providerRecordId}>
                  {product.name}
                </option>
              ))}
            </select>
          )}

          <div className="flex items-center gap-3 rounded-lg border border-line-strong bg-surface-3 px-3 py-1.5 text-sm text-ink-2">
            <label className="flex items-center gap-1.5">
              <input type="radio" name="customerRetentionGranularity" checked={granularity === 'monthly'} onChange={() => onGranularityChange('monthly')} />
              Monthly
            </label>
            <label className="flex items-center gap-1.5">
              <input type="radio" name="customerRetentionGranularity" checked={granularity === 'annually'} onChange={() => onGranularityChange('annually')} />
              Annually
            </label>
          </div>
        </div>
      </div>

      {eligibleProducts.length === 0 ? (
        <p className="mt-4 text-sm text-ink-3">
          No products are categorized recurring and billed {granularity === 'monthly' ? 'monthly' : 'yearly'} yet — set that up in Settings to see this trend.
        </p>
      ) : isLoading ? (
        <p className="mt-4 text-sm text-ink-3">Loading…</p>
      ) : !data?.hasData ? (
        <p className="mt-4 text-sm text-ink-3">Not computable for this selection.</p>
      ) : (
        <div className="mt-4 overflow-x-auto">
          {/* `minWidth` (not `width`) so the chart fills the card on a normal-width screen. */}
          <div style={{ minWidth: chartWidth, height: 320 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={rows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barCategoryGap="30%" barGap={2}>
                <CartesianGrid stroke="var(--color-line)" vertical={false} />
                <XAxis
                  dataKey="period"
                  stroke="var(--color-ink-3)"
                  tick={{ fill: 'var(--color-ink-2)', fontSize: 12 }}
                  tickLine={false}
                  axisLine={{ stroke: 'var(--color-line)' }}
                  interval="preserveStartEnd"
                  minTickGap={20}
                  padding={{ left: 12, right: 12 }}
                />
                <YAxis
                  stroke="var(--color-ink-3)"
                  tick={{ fill: 'var(--color-ink-2)', fontSize: 11 }}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(v: number) => formatPct(v)}
                  width={56}
                />
                <Tooltip
                  cursor={{ fill: 'var(--color-surface-3)' }}
                  contentStyle={{ background: 'var(--color-surface-3)', border: '1px solid var(--color-line-strong)', borderRadius: 8, fontSize: 12 }}
                  labelStyle={{ color: 'var(--color-ink)', fontWeight: 600, marginBottom: 4 }}
                  formatter={(value, name) => [formatPct(typeof value === 'number' ? value : null), name]}
                />
                <Legend wrapperStyle={{ fontSize: 12, paddingTop: 8 }} iconType="circle" iconSize={8} />
                <Bar dataKey="grr" name="GRR" fill="var(--color-brand)" radius={[3, 3, 0, 0]} maxBarSize={32} />
                <Bar dataKey="nrr" name="NRR" fill="var(--color-success)" radius={[3, 3, 0, 0]} maxBarSize={32} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </div>
  )
}
