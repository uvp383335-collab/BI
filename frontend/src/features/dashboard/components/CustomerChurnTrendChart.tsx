import React, { useEffect, useState } from 'react'
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { CustomerUpgradesTrendGranularity, CustomerUpgradesTrendResult } from '../api/productRevenueGrowthApi'
import { CategorizedProduct } from '../../integrations/api/productCategoriesApi'
import { formatMetricValue } from '../utils/formatMetricValue'

interface CustomerChurnTrendChartProps {
  data?: CustomerUpgradesTrendResult
  isLoading: boolean
  /** Every categorized product (any category/frequency) — filtered internally to recurring products matching the selected granularity's billing frequency. */
  products: CategorizedProduct[]
  granularity: CustomerUpgradesTrendGranularity
  onGranularityChange: (granularity: CustomerUpgradesTrendGranularity) => void
  selectedProductId: string
  onProductChange: (productId: string) => void
}

/** 'customers' = headcount of who churned; 'amount' = total $ of revenue lost. */
type ValueMode = 'customers' | 'amount'

const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** "2026-04" -> "Apr '26" (monthly); "2026" stays "2026" (annually). */
function formatPeriodLabel(period: string, granularity: CustomerUpgradesTrendGranularity): string {
  if (granularity === 'annually') return period
  const [year, m] = period.split('-').map(Number)
  return `${MONTH_LABELS[m - 1]} '${String(year).slice(2)}`
}

function formatValue(value: number | null | undefined, valueMode: ValueMode): string {
  if (value === null || value === undefined) return '—'
  return valueMode === 'customers' ? formatMetricValue(value, 'count') : formatMetricValue(value, 'usd')
}

/**
 * Dashboard bar chart: how many customers fully cancelled one recurring
 * product from one period to the next (bill dropped all the way to $0) —
 * read from the same data and endpoint as "Customer upgrades"/"Customer
 * downgrades" (see backend's customerUpgradesTrend.service.ts), just the
 * churn third of each point. A churned customer is never also counted as a
 * downgrade — see that function's doc comment. Carries its own independent
 * product/granularity selection.
 */
export const CustomerChurnTrendChart: React.FC<CustomerChurnTrendChartProps> = ({
  data,
  isLoading,
  products,
  granularity,
  onGranularityChange,
  selectedProductId,
  onProductChange
}) => {
  const [valueMode, setValueMode] = useState<ValueMode>('customers')

  const requiredFrequency = granularity === 'monthly' ? 'monthly' : 'yearly'
  const eligibleProducts = products.filter((p) => p.category === 'recurring' && p.billingFrequency === requiredFrequency)

  // Whenever the granularity changes (or the eligible list itself changes), make sure the
  // current selection is still valid — default to the first eligible product otherwise.
  useEffect(() => {
    if (eligibleProducts.length === 0) {
      if (selectedProductId) onProductChange('')
      return
    }
    if (!eligibleProducts.some((p) => p.providerRecordId === selectedProductId)) {
      onProductChange(eligibleProducts[0].providerRecordId)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [granularity, eligibleProducts.map((p) => p.providerRecordId).join(',')])

  const selectedProductName = eligibleProducts.find((p) => p.providerRecordId === selectedProductId)?.name
  const points = data?.points ?? []
  const rows = points.map((point) => ({
    period: formatPeriodLabel(point.period, granularity),
    churn: valueMode === 'customers' ? point.churnCount : point.churnAmount
  }))

  const perPointWidth = granularity === 'monthly' ? 56 : 90
  const chartWidth = Math.max(360, rows.length * perPointWidth)

  return (
    <div className="card p-6 lg:col-span-3">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-ink">Customer churn{selectedProductName ? ` — ${selectedProductName}` : ''}</h2>
          <p className="mt-1 text-sm text-ink-2">
            Customers who fully cancelled this product — their bill dropped all the way to $0 from one {granularity === 'monthly' ? 'month' : 'year'} to the
            next. Only recurring products billed {granularity === 'monthly' ? 'monthly' : 'yearly'} are eligible for this view.
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
              {eligibleProducts.map((product) => (
                <option key={product.providerRecordId} value={product.providerRecordId}>
                  {product.name}
                </option>
              ))}
            </select>
          )}

          <div className="flex items-center gap-3 rounded-lg border border-line-strong bg-surface-3 px-3 py-1.5 text-sm text-ink-2">
            <label className="flex items-center gap-1.5">
              <input type="radio" name="customerChurnGranularity" checked={granularity === 'monthly'} onChange={() => onGranularityChange('monthly')} />
              Monthly
            </label>
            <label className="flex items-center gap-1.5">
              <input type="radio" name="customerChurnGranularity" checked={granularity === 'annually'} onChange={() => onGranularityChange('annually')} />
              Annually
            </label>
          </div>

          <div className="flex items-center gap-3 rounded-lg border border-line-strong bg-surface-3 px-3 py-1.5 text-sm text-ink-2">
            <label className="flex items-center gap-1.5">
              <input type="radio" name="customerChurnValueMode" checked={valueMode === 'customers'} onChange={() => setValueMode('customers')} />
              Customer wise
            </label>
            <label className="flex items-center gap-1.5">
              <input type="radio" name="customerChurnValueMode" checked={valueMode === 'amount'} onChange={() => setValueMode('amount')} />
              Amount wise
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
          <div style={{ minWidth: chartWidth, height: 300 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={rows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barCategoryGap="30%">
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
                  allowDecimals={valueMode === 'amount'}
                  tickFormatter={(v: number) => formatValue(v, valueMode)}
                  width={valueMode === 'amount' ? 70 : 48}
                />
                <Tooltip
                  cursor={{ fill: 'var(--color-surface-3)' }}
                  contentStyle={{ background: 'var(--color-surface-3)', border: '1px solid var(--color-line-strong)', borderRadius: 8, fontSize: 12 }}
                  labelStyle={{ color: 'var(--color-ink)', fontWeight: 600, marginBottom: 4 }}
                  formatter={(value) => [
                    typeof value === 'number' ? formatValue(value, valueMode) : '—',
                    valueMode === 'customers' ? 'Churned' : 'Churned amount'
                  ]}
                />
                <Bar dataKey="churn" name={valueMode === 'customers' ? 'Churned' : 'Churned amount'} fill="var(--color-warning)" radius={[3, 3, 0, 0]} maxBarSize={40} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </div>
  )
}
