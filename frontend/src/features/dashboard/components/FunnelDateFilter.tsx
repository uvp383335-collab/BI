import React from 'react'
import { X } from 'lucide-react'

interface FunnelDateFilterProps {
  /** ISO date strings (YYYY-MM-DD). */
  from?: string
  to?: string
  onChange: (range: { from?: string; to?: string }) => void
}

interface QuarterOption {
  key: string
  label: string
  from: string
  to: string
}

/** How many quarters the dropdown lists, counting back from the current one. */
const QUARTERS_SHOWN = 8

function formatISODate(year: number, monthIndex: number, day: number): string {
  return `${year}-${String(monthIndex + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

/** Calendar quarters, newest first — e.g. "Q4 2026" = 2026-10-01 to 2026-12-31. */
function buildQuarterOptions(today: Date): QuarterOption[] {
  const options: QuarterOption[] = []
  let year = today.getFullYear()
  let quarter = Math.floor(today.getMonth() / 3) + 1
  for (let i = 0; i < QUARTERS_SHOWN; i++) {
    const startMonth = (quarter - 1) * 3
    // Day 0 of the following month is the last day of this quarter.
    const lastDay = new Date(year, startMonth + 3, 0).getDate()
    options.push({
      key: `${year}-Q${quarter}`,
      label: `Q${quarter} ${year}`,
      from: formatISODate(year, startMonth, 1),
      to: formatISODate(year, startMonth + 2, lastDay)
    })
    quarter -= 1
    if (quarter === 0) {
      quarter = 4
      year -= 1
    }
  }
  return options
}

/**
 * Shared date filter for the Funnels section: a quarter preset plus separate
 * From / To dates. Picking a quarter just fills both dates, so the dates are
 * the single source of truth — editing either one by hand drops the quarter
 * selection back to "Custom". The backend scopes each funnel to the cohort
 * whose first stage event falls in the window (funnel.service.ts), which
 * already reads imported `rl_*` dates when the org's HubSpot history-source
 * flag is on — nothing here depends on that flag.
 */
export const FunnelDateFilter: React.FC<FunnelDateFilterProps> = ({ from, to, onChange }) => {
  const quarters = React.useMemo(() => buildQuarterOptions(new Date()), [])
  const selectedQuarter = quarters.find((quarter) => quarter.from === from && quarter.to === to)
  const hasRange = !!from || !!to

  return (
    <div className="flex flex-wrap items-center gap-3">
      <select
        className="form-input-dark w-auto"
        aria-label="Quarter"
        value={selectedQuarter?.key ?? ''}
        onChange={(e) => {
          const quarter = quarters.find((option) => option.key === e.target.value)
          onChange(quarter ? { from: quarter.from, to: quarter.to } : { from: undefined, to: undefined })
        }}
      >
        <option value="">{hasRange ? 'Custom' : 'All quarters'}</option>
        {quarters.map((quarter) => (
          <option key={quarter.key} value={quarter.key}>
            {quarter.label}
          </option>
        ))}
      </select>
      <label className="flex items-center gap-2 text-sm text-ink-3">
        From
        <input
          type="date"
          className="form-input-dark w-auto [color-scheme:dark]"
          value={from ?? ''}
          max={to || undefined}
          // A typed date can bypass max; drop the other end rather than send a from > to the API rejects.
          onChange={(e) => {
            const value = e.target.value || undefined
            onChange({ from: value, to: value && to && value > to ? undefined : to })
          }}
        />
      </label>
      <label className="flex items-center gap-2 text-sm text-ink-3">
        To
        <input
          type="date"
          className="form-input-dark w-auto [color-scheme:dark]"
          value={to ?? ''}
          min={from || undefined}
          onChange={(e) => {
            const value = e.target.value || undefined
            onChange({ from: value && from && from > value ? undefined : from, to: value })
          }}
        />
      </label>
      {hasRange && (
        <button
          type="button"
          aria-label="Clear dates"
          className="flex h-7 w-7 items-center justify-center rounded-full text-ink-3 transition-colors duration-150 hover:bg-surface-3 hover:text-ink"
          onClick={() => onChange({ from: undefined, to: undefined })}
        >
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  )
}
