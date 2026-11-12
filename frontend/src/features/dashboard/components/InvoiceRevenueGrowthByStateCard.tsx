import React, { useState } from 'react'
import { Download, Loader2 } from 'lucide-react'
import { InvoiceRevenueGrowthByStateResult, getInvoiceRevenueGrowthByStateDetailRequest } from '../api/productRevenueGrowthApi'
import { Product } from '../api/syncApi'
import { ProductRevenueGrowthChart } from './ProductRevenueGrowthChart'
import { MultiSelectDropdown } from './MultiSelectDropdown'
import { exportInvoiceRevenueGrowthByStateDetailToExcel } from '../utils/exportInvoiceRevenueGrowthByStateDetailToExcel'

interface InvoiceRevenueGrowthByStateCardProps {
  data?: InvoiceRevenueGrowthByStateResult
  isLoading: boolean
  viewMode: 'percentage' | 'absolute'
  onViewModeChange: (mode: 'percentage' | 'absolute') => void
  products: Product[]
  /** '' = every product's revenue blended together (default); an id narrows to just that product's revenue by state. */
  selectedProductId: string
  onProductChange: (productId: string) => void
  /** Same "From year" filter the aggregate above was fetched with — passed through to the detail export so it reconciles against what's actually on screen. */
  fromYear?: string
}

// Same palette/order as ProductRevenueGrowthChart's own SERIES_PALETTE, so the
// dropdown's color dots always match the bar colors that chart actually renders —
// duplicated rather than imported since that palette isn't exported, same as
// InvoiceRevenueGrowthByProductCard's PRODUCT_SERIES_PALETTE.
const STATE_SERIES_PALETTE = ['var(--color-brand)', 'var(--color-violet)', 'var(--color-teal)', 'var(--color-success)', 'var(--color-warning)', 'var(--color-danger)']

/**
 * "Revenue growth by location" — the same month-over-month revenue growth
 * the card above shows per product, grouped by each invoice's billing-address
 * state instead (QuickBooks' `BillAddr.CountrySubDivisionCode`, synced per
 * invoice). Storage-backed and cheap, same as the invoice-based product card
 * — never calls QuickBooks live. Reuses the same ProductRevenueGrowthChart,
 * since the data shape (one series per state, month-over-month revenue +
 * growth %) is identical, just relabeled. Carries its own product dropdown
 * (like NewCustomersTrendChart) so "how is this one product doing in each
 * state" is answerable without leaving this card. A multi-select dropdown
 * (same shared picker as the product-based card above, Leads by Month, and
 * Opportunities by Lead Source) lets several states be compared side by
 * side — leaving it empty keeps the original "every state" default. The
 * "export to Excel" button only appears for exactly one selected state —
 * the detail endpoint it calls is scoped to a single state.
 */
export const InvoiceRevenueGrowthByStateCard: React.FC<InvoiceRevenueGrowthByStateCardProps> = ({
  data,
  isLoading,
  viewMode,
  onViewModeChange,
  products,
  selectedProductId,
  onProductChange,
  fromYear
}) => {
  const states = data?.states ?? []
  const [selectedStateIds, setSelectedStateIds] = useState<string[]>([])
  const [isExporting, setIsExporting] = useState(false)
  const selectedProductName = products.find((p) => p.id === selectedProductId)?.name

  const toggleState = (stateId: string) => {
    setSelectedStateIds((prev) => (prev.includes(stateId) ? prev.filter((id) => id !== stateId) : [...prev, stateId]))
  }

  const filteredStates = selectedStateIds.length > 0 ? states.filter((s) => selectedStateIds.includes(s.id)) : states
  const singleSelectedStateId = selectedStateIds.length === 1 ? selectedStateIds[0] : undefined

  const handleExport = async () => {
    if (!singleSelectedStateId || isExporting) return
    setIsExporting(true)
    try {
      const detail = await getInvoiceRevenueGrowthByStateDetailRequest(singleSelectedStateId, { fromYear, itemId: selectedProductId || undefined, itemName: selectedProductName })
      await exportInvoiceRevenueGrowthByStateDetailToExcel({ fromYear, detail })
    } catch (err) {
      console.error('Failed to export invoice revenue growth by location detail to Excel', err)
    } finally {
      setIsExporting(false)
    }
  }

  return (
    <div className="card p-6 lg:col-span-3">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-ink">Revenue growth by location</h2>
          <p className="mt-1 text-sm text-ink-2">
            {selectedProductName
              ? `Month-over-month revenue for "${selectedProductName}" by billing-address state.`
              : "Month-over-month revenue by billing-address state, every product combined."}{' '}
            Computed entirely from this org's own synced invoices — needs a synced billing address, run a forced resync in Settings if a state you expect
            is missing.
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
              <option value="">All products</option>
              {products.map((product) => (
                <option key={product.id} value={product.id}>
                  {product.name}
                </option>
              ))}
            </select>
          )}

          {states.length > 0 && (
            <MultiSelectDropdown
              options={states.map((state, index) => ({
                id: state.id,
                label: state.name,
                color: STATE_SERIES_PALETTE[filteredStates.findIndex((s) => s.id === state.id) % STATE_SERIES_PALETTE.length] ?? STATE_SERIES_PALETTE[index % STATE_SERIES_PALETTE.length]
              }))}
              selectedIds={selectedStateIds}
              onToggle={toggleState}
              placeholder="All states"
              itemNounPlural="states"
            />
          )}

          {states.length > 0 && (
            <div className="flex items-center gap-3 rounded-lg border border-line-strong bg-surface-3 px-3 py-1.5 text-sm text-ink-2">
              <label className="flex items-center gap-1.5">
                <input type="radio" name="invoiceRevenueGrowthByStateViewMode" checked={viewMode === 'absolute'} onChange={() => onViewModeChange('absolute')} />
                Revenue
              </label>
              <label className="flex items-center gap-1.5">
                <input type="radio" name="invoiceRevenueGrowthByStateViewMode" checked={viewMode === 'percentage'} onChange={() => onViewModeChange('percentage')} />
                Growth %
              </label>
            </div>
          )}

          {selectedStateIds.length === 1 && (
            <button
              type="button"
              onClick={handleExport}
              disabled={isExporting}
              className="flex shrink-0 items-center gap-1.5 rounded-md border border-line-strong px-2.5 py-1.5 text-xs font-medium text-ink-2 transition-colors hover:bg-surface-3 hover:text-brand disabled:cursor-not-allowed disabled:opacity-60"
              title="Export this state's month-by-month calculation, invoice by invoice, to Excel — to verify it"
            >
              {isExporting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
              Excel
            </button>
          )}
        </div>
      </div>

      {isLoading ? (
        <p className="mt-4 text-sm text-ink-3">Loading…</p>
      ) : states.length === 0 ? (
        <p className="mt-4 text-sm text-ink-3">
          {selectedProductName
            ? `No synced invoices for "${selectedProductName}" have a billing address yet.`
            : 'No synced invoices have a billing address yet — run a forced resync in Settings to see this.'}
        </p>
      ) : (
        <div className="mt-4">
          <ProductRevenueGrowthChart products={filteredStates} selectedProductId="" viewMode={viewMode} />
        </div>
      )}
    </div>
  )
}
