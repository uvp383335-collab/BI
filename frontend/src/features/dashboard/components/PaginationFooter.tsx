import React from 'react'

interface PaginationFooterProps {
  page: number
  pageSize: number
  total: number
  onPageChange: (page: number) => void
}

/** Prev/next pager shared by the raw record tables (Opportunities, Campaigns, Contacts) — small collections don't need jump-to-page. */
export const PaginationFooter: React.FC<PaginationFooterProps> = ({ page, pageSize, total, onPageChange }) => {
  if (total === 0) return null
  const totalPages = Math.max(1, Math.ceil(total / pageSize))

  return (
    <div className="mt-4 flex items-center justify-between text-sm text-ink-2">
      <span>
        Page {page} of {totalPages} ({total.toLocaleString()} total)
      </span>
      <div className="flex gap-2">
        <button type="button" className="btn-outline-dark px-3 py-1" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>
          Previous
        </button>
        <button type="button" className="btn-outline-dark px-3 py-1" disabled={page >= totalPages} onClick={() => onPageChange(page + 1)}>
          Next
        </button>
      </div>
    </div>
  )
}
