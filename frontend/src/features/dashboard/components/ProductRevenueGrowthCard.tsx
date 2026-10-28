import React, { useEffect, useState } from 'react'
import { ProductRevenueGrowthResult } from '../api/productRevenueGrowthApi'
import { ProductRevenueGrowthChart } from './ProductRevenueGrowthChart'

interface ProductRevenueGrowthCardProps {
  data?: ProductRevenueGrowthResult
  isLoading: boolean
  error?: string | null
  viewMode: 'percentage' | 'absolute'
  onViewModeChange: (mode: 'percentage' | 'absolute') => void
}

// Preferred default selection — falls back to the first product in the list if this one isn't present.
const DEFAULT_PRODUCT_NAME = 'Inventory Management Add-on - Annual'

/**
 * "Revenue growth by product" (docs/server.js §5) — one product's own
 * month-over-month revenue trend, fetched live from QuickBooks (one P&L
 * report per product) rather than from a pre-synced snapshot. Auto-loads
 * like every other card in this section, and refetches whenever the
 * shared From year/location/state filters change. Always scoped to exactly
 * one product — plotting every product's series on one chart at once was
 * unreadable (a 40-line legend, a rainbow of recycled colors), so the
 * dropdown here always has a single selection, defaulting to
 * `DEFAULT_PRODUCT_NAME` once loaded (or the first product if that one
 * isn't in this org's catalog).
 */
export const ProductRevenueGrowthCard: React.FC<ProductRevenueGrowthCardProps> = ({ data, isLoading, error, viewMode, onViewModeChange }) => {
  const products = data?.products ?? []
  const [selectedProductId, setSelectedProductId] = useState('')

  // Default to DEFAULT_PRODUCT_NAME (or the first product, if that one isn't in this org's
  // catalog) whenever a fresh load replaces the product list — never land on "nothing
  // selected," and never carry over a selection that no longer exists.
  useEffect(() => {
    if (products.length > 0 && !products.some((p) => p.id === selectedProductId)) {
      const defaultProduct = products.find((p) => p.name.toLowerCase() === DEFAULT_PRODUCT_NAME.toLowerCase()) ?? products[0]
      setSelectedProductId(defaultProduct.id)
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }
  }, [products])

  return (
    <div className="card p-6 lg:col-span-3">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-ink">Revenue growth by product</h2>
          <p className="mt-1 text-sm text-ink-2">Month-over-month revenue for one product at a time, live from QuickBooks.</p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {products.length > 0 && (
            <select
              className="form-input-dark w-56 truncate sm:w-72"
              value={selectedProductId}
              onChange={(e) => setSelectedProductId(e.target.value)}
              aria-label="Product"
              title={products.find((p) => p.id === selectedProductId)?.name}
            >
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
                <input type="radio" name="productRevenueGrowthViewMode" checked={viewMode === 'absolute'} onChange={() => onViewModeChange('absolute')} />
                Revenue
              </label>
              <label className="flex items-center gap-1.5">
                <input type="radio" name="productRevenueGrowthViewMode" checked={viewMode === 'percentage'} onChange={() => onViewModeChange('percentage')} />
                Growth %
              </label>
            </div>
          )}
        </div>
      </div>

      {error && <p className="mt-4 text-sm text-danger">{error}</p>}

      {!error && data?.message && <p className="mt-4 text-sm text-ink-3">{data.message}</p>}

      {data && data.failedProducts.length > 0 && (
        <p className="mt-2 text-xs text-warning">Could not load: {data.failedProducts.map((p) => p.name).join(', ')}</p>
      )}

      {isLoading ? (
        <p className="mt-4 text-sm text-ink-3">Fetching every product's revenue growth from QuickBooks — this runs one report per product, so it can take a while…</p>
      ) : !data ? (
        <p className="mt-4 text-sm text-ink-3">No data available for this range.</p>
      ) : (
        <div className="mt-4">
          <ProductRevenueGrowthChart products={products} selectedProductId={selectedProductId} viewMode={viewMode} />
        </div>
      )}
    </div>
  )
}
