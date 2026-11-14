import React from 'react'

export interface DetailFieldSpec {
  label: string
  value: React.ReactNode | null | undefined
}

/** One label/value row in a record detail panel — matches the CRM's own two-column detail-page convention. Skips rendering entirely when the field has no value, rather than showing an empty placeholder box (this app's honest-numbers convention applied to sync gaps: only known fields are shown, not "not synced" clutter). */
export const DetailField: React.FC<DetailFieldSpec> = ({ label, value }) => {
  if (value === null || value === undefined || value === '') return null
  return (
    <div className="border-b border-line py-3 first:pt-0 last:border-0">
      <p className="text-xs font-semibold uppercase tracking-wide text-ink-3">{label}</p>
      <div className="mt-1 text-sm text-ink">{value}</div>
    </div>
  )
}

/** Two-column field grid — left/right lists rendered as independent stacks (like Salesforce's own detail layout), not a single interleaved grid, so a missing field on one side doesn't misalign the other. */
export const DetailFieldColumns: React.FC<{ left: DetailFieldSpec[]; right: DetailFieldSpec[] }> = ({ left, right }) => (
  <div className="grid grid-cols-1 gap-x-10 sm:grid-cols-2">
    <div>
      {left.map((field) => (
        <DetailField key={field.label} {...field} />
      ))}
    </div>
    <div>
      {right.map((field) => (
        <DetailField key={field.label} {...field} />
      ))}
    </div>
  </div>
)
