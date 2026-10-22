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

  const perMonthWidth = series.length > 1 ? 50 : 44
  const chartWidth = Math.max(360, months.length * perMonthWidth)

  return (
    <div className="overflow-x-auto">
      {/* `minWidth` (not `width`) so the chart fills its card on a normal-width screen — it only
          grows past 100% (triggering the scrollbar above) once there are too many months to fit. */}
      <div style={{ minWidth: chartWidth, height: 340 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barCategoryGap="30%" barGap={2}>
            <CartesianGrid stroke="var(--color-line)" vertical={false} />
            <XAxis
              dataKey="month"
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
              tickFormatter={(v: number) => formatValue(v, viewMode)}
              width={76}
            />
            <Tooltip
              cursor={{ fill: 'var(--color-surface-3)' }}
              contentStyle={{ background: 'var(--color-surface-3)', border: '1px solid var(--color-line-strong)', borderRadius: 8, fontSize: 12 }}
              labelStyle={{ color: 'var(--color-ink)', fontWeight: 600, marginBottom: 4 }}
              formatter={(value) => formatValue(typeof value === 'number' ? value : null, viewMode)}
            />
            {series.length > 1 && <Legend wrapperStyle={{ fontSize: 12, paddingTop: 8 }} iconType="circle" iconSize={8} />}
            {series.map((product, index) => (
              <Bar
                key={product.id}
                dataKey={product.id}
                name={product.name}
                fill={SERIES_PALETTE[index % SERIES_PALETTE.length]}
                radius={[3, 3, 0, 0]}
                maxBarSize={series.length > 1 ? 10 : 40}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
