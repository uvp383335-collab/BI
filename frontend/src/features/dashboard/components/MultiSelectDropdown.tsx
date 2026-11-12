import React, { useEffect, useRef, useState } from 'react'
import { ChevronDown } from 'lucide-react'

export interface MultiSelectOption {
  id: string
  label: string
  /** Dot color shown when this option is selected — falls back to the line color when unselected, same convention as every chart that uses this dropdown to also color its series. */
  color: string
}

interface MultiSelectDropdownProps {
  options: MultiSelectOption[]
  selectedIds: string[]
  onToggle: (id: string) => void
  /** Shown on the closed button when nothing is selected yet. */
  placeholder: string
  /** Plural noun for the "{n} ___ selected" summary once 2+ are selected, e.g. "campaigns", "products". */
  itemNounPlural: string
}

/**
 * Closed-by-default multi-select dropdown shared by every "pick several of
 * these to compare" filter on the dashboard (campaigns, lead sources,
 * products, …): a button summarizing the current selection, opening a
 * checkbox list on click. Closes on an outside click or Escape. Extracted
 * after the third near-identical copy (Leads by Month's campaign picker,
 * Opportunities by Lead Source's lead-source picker, and this) started
 * diverging — callers own their own color assignment (passed in via
 * `options[].color`) and series rendering; this only owns the open/closed
 * picker UI.
 */
export function MultiSelectDropdown({ options, selectedIds, onToggle, placeholder, itemNounPlural }: MultiSelectDropdownProps) {
  const [isOpen, setIsOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!isOpen) return
    const handlePointerDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setIsOpen(false)
    }
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsOpen(false)
    }
    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [isOpen])

  const selectedOptions = options.filter((o) => selectedIds.includes(o.id))
  const summary = selectedOptions.length === 0 ? placeholder : selectedOptions.length === 1 ? selectedOptions[0].label : `${selectedOptions.length} ${itemNounPlural} selected`

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setIsOpen((v) => !v)}
        className="form-input-dark flex w-56 items-center justify-between gap-2 truncate sm:w-72"
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        title={selectedOptions.map((o) => o.label).join(', ')}
      >
        <span className="truncate">{summary}</span>
        <ChevronDown className={`h-4 w-4 shrink-0 text-ink-3 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && (
        <div
          role="listbox"
          aria-multiselectable="true"
          className="absolute right-0 z-20 mt-1.5 max-h-72 w-72 overflow-y-auto rounded-lg border border-line-strong bg-surface-3 py-1.5 shadow-lg"
        >
          {options.map((option) => {
            const isSelected = selectedIds.includes(option.id)
            return (
              <label
                key={option.id}
                role="option"
                aria-selected={isSelected}
                className="flex cursor-pointer items-center gap-2.5 px-3 py-1.5 text-sm text-ink-2 hover:bg-surface-4"
              >
                <input type="checkbox" checked={isSelected} onChange={() => onToggle(option.id)} className="shrink-0" />
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: isSelected ? option.color : 'var(--color-line-strong)', flexShrink: 0 }} />
                <span className="truncate">{option.label}</span>
              </label>
            )
          })}
        </div>
      )}
    </div>
  )
}
