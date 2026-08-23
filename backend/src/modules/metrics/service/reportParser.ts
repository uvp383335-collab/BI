import { QuickBooksReport, QuickBooksReportRow } from '../../integrations/service/quickbooks.service'

/**
 * Parsers for the Balance Sheet / Cash Flow / Aging / Inventory reports used
 * by CB-05, CB-07, CB-10 (Phase 3). Unlike plParser.ts (which needs full
 * per-account line items for the expense-classification heuristic), these
 * metrics only need each report's own pre-computed section or grand total —
 * so these are lighter-weight extractors, not full line-item parsers.
 *
 * Caveat, tracked as gap G-18 in the progress doc: written against
 * documented QuickBooks report shapes, not verified against a live sandbox
 * response (no connected org existed this session to test against). The
 * section-name assumptions (`BankAccounts`, `OperatingActivities`,
 * `InvestingActivities`) and the "row whose label contains TOTAL" heuristic
 * for the flat reports are the parts most likely to need adjustment once
 * tested live.
 */

/**
 * Walks a grouped/sectioned report (Balance Sheet, Cash Flow — the same
 * recursive Rows/Summary/`group` tree shape as ProfitAndLoss) and collects
 * each section's own Summary subtotal, keyed by QuickBooks' own group name.
 * Doesn't bucket individual line items — callers only need e.g.
 * `sectionTotals.BankAccounts.Total`.
 */
export function extractSectionTotals(report: QuickBooksReport): Record<string, Record<string, number>> {
  const columns = report.Columns.Column.slice(1).map((c) => c.ColTitle || 'Total')
  const sectionTotals: Record<string, Record<string, number>> = {}

  function parseAmounts(colData: { value: string }[]): Record<string, number> {
    const amounts: Record<string, number> = {}
    columns.forEach((col, i) => {
      amounts[col] = parseFloat(colData[i + 1]?.value || '0') || 0
    })
    return amounts
  }

  function walk(rows: QuickBooksReportRow[] | undefined) {
    if (!rows) return
    for (const row of rows) {
      if (row.Summary?.ColData && row.group) {
        sectionTotals[row.group] = parseAmounts(row.Summary.ColData)
      }
      if (row.Rows?.Row) walk(row.Rows.Row)
    }
  }

  walk(report.Rows.Row)
  return sectionTotals
}

/**
 * Extracts a flat report's (AgedReceivables, AgedPayables,
 * InventoryValuationSummary — one row per customer/vendor/item, no nested
 * sections) grand total. Finds the row whose first column reads "TOTAL"
 * (QuickBooks' own convention for these reports' final row) and reads a
 * given column off it — the last column by default (these reports always
 * end in a running-total column), or a title-matched column when the
 * default position isn't reliable (e.g. Inventory Valuation's "Asset Value"
 * column isn't always last).
 */
export function extractFlatReportGrandTotal(report: QuickBooksReport, columnTitleMatch?: string): number | null {
  const columnTitles = report.Columns.Column.map((c) => c.ColTitle)
  let columnIndex = columnTitles.length - 1
  if (columnTitleMatch) {
    const idx = columnTitles.findIndex((title) => title?.toLowerCase().includes(columnTitleMatch.toLowerCase()))
    if (idx >= 0) columnIndex = idx
  }

  function findGrandTotalRow(rows: QuickBooksReportRow[] | undefined): QuickBooksReportRow['ColData'] | null {
    if (!rows) return null
    for (const row of rows) {
      if (row.ColData?.[0]?.value?.toUpperCase().includes('TOTAL')) return row.ColData
      if (row.Summary?.ColData?.[0]?.value?.toUpperCase().includes('TOTAL')) return row.Summary.ColData
      if (row.Rows?.Row) {
        const found = findGrandTotalRow(row.Rows.Row)
        if (found) return found
      }
    }
    return null
  }

  const totalRowData = findGrandTotalRow(report.Rows.Row)
  const raw = totalRowData?.[columnIndex]?.value
  if (raw === undefined) return null
  const value = parseFloat(raw)
  return Number.isNaN(value) ? null : value
}
