import React, { useState } from 'react'
import { Download, Loader2 } from 'lucide-react'
import { InvoiceRevenueGrowthByClassResult, getInvoiceRevenueGrowthByClassDetailRequest } from '../api/productRevenueGrowthApi'
import { ProductRevenueGrowthChart } from './ProductRevenueGrowthChart'
import { MultiSelectDropdown } from './MultiSelectDropdown'
import { exportInvoiceRevenueGrowthByClassDetailToExcel } from '../utils/exportInvoiceRevenueGrowthByClassDetailToExcel'
import { AnalyzeButton } from '../../aiAnalysis/components/AnalyzeButton'

interface InvoiceRevenueGrowthByClassCardProps {
  data?: InvoiceRevenueGrowthByClassResult
  isLoading: boolean
  viewMode: 'percentage' | 'absolute'
  onViewModeChange: (mode: 'percentage' | 'absolute') => void
  /** Same "From year" filter the aggregate above was fetched with — passed through to the detail export so it reconciles against what's actually on screen. */
  fromYear?: string
}

// Same palette/order as ProductRevenueGrowthChart's own SERIES_PALETTE, so the
// dropdown's color dots always match the bar colors that chart actually renders.
const CLASS_SERIES_PALETTE = ['var(--color-brand)', 'var(--color-violet)', 'var(--color-teal)', 'var(--color-success)', 'var(--color-warning)', 'var(--color-danger)']

/**
 * "Revenue growth by class," the QuickBooks Class-dimension counterpart to
 * "Revenue growth by product (from synced invoices)" — same month-over-month
 * shape, computed entirely from this org's own synced QuickBooks invoice
 * line items' Class reference. Never calls QuickBooks live. QuickBooks Class
 * tracking is an opt-in, org-wide setting, and this field is only captured
 * on invoices synced (or resynced) after it was added — an org without
 * either sees a graceful "no data" message rather than a crash. Reuses the
 * same ProductRevenueGrowthChart the product/location cards render, fed each
 * class's id/name as the series id/name. The "export to Excel" button only
 * appears for exactly one selected class — the detail endpoint it calls is
 * scoped to a single class id.
 */
export const InvoiceRevenueGrowthByClassCard: React.FC<InvoiceRevenueGrowthByClassCardProps> = ({ data, isLoading, viewMode, onViewModeChange, fromYear }) => {
  const classes = data?.classes ?? []
  const [selectedClassIds, setSelectedClassIds] = useState<string[]>([])
  const [isExporting, setIsExporting] = useState(false)

  const toggleClass = (classId: string) => {
    setSelectedClassIds((prev) => (prev.includes(classId) ? prev.filter((id) => id !== classId) : [...prev, classId]))
  }

  const filteredClasses = selectedClassIds.length > 0 ? classes.filter((c) => selectedClassIds.includes(c.id)) : classes
  const singleSelectedClassName = selectedClassIds.length === 1 ? classes.find((c) => c.id === selectedClassIds[0])?.name : undefined

  const handleExport = async () => {
    if (selectedClassIds.length !== 1 || !singleSelectedClassName || isExporting) return
    setIsExporting(true)
    try {
      const detail = await getInvoiceRevenueGrowthByClassDetailRequest(selectedClassIds[0], singleSelectedClassName, { fromYear })
      await exportInvoiceRevenueGrowthByClassDetailToExcel({ fromYear, detail })
    } catch (err) {
      console.error('Failed to export invoice revenue growth by class detail to Excel', err)
    } finally {
      setIsExporting(false)
    }
  }

  return (
    <div className="card p-6 lg:col-span-3">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <h2 className="text-lg font-semibold text-ink">Revenue growth by class (from synced invoices)</h2>
            <AnalyzeButton chartKey="invoice-revenue-growth-by-class" chartTitle="Revenue growth by class" />
          </div>
          <p className="mt-1 text-sm text-ink-2">
            Same month-over-month revenue growth as "Revenue growth by product," grouped by each invoice line's QuickBooks Class instead of by product.
            Requires QuickBooks Class tracking to be enabled and a forced resync to backfill existing invoices.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {classes.length > 0 && (
            <MultiSelectDropdown
              options={classes.map((cls, index) => ({
                id: cls.id,
                label: cls.name,
                color: CLASS_SERIES_PALETTE[filteredClasses.findIndex((c) => c.id === cls.id) % CLASS_SERIES_PALETTE.length] ?? CLASS_SERIES_PALETTE[index % CLASS_SERIES_PALETTE.length]
              }))}
              selectedIds={selectedClassIds}
              onToggle={toggleClass}
              placeholder="All classes"
              itemNounPlural="classes"
            />
          )}

          {classes.length > 0 && (
            <div className="flex items-center gap-3 rounded-lg border border-line-strong bg-surface-3 px-3 py-1.5 text-sm text-ink-2">
              <label className="flex items-center gap-1.5">
                <input type="radio" name="invoiceRevenueGrowthByClassViewMode" checked={viewMode === 'absolute'} onChange={() => onViewModeChange('absolute')} />
                Revenue
              </label>
              <label className="flex items-center gap-1.5">
                <input type="radio" name="invoiceRevenueGrowthByClassViewMode" checked={viewMode === 'percentage'} onChange={() => onViewModeChange('percentage')} />
                Growth %
              </label>
            </div>
          )}
          {selectedClassIds.length === 1 && (
            <button
              type="button"
              onClick={handleExport}
              disabled={isExporting}
              className="flex shrink-0 items-center gap-1.5 rounded-md border border-line-strong px-2.5 py-1.5 text-xs font-medium text-ink-2 transition-colors hover:bg-surface-3 hover:text-brand disabled:cursor-not-allowed disabled:opacity-60"
              title="Export this class's month-by-month calculation, invoice by invoice, to Excel — to verify it"
            >
              {isExporting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
              Excel
            </button>
          )}
        </div>
      </div>

      {isLoading ? (
        <p className="mt-4 text-sm text-ink-3">Loading…</p>
      ) : classes.length === 0 ? (
        <p className="mt-4 text-sm text-ink-3">
          No synced invoice line items with a QuickBooks Class in this range yet. Class tracking must be enabled in QuickBooks, and existing invoices need a
          forced resync (Settings &gt; QuickBooks &gt; "Force full resync") to pick it up.
        </p>
      ) : (
        <div className="mt-4">
          <ProductRevenueGrowthChart products={filteredClasses} selectedProductId="" viewMode={viewMode} />
        </div>
      )}
    </div>
  )
}
