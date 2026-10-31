import React, { useState } from 'react'
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Download, Loader2 } from 'lucide-react'
import { NewCustomersTrendResult, getNewCustomersTrendDetailRequest } from '../api/productRevenueGrowthApi'
import { Product } from '../api/syncApi'
import { formatMetricValue } from '../utils/formatMetricValue'
import { exportNewCustomersDetailToExcel } from '../utils/exportNewCustomersDetailToExcel'

interface NewCustomersTrendChartProps {
  data?: NewCustomersTrendResult
  isLoading: boolean
  products: Product[]
  /** '' = new to the business (default); an id narrows to customers new to that specific product. */
  selectedProductId: string
  onProductChange: (productId: string) => void
  /** Same "From year" filter the aggregate above was fetched with — passed through to the detail export so it reconciles against what's actually on screen. */
  fromYear?: string
}

/** 'customers' = headcount of new customers; 'amount' = total revenue from their first invoices. */
type ValueMode = 'customers' | 'amount'

const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** "2026-04" -> "Apr '26" */
function formatMonthLabel(month: string): string {
  const [year, m] = month.split('-').map(Number)
  return `${MONTH_LABELS[m - 1]} '${String(year).slice(2)}`
}

function formatValue(value: number | null | undefined, valueMode: ValueMode): string {
  if (value === null || value === undefined) return '—'
  return valueMode === 'customers' ? formatMetricValue(value, 'count') : formatMetricValue(value, 'usd')
}

/**
 * Dashboard bar chart: how many customers' very first invoice ever fell in
 * each month (see backend's newCustomersTrend.service.ts) — a customer
 * counts as "new" exactly once, in the month their first invoice was
 * created, never again on a later invoice. Carries its own product
 * dropdown (not a filter living elsewhere on the page) — selecting a
 * product narrows "new" to customers new to *that product* specifically
 * (which can be an existing customer trying it for the first time), rather
 * than new to the business. Not a `MetricCard` — a plain count trend, no
 * single headline value — so this renders its own standalone card.
 */
export const NewCustomersTrendChart: React.FC<NewCustomersTrendChartProps> = ({ data, isLoading, products, selectedProductId, onProductChange, fromYear }) => {
  const [valueMode, setValueMode] = useState<ValueMode>('customers')
  const [isExporting, setIsExporting] = useState(false)

  const handleExport = async () => {
    if (isExporting) return
    setIsExporting(true)
    try {
      const detail = await getNewCustomersTrendDetailRequest(fromYear, selectedProductId || undefined)
      await exportNewCustomersDetailToExcel({ fromYear, itemName: selectedProductName, detail })
    } catch (err) {
      console.error('Failed to export new customers detail to Excel', err)
    } finally {
      setIsExporting(false)
    }
  }

  const points = data?.points ?? []
  const rows = points.map((point) => ({
    month: formatMonthLabel(point.month),
    newCustomers: valueMode === 'customers' ? point.newCustomerCount : point.newCustomerAmount
  }))
  const selectedProductName = products.find((p) => p.id === selectedProductId)?.name

  const perMonthWidth = 56
  const chartWidth = Math.max(360, rows.length * perMonthWidth)

  return (
    <div className="card p-6 lg:col-span-3">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-ink">New customers</h2>
          <p className="mt-1 text-sm text-ink-2">
            {selectedProductName
              ? `Customers whose first invoice ever containing "${selectedProductName}" fell in each month — including existing customers trying it for the first time.`
              : "Customers whose first-ever QuickBooks invoice fell in each month."}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {products.length > 0 && (
            <select
              className="form-input-dark w-56 truncate sm:w-72"
              value={selectedProductId}
              onChange={(e) => onProductChange(e.target.value)}
              aria-label="Product"
              title={selectedProductName}
            >
              <option value="">All products (new to the business)</option>
              {products.map((product) => (
                <option key={product.id} value={product.id}>
                  {product.name}
                </option>
              ))}
            </select>
          )}

          <div className="flex items-center gap-3 rounded-lg border border-line-strong bg-surface-3 px-3 py-1.5 text-sm text-ink-2">
            <label className="flex items-center gap-1.5">
              <input type="radio" name="newCustomersValueMode" checked={valueMode === 'customers'} onChange={() => setValueMode('customers')} />
              Customer wise
            </label>
            <label className="flex items-center gap-1.5">
              <input type="radio" name="newCustomersValueMode" checked={valueMode === 'amount'} onChange={() => setValueMode('amount')} />
              Amount wise
            </label>
          </div>

          <button
            type="button"
            onClick={handleExport}
            disabled={isExporting}
            className="flex shrink-0 items-center gap-1.5 rounded-md border border-line-strong px-2.5 py-1.5 text-xs font-medium text-ink-2 transition-colors hover:bg-surface-3 hover:text-brand disabled:cursor-not-allowed disabled:opacity-60"
            title="Export every month's underlying customers to Excel, to verify the calculation"
          >
            {isExporting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
            Excel
          </button>
        </div>
      </div>

      {isLoading ? (
        <p className="mt-4 text-sm text-ink-3">Loading…</p>
      ) : !data?.hasInvoices ? (
        <p className="mt-4 text-sm text-ink-3">No invoices synced yet — sync QuickBooks to see this trend.</p>
      ) : (
        <div className="mt-4 overflow-x-auto">
          {/* `minWidth` (not `width`) so the chart fills the card on a normal-width screen. */}
          <div style={{ minWidth: chartWidth, height: 300 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={rows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barCategoryGap="35%">
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
                    valueMode === 'customers' ? 'New customers' : 'New customer revenue'
                  ]}
                />
                <Bar
                  dataKey="newCustomers"
                  name={valueMode === 'customers' ? 'New customers' : 'New customer revenue'}
                  fill="var(--color-teal)"
                  radius={[3, 3, 0, 0]}
                  maxBarSize={40}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </div>
  )
}
