import { QuickBooksReport, QuickBooksReportRow } from '../../integrations/service/quickbooks.service'

export interface PLLineItem {
  account: string
  /** column title ("Total", or a Class name when summarized by Class) -> amount */
  amounts: Record<string, number>
}

export interface ParsedProfitAndLoss {
  /** Amount column titles, in report order (excludes the leading account-name column). "Total" for a single-column report. */
  columns: string[]
  income: PLLineItem[]
  cogs: PLLineItem[]
  expenses: PLLineItem[]
  otherExpenses: PLLineItem[]
  /** QuickBooks' own section subtotals (Income, COGS, GrossProfit, Expenses, NetOperatingIncome, ...) -> column -> amount. */
  sectionTotals: Record<string, Record<string, number>>
}

/**
 * Parses QuickBooks' ProfitAndLoss report JSON (a recursive Rows/Summary
 * tree keyed by `group`) into flat per-section line-item lists. QuickBooks
 * already tells us which rows are Income vs. COGS vs. Expenses via each
 * section's `group` — no guessing needed there. What still needs a
 * heuristic (see accountClassification.ts) is which *individual* expense
 * accounts count as sales & marketing vs. G&A vs. D&A, since QuickBooks'
 * own report doesn't sub-split "Expenses" that way.
 */
export function parseProfitAndLoss(report: QuickBooksReport): ParsedProfitAndLoss {
  const columns = report.Columns.Column.slice(1).map((c) => c.ColTitle || 'Total')

  const income: PLLineItem[] = []
  const cogs: PLLineItem[] = []
  const expenses: PLLineItem[] = []
  const otherExpenses: PLLineItem[] = []
  const sectionTotals: Record<string, Record<string, number>> = {}

  function parseAmounts(colData: { value: string }[]): Record<string, number> {
    const amounts: Record<string, number> = {}
    columns.forEach((col, i) => {
      amounts[col] = parseFloat(colData[i + 1]?.value || '0') || 0
    })
    return amounts
  }

  function bucketFor(section: string | null): PLLineItem[] | null {
    if (section === 'Income') return income
    if (section === 'COGS') return cogs
    if (section === 'Expenses') return expenses
    if (section === 'OtherExpenses') return otherExpenses
    return null
  }

  function walk(rows: QuickBooksReportRow[] | undefined, section: string | null) {
    if (!rows) return
    for (const row of rows) {
      const group = row.group ?? section
      if (row.Summary?.ColData && group) {
        sectionTotals[group] = parseAmounts(row.Summary.ColData)
      }
      if (row.Rows?.Row) {
        walk(row.Rows.Row, group)
      } else if (row.ColData && row.ColData.length > 1) {
        const bucket = bucketFor(section)
        if (bucket) {
          bucket.push({ account: row.ColData[0]?.value ?? 'Unknown', amounts: parseAmounts(row.ColData) })
        }
      }
    }
  }

  walk(report.Rows.Row, null)

  return { columns, income, cogs, expenses, otherExpenses, sectionTotals }
}

export type ExpenseCategory = 'sales_marketing' | 'g_and_a' | 'd_and_a' | 'other'

// A one-time, name-keyword classification — the metrics guide calls for a
// "one-time reviewable mapping per company" (versioned, editable). This is
// the MVP default that mapping would start from; there's no per-org
// override store yet (tracked as gap G-13 in the progress doc). Order
// matters: D&A and sales-and-marketing keywords are checked before the
// broader G&A list, since an account like "Sales & Marketing - Salaries"
// would otherwise match G&A's "salaries" keyword first.
const D_AND_A_KEYWORDS = ['depreciation', 'amortization']
const SALES_MARKETING_KEYWORDS = ['sales & marketing', 'sales and marketing', 's&m', 'advertising', 'marketing']
const G_AND_A_KEYWORDS = [
  'g&a',
  'general & administrative',
  'general and administrative',
  'rent',
  'legal',
  'payroll',
  'salaries',
  'office',
  'software & tools',
  'insurance',
  'utilities',
  'dues'
]

export function classifyExpenseAccount(accountName: string): ExpenseCategory {
  const name = accountName.toLowerCase()
  if (D_AND_A_KEYWORDS.some((k) => name.includes(k))) return 'd_and_a'
  if (SALES_MARKETING_KEYWORDS.some((k) => name.includes(k))) return 'sales_marketing'
  if (G_AND_A_KEYWORDS.some((k) => name.includes(k))) return 'g_and_a'
  return 'other'
}

const RECURRING_INCOME_KEYWORDS = ['subscription', 'recurring', 'maintenance', 'saas']

export function isRecurringIncomeAccount(accountName: string): boolean {
  const name = accountName.toLowerCase()
  return RECURRING_INCOME_KEYWORDS.some((k) => name.includes(k))
}

/** Sums a bucket's amounts for one column, e.g. total COGS in the "Total" column, or in one Class column. */
export function sumColumn(items: PLLineItem[], column: string): number {
  return items.reduce((sum, item) => sum + (item.amounts[column] ?? 0), 0)
}

/** D&A can sit inside COGS (the metrics guide explicitly warns not to miss this) as well as Expenses/OtherExpenses — scan every section. */
export function sumDepreciationAndAmortization(pl: ParsedProfitAndLoss, column: string): number {
  const allItems = [...pl.cogs, ...pl.expenses, ...pl.otherExpenses]
  return allItems.filter((item) => classifyExpenseAccount(item.account) === 'd_and_a').reduce((sum, item) => sum + (item.amounts[column] ?? 0), 0)
}

export function sumExpensesByCategory(pl: ParsedProfitAndLoss, category: ExpenseCategory, column: string): number {
  const allItems = [...pl.expenses, ...pl.otherExpenses]
  return allItems.filter((item) => classifyExpenseAccount(item.account) === category).reduce((sum, item) => sum + (item.amounts[column] ?? 0), 0)
}

export function sumRecurringIncome(pl: ParsedProfitAndLoss, column: string): number {
  return pl.income.filter((item) => isRecurringIncomeAccount(item.account)).reduce((sum, item) => sum + (item.amounts[column] ?? 0), 0)
}
