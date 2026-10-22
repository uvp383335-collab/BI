import React, { useEffect, useRef, useState } from 'react'
import { DayPicker, type DateRange as DayPickerRange } from 'react-day-picker'
import 'react-day-picker/style.css'
import { Calendar, X } from 'lucide-react'

interface DateRangeFilterProps {
  /** ISO date strings (YYYY-MM-DD). */
  from?: string
  to?: string
  onChange: (range: { from?: string; to?: string }) => void
}

/** Parses a YYYY-MM-DD string as a local date, avoiding the UTC-shift bug new Date(str) has near midnight. */
function parseISODate(value?: string): Date | undefined {
  if (!value) return undefined
  const [year, month, day] = value.split('-').map(Number)
  return new Date(year, month - 1, day)
}

function formatISODate(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function formatDisplay(value?: string): string {
  const date = parseISODate(value)
  return date ? date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : ''
}

/**
 * Shared date-range filter for the Funnels section. Sits in its own row,
 * separate from the section header — see dataviz guidance: a filter that
 * scopes multiple charts gets one row above them, not a spot squeezed into a
 * chart card's own header.
 */
export const DateRangeFilter: React.FC<DateRangeFilterProps> = ({ from, to, onChange }) => {
  const [isOpen, setIsOpen] = useState(false)
  // A draft selection, committed via onChange only on "Apply" — picking a
  // single day shouldn't refetch every chart, and range mode's first click
  // reports {from: day, to: day}, indistinguishable from a genuine 1-day
  // range if committed immediately.
  const [draft, setDraft] = useState<DayPickerRange | undefined>(
    from || to ? { from: parseISODate(from), to: parseISODate(to) } : undefined
  )
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setIsOpen(false)
    }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsOpen(false)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [])

  const openPicker = () => {
    setDraft(from || to ? { from: parseISODate(from), to: parseISODate(to) } : undefined)
    setIsOpen((open) => !open)
  }

  const applyDraft = () => {
    onChange({
      from: draft?.from ? formatISODate(draft.from) : undefined,
      to: draft?.to ? formatISODate(draft.to) : undefined
    })
    setIsOpen(false)
  }

  const hasRange = !!from || !!to
  const label = hasRange ? `${formatDisplay(from) || 'Start'} – ${formatDisplay(to) || 'End'}` : 'Date range'

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={openPicker}
        className="form-input-dark flex w-auto items-center gap-2"
        aria-expanded={isOpen}
      >
        <Calendar className="h-4 w-4 text-ink-3" />
        <span className={hasRange ? 'text-ink' : 'text-ink-3'}>{label}</span>
      </button>
      {hasRange && (
        <button
          type="button"
          aria-label="Clear date range"
          className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-surface-3 text-ink-3 transition-colors duration-150 hover:bg-surface-4 hover:text-ink"
          onClick={(e) => {
            e.stopPropagation()
            onChange({ from: undefined, to: undefined })
          }}
        >
          <X className="h-3 w-3" />
        </button>
      )}

      {isOpen && (
        <div className="card dashboard-daypicker absolute right-0 top-full z-20 mt-2 border-line-strong p-3 shadow-2xl shadow-black/40 animate-fade-in">
          <DayPicker mode="range" selected={draft} onSelect={setDraft} />
          <div className="mt-1 flex items-center justify-end gap-2 border-t border-line pt-3">
            <button
              type="button"
              className="btn-outline-dark w-auto px-3 py-1.5 text-xs"
              onClick={() => setDraft(undefined)}
            >
              Clear
            </button>
            <button type="button" className="btn-primary w-auto px-3 py-1.5 text-xs" onClick={applyDraft}>
              Apply
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
