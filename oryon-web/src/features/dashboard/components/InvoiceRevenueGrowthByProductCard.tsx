import React, { useState } from 'react'
import { Download, Loader2 } from 'lucide-react'
import { InvoiceRevenueGrowthByProductResult, getInvoiceRevenueGrowthByProductDetailRequest } from '../api/productRevenueGrowthApi'
import { ProductRevenueGrowthChart } from './ProductRevenueGrowthChart'
import { MultiSelectDropdown } from './MultiSelectDropdown'
import { exportInvoiceRevenueGrowthDetailToExcel } from '../utils/exportInvoiceRevenueGrowthDetailToExcel'
import { AnalyzeButton } from '../../aiAnalysis/components/AnalyzeButton'

interface InvoiceRevenueGrowthByProductCardProps {
  data?: InvoiceRevenueGrowthByProductResult
  isLoading: boolean
  viewMode: 'percentage' | 'absolute'
  onViewModeChange: (mode: 'percentage' | 'absolute') => void
  /** Same "From year" filter the aggregate above was fetched with — passed through to the detail export so it reconciles against what's actually on screen. */
  fromYear?: string
}

// Same palette/order as ProductRevenueGrowthChart's own SERIES_PALETTE, so the
// dropdown's color dots always match the bar colors that chart actually renders —
// duplicated rather than imported since that palette isn't exported, same as the
// small repeated style constants across the dashboard's export utils.
const PRODUCT_SERIES_PALETTE = ['var(--color-brand)', 'var(--color-violet)', 'var(--color-teal)', 'var(--color-success)', 'var(--color-warning)', 'var(--color-danger)']

/**
 * "Revenue growth by product," computed entirely from this org's own synced
 * QuickBooks invoice line items rather than the card above's live
 * per-product Profit & Loss report — a cross-check against the live figures,
 * not a replacement for them (QuickBooks' P&L is accrual-basis and can
 * include non-invoice income documents, so the two can read a bit
 * differently; see productRevenueGrowth.service.ts's
 * getInvoiceRevenueGrowthByProduct). Auto-loads and is cheap — unlike the
 * live card, this never calls QuickBooks, so every product's trend arrives
 * in one request instead of one report per product. A multi-select dropdown
 * (same shared picker as Leads by Month / Opportunities by Lead Source)
 * lets several products be compared side by side — leaving it empty keeps
 * the original "every product" default. Reuses the same
 * ProductRevenueGrowthChart the live card renders (passed the already
 * filtered-to-selection product list, so that chart's own "one series per
 * product" rendering needs no changes), since the data shape (one series
 * per product, month-over-month revenue + growth %) is identical either
 * way. The "export to Excel" button only appears for exactly one selected
 * product — the detail endpoint it calls is scoped to a single product id.
 */
export const InvoiceRevenueGrowthByProductCard: React.FC<InvoiceRevenueGrowthByProductCardProps> = ({ data, isLoading, viewMode, onViewModeChange, fromYear }) => {
  const products = data?.products ?? []
  const [selectedProductIds, setSelectedProductIds] = useState<string[]>([])
  const [isExporting, setIsExporting] = useState(false)

  const toggleProduct = (productId: string) => {
    setSelectedProductIds((prev) => (prev.includes(productId) ? prev.filter((id) => id !== productId) : [...prev, productId]))
  }

  const filteredProducts = selectedProductIds.length > 0 ? products.filter((p) => selectedProductIds.includes(p.id)) : products
  const singleSelectedProductName = selectedProductIds.length === 1 ? products.find((p) => p.id === selectedProductIds[0])?.name : undefined

  const handleExport = async () => {
    if (selectedProductIds.length !== 1 || !singleSelectedProductName || isExporting) return
    setIsExporting(true)
    try {
      const detail = await getInvoiceRevenueGrowthByProductDetailRequest(selectedProductIds[0], singleSelectedProductName, { fromYear })
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
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <h2 className="text-lg font-semibold text-ink">Revenue growth by product (from synced invoices)</h2>
            <AnalyzeButton chartKey="invoice-revenue-growth-by-product" chartTitle="Revenue growth by product" />
          </div>
          <p className="mt-1 text-sm text-ink-2">
            Same month-over-month revenue growth as the card above, computed entirely from this org's own synced invoice line items instead of a live
            QuickBooks Profit &amp; Loss report — a cross-check against the live figures, not a replacement for them.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {products.length > 0 && (
            <MultiSelectDropdown
              options={products.map((product, index) => ({
                id: product.id,
                label: product.name,
                color: PRODUCT_SERIES_PALETTE[filteredProducts.findIndex((p) => p.id === product.id) % PRODUCT_SERIES_PALETTE.length] ?? PRODUCT_SERIES_PALETTE[index % PRODUCT_SERIES_PALETTE.length]
              }))}
              selectedIds={selectedProductIds}
              onToggle={toggleProduct}
              placeholder="All products"
              itemNounPlural="products"
            />
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
          {selectedProductIds.length === 1 && (
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
          <ProductRevenueGrowthChart products={filteredProducts} selectedProductId="" viewMode={viewMode} />
        </div>
      )}
    </div>
  )
}
