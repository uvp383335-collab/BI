import React from 'react'
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { ProductRevenueGrowthProduct } from '../api/productRevenueGrowthApi'
import { formatMetricValue } from '../utils/formatMetricValue'

interface ProductRevenueGrowthChartProps {
  products: ProductRevenueGrowthProduct[]
  /** Empty string = every loaded product, one series each; an id shows that product alone. */
  selectedProductId: string
  viewMode: 'percentage' | 'absolute'
}

// Six distinct hues already in the design system (see MetricTrendChart's per-metric
// colors) — cycled per product rather than adding a wider bespoke multi-series palette.
const SERIES_PALETTE = ['var(--color-brand)', 'var(--color-violet)', 'var(--color-teal)', 'var(--color-success)', 'var(--color-warning)', 'var(--color-danger)']

function formatValue(value: number | null | undefined, viewMode: 'percentage' | 'absolute'): string {
  if (value === null || value === undefined) return '—'
  return viewMode === 'percentage' ? formatMetricValue(value, 'percent') : formatMetricValue(value, 'usd')
}

/**
 * "Revenue growth by product" (docs/server.js §5, renderProductRevenueChart)
 * — one bar series per product (or a single series when one is selected),
 * either month-over-month growth % or absolute monthly revenue. The chart
 * scrolls horizontally rather than compressing bars when there are many
 * months, same as the prototype.
 */
export const ProductRevenueGrowthChart: React.FC<ProductRevenueGrowthChartProps> = ({ products, selectedProductId, viewMode }) => {
  if (products.length === 0) {
    return <div className="flex h-64 items-center justify-center text-sm text-ink-3">No data available for this range.</div>
  }

  const valueKey = viewMode === 'percentage' ? 'revenueGrowthPct' : 'revenue'
  const series = selectedProductId ? products.filter((p) => p.id === selectedProductId) : products
  const months = products[0].months.map((m) => m.month)

  const rows = months.map((month, index) => {
    const row: Record<string, string | number | null> = { month }
    series.forEach((product) => {
      row[product.id] = product.months[index]?.[valueKey] ?? null
    })
    return row
  })

  const perMonthWidth = series.length > 1 ? 50 : 34
  const chartWidth = Math.max(360, months.length * perMonthWidth)

  return (
    <div className="overflow-x-auto">
      <div style={{ width: chartWidth, height: 320 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid stroke="var(--color-line)" vertical={false} />
            <XAxis
              dataKey="month"
              stroke="var(--color-ink-3)"
              tick={{ fill: 'var(--color-ink-2)', fontSize: 11 }}
              tickLine={false}
              axisLine={{ stroke: 'var(--color-line)' }}
              interval="preserveStartEnd"
              minTickGap={20}
            />
            <YAxis
              stroke="var(--color-ink-3)"
              tick={{ fill: 'var(--color-ink-2)', fontSize: 11 }}
              tickLine={false}
              axisLine={false}
              tickFormatter={(v: number) => formatValue(v, viewMode)}
              width={64}
            />
            <Tooltip
              contentStyle={{ background: 'var(--color-surface-3)', border: '1px solid var(--color-line-strong)', borderRadius: 8, fontSize: 12 }}
              labelStyle={{ color: 'var(--color-ink)', fontWeight: 600, marginBottom: 4 }}
              formatter={(value) => formatValue(typeof value === 'number' ? value : null, viewMode)}
            />
            {series.length > 1 && <Legend wrapperStyle={{ fontSize: 12 }} />}
            {series.map((product, index) => (
              <Bar
                key={product.id}
                dataKey={product.id}
                name={product.name}
                fill={SERIES_PALETTE[index % SERIES_PALETTE.length]}
                radius={[4, 4, 0, 0]}
                maxBarSize={series.length > 1 ? 10 : 22}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
