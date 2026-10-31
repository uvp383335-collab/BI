import React, { useState } from 'react'
import { Download, Loader2 } from 'lucide-react'
import { InvoiceRevenueGrowthByProductResult, getInvoiceRevenueGrowthByProductDetailRequest } from '../api/productRevenueGrowthApi'
import { ProductRevenueGrowthChart } from './ProductRevenueGrowthChart'
import { exportInvoiceRevenueGrowthDetailToExcel } from '../utils/exportInvoiceRevenueGrowthDetailToExcel'

interface InvoiceRevenueGrowthByProductCardProps {
  data?: InvoiceRevenueGrowthByProductResult
  isLoading: boolean
  viewMode: 'percentage' | 'absolute'
  onViewModeChange: (mode: 'percentage' | 'absolute') => void
  /** Same "From year" filter the aggregate above was fetched with — passed through to the detail export so it reconciles against what's actually on screen. */
  fromYear?: string
}

/**
 * "Revenue growth by product," computed entirely from this org's own synced
 * QuickBooks invoice line items rather than the card above's live
 * per-product Profit & Loss report — a cross-check against the live figures,
 * not a replacement for them (QuickBooks' P&L is accrual-basis and can
 * include non-invoice income documents, so the two can read a bit
 * differently; see productRevenueGrowth.service.ts's
 * getInvoiceRevenueGrowthByProduct). Auto-loads and is cheap — unlike the
 * live card, this never calls QuickBooks, so every product's trend arrives
 * in one request instead of one report per product. Reuses the same
 * ProductRevenueGrowthChart the live card renders, since the data shape
 * (one series per product, month-over-month revenue + growth %) is
 * identical either way.
 */
export const InvoiceRevenueGrowthByProductCard: React.FC<InvoiceRevenueGrowthByProductCardProps> = ({ data, isLoading, viewMode, onViewModeChange, fromYear }) => {
  const products = data?.products ?? []
  const [selectedProductId, setSelectedProductId] = useState('')
  const [isExporting, setIsExporting] = useState(false)

  const selectedProductName = products.find((p) => p.id === selectedProductId)?.name

  const handleExport = async () => {
    if (!selectedProductId || !selectedProductName || isExporting) return
    setIsExporting(true)
    try {
      const detail = await getInvoiceRevenueGrowthByProductDetailRequest(selectedProductId, selectedProductName, { fromYear })
      await exportInvoiceRevenueGrowthDetailToExcel({ fromYear, detail })
    } catch (err) {
      console.error('Failed to export invoice revenue growth detail to Excel', err)
    } finally {
      setIsExporting(false)
    }
  }

  return (
    <div className="card p-6 lg:col-span-3">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-ink">Revenue growth by product (from synced invoices)</h2>
          <p className="mt-1 text-sm text-ink-2">
            Same month-over-month revenue growth as the card above, computed entirely from this org's own synced invoice line items instead of a live
            QuickBooks Profit &amp; Loss report — a cross-check against the live figures, not a replacement for them.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {products.length > 0 && (
            <select
              className="form-input-dark w-56 truncate sm:w-72"
              value={selectedProductId}
              onChange={(e) => setSelectedProductId(e.target.value)}
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

          {products.length > 0 && (
            <div className="flex items-center gap-3 rounded-lg border border-line-strong bg-surface-3 px-3 py-1.5 text-sm text-ink-2">
              <label className="flex items-center gap-1.5">
                <input type="radio" name="invoiceRevenueGrowthViewMode" checked={viewMode === 'absolute'} onChange={() => onViewModeChange('absolute')} />
                Revenue
              </label>
              <label className="flex items-center gap-1.5">
                <input type="radio" name="invoiceRevenueGrowthViewMode" checked={viewMode === 'percentage'} onChange={() => onViewModeChange('percentage')} />
                Growth %
              </label>
            </div>
          )}

          {selectedProductId && (
            <button
              type="button"
              onClick={handleExport}
              disabled={isExporting}
              className="flex shrink-0 items-center gap-1.5 rounded-md border border-line-strong px-2.5 py-1.5 text-xs font-medium text-ink-2 transition-colors hover:bg-surface-3 hover:text-brand disabled:cursor-not-allowed disabled:opacity-60"
              title="Export this product's month-by-month calculation, invoice by invoice, to Excel — to verify it"
            >
              {isExporting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
              Excel
            </button>
          )}
        </div>
      </div>

      {isLoading ? (
        <p className="mt-4 text-sm text-ink-3">Loading…</p>
      ) : products.length === 0 ? (
        <p className="mt-4 text-sm text-ink-3">No synced invoice line items for any product in this range yet.</p>
      ) : (
        <div className="mt-4">
          <ProductRevenueGrowthChart products={products} selectedProductId={selectedProductId} viewMode={viewMode} />
        </div>
      )}
    </div>
  )
}
