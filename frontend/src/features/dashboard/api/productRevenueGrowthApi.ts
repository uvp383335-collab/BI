import { httpClient } from '../../../shared/api/httpClient'

interface ApiEnvelope<T> {
  success: boolean
  data: T
}

export interface MonthlyRevenueGrowthPoint {
  month: string
  revenue: number
  revenueGrowthPct: number | null
}

export interface ProductRevenueGrowthProduct {
  id: string
  name: string
  months: MonthlyRevenueGrowthPoint[]
}

export interface ProductRevenueGrowthFailure {
  id: string
  name: string
  message: string
}

export interface ProductRevenueGrowthResult {
  products: ProductRevenueGrowthProduct[]
  failedProducts: ProductRevenueGrowthFailure[]
  message?: string
}

export interface QuickBooksDepartmentOption {
  id: string
  name: string
}

export interface ProductRevenueGrowthOptions {
  fromYear?: string
  department?: string
  state?: string
}

/**
 * Live, on-demand — this runs one Profit & Loss report per product/service
 * (docs/server.js §5) and can take a while for a company with many products,
 * same as the prototype's own "Load Product Revenue Growth" button.
 */
export async function getProductRevenueGrowthRequest(options: ProductRevenueGrowthOptions): Promise<ProductRevenueGrowthResult> {
  const res = await httpClient.get<ApiEnvelope<ProductRevenueGrowthResult>>('/metrics/quickbooks/product-revenue-growth', { params: options })
  return res.data.data
}

export interface ProductRevenueGrowthDetailLine {
  providerRecordId: string
  customerRecordId: string
  customerName: string | null
  /** "YYYY-MM-DD" */
  txnDate: string
  lineAmount: number
  invoiceTotalAmount: number
}

export interface ProductRevenueGrowthDetailMonth {
  /** "YYYY-MM" */
  month: string
  /** QuickBooks' own report column title for this month, e.g. "Jan 2024". */
  quickbooksColumnLabel: string
  quickbooksRevenue: number
  quickbooksRevenueGrowthPct: number | null
  /** Sum of locally-synced invoice lines for this product this month — compare against quickbooksRevenue. */
  syncedInvoiceTotal: number
}

export interface ProductRevenueGrowthDetailResult {
  productId: string
  productName: string
  months: ProductRevenueGrowthDetailMonth[]
  lines: ProductRevenueGrowthDetailLine[]
  /** Non-null when a requested filter (e.g. department) couldn't be honored by the local invoice data. */
  caveat: string | null
}

/**
 * Record-level backing data for one product's series above — re-fetches that
 * product's QuickBooks P&L revenue live (fresh, not reused from the already
 * loaded chart data) plus every locally-synced invoice line that fed it, for
 * the "export to Excel" verification button.
 */
export async function getProductRevenueGrowthDetailRequest(productId: string, productName: string, options: ProductRevenueGrowthOptions): Promise<ProductRevenueGrowthDetailResult> {
  const res = await httpClient.get<ApiEnvelope<ProductRevenueGrowthDetailResult>>('/metrics/quickbooks/product-revenue-growth/detail', {
    params: { productId, productName, ...options }
  })
  return res.data.data
}

export interface InvoiceRevenueGrowthByProductOptions {
  fromYear?: string
}

export interface InvoiceRevenueGrowthByProductResult {
  products: ProductRevenueGrowthProduct[]
}

/**
 * "Revenue growth by product," computed entirely from this org's own synced
 * QuickBooks invoice line items — never calls QuickBooks live, unlike
 * getProductRevenueGrowthRequest above (one live P&L report per product).
 * Cross-check against the live card rather than a replacement for it: no
 * department/state filters, since neither is captured on locally-synced
 * invoice/customer records.
 */
export async function getInvoiceRevenueGrowthByProductRequest(options: InvoiceRevenueGrowthByProductOptions): Promise<InvoiceRevenueGrowthByProductResult> {
  const res = await httpClient.get<ApiEnvelope<InvoiceRevenueGrowthByProductResult>>('/metrics/quickbooks/invoice-revenue-growth-by-product', { params: options })
  return res.data.data
}

export interface InvoiceRevenueGrowthByProductDetailLine {
  providerRecordId: string
  customerRecordId: string
  customerName: string | null
  /** "YYYY-MM-DD" */
  txnDate: string
  lineAmount: number
  invoiceTotalAmount: number
}

export interface InvoiceRevenueGrowthByProductDetailResult {
  productId: string
  productName: string
  months: MonthlyRevenueGrowthPoint[]
  /** Every synced invoice line behind the months above — sums to months[].revenue exactly, since both come from the same synced-invoice source. */
  lines: InvoiceRevenueGrowthByProductDetailLine[]
}

/** Record-level detail behind one product's series above — every synced invoice line that fed it, for the "export to Excel" verification button. */
export async function getInvoiceRevenueGrowthByProductDetailRequest(productId: string, productName: string, options: InvoiceRevenueGrowthByProductOptions): Promise<InvoiceRevenueGrowthByProductDetailResult> {
  const res = await httpClient.get<ApiEnvelope<InvoiceRevenueGrowthByProductDetailResult>>('/metrics/quickbooks/invoice-revenue-growth-by-product/detail', {
    params: { productId, productName, ...options }
  })
  return res.data.data
}

export async function getQuickBooksDepartmentsRequest(): Promise<QuickBooksDepartmentOption[]> {
  const res = await httpClient.get<ApiEnvelope<QuickBooksDepartmentOption[]>>('/metrics/quickbooks/departments')
  return res.data.data
}

export async function getQuickBooksCustomerStatesRequest(): Promise<string[]> {
  const res = await httpClient.get<ApiEnvelope<string[]>>('/metrics/quickbooks/customer-states')
  return res.data.data
}

export type RecurringRevenueTrendGranularity = 'monthly' | 'quarterly'

export interface RecurringRevenueTrendPoint {
  /** "YYYY-MM" — the month itself for 'monthly', the quarter's first month for 'quarterly'. */
  period: string
  recurringRevenue: number
  nonRecurringRevenue: number
  /** vs. the previous point — null on the first period or when the prior period's revenue was 0. */
  recurringGrowthPct: number | null
  nonRecurringGrowthPct: number | null
}

export interface RecurringRevenueTrendResult {
  /** False when no product has been categorized in Settings yet — `points` is then empty. */
  hasCategorizedProducts: boolean
  /** True only for the 'monthly' view — this org's invoices predate per-line product detail and need a one-time forced resync (Settings > QuickBooks > "Force full resync") before the monthly view has anything to show. */
  needsResync: boolean
  points: RecurringRevenueTrendPoint[]
}

/** Storage-backed (PLItemSnapshot for 'quarterly', invoice line items for 'monthly') — unlike getProductRevenueGrowthRequest above, this is cheap and never calls QuickBooks live. */
export async function getRecurringRevenueTrendRequest(granularity: RecurringRevenueTrendGranularity = 'quarterly'): Promise<RecurringRevenueTrendResult> {
  const res = await httpClient.get<ApiEnvelope<RecurringRevenueTrendResult>>('/metrics/quickbooks/recurring-revenue-trend', { params: { granularity } })
  return res.data.data
}

export type GAndAExpenseTrendGranularity = 'monthly' | 'quarterly' | 'yearly'

export interface GAndAExpenseTrendPoint {
  /** "YYYY-MM" (monthly/quarterly) or "YYYY" (yearly). */
  period: string
  revenue: number
  gaExpense: number
  /** null when revenue was 0 for this period. */
  gaPct: number | null
}

export interface GAndAExpenseTrendResult {
  /** False when the org hasn't picked any G&A accounts in Settings yet — `points` is then empty. */
  hasConfiguredAccounts: boolean
  points: GAndAExpenseTrendPoint[]
}

/** Storage-backed (PLSnapshot for 'quarterly', PLMonthlySnapshot for 'monthly'/'yearly') — never calls QuickBooks live. */
export async function getGAndAExpenseTrendRequest(granularity: GAndAExpenseTrendGranularity = 'quarterly'): Promise<GAndAExpenseTrendResult> {
  const res = await httpClient.get<ApiEnvelope<GAndAExpenseTrendResult>>('/metrics/quickbooks/ga-expense-trend', { params: { granularity } })
  return res.data.data
}

export interface CACTrendPoint {
  /** "YYYY-MM" of the window's first month — equal to `periodEnd` when the org's duration is 1. */
  periodStart: string
  /** "YYYY-MM" of the window's last month. */
  periodEnd: string
  expense: number
  newCustomers: number
  /** null when the window had 0 new customers. */
  cac: number | null
}

export interface CACTrendResult {
  /** False when the org hasn't picked CAC accounts AND a duration in Settings yet — `points` is then empty. */
  hasConfiguredSettings: boolean
  points: CACTrendPoint[]
}

/** Storage-backed (PLMonthlySnapshot + Invoice) — never calls QuickBooks live. No params: the window size is a Settings-configured duration, not a dashboard toggle. */
export async function getCACTrendRequest(): Promise<CACTrendResult> {
  const res = await httpClient.get<ApiEnvelope<CACTrendResult>>('/metrics/quickbooks/cac-trend')
  return res.data.data
}

export interface NewCustomersTrendPoint {
  /** "YYYY-MM" */
  month: string
  /** The "customer wise" view. */
  newCustomerCount: number
  /** Total revenue from each new customer's first invoice — the "amount wise" view. */
  newCustomerAmount: number
}

export interface NewCustomersTrendResult {
  /** False when this org has no synced invoices at all yet — `points` is then empty. */
  hasInvoices: boolean
  points: NewCustomersTrendPoint[]
}

/**
 * How many customers' first-ever invoice fell in each month — storage-backed
 * (reads Invoice directly), never calls QuickBooks live. Pass `item` (a
 * QuickBooks Item id) to narrow "new" to customers new to that specific
 * product instead of new to the business.
 */
export async function getNewCustomersTrendRequest(fromYear?: string, item?: string): Promise<NewCustomersTrendResult> {
  const res = await httpClient.get<ApiEnvelope<NewCustomersTrendResult>>('/metrics/quickbooks/new-customers-trend', { params: { fromYear, item } })
  return res.data.data
}

export interface NewCustomersDetailEntry {
  customerRecordId: string
  customerName: string | null
  /** "YYYY-MM-DD" */
  firstInvoiceDate: string
  firstAmount: number
}

export interface NewCustomersMonthDetail {
  /** "YYYY-MM" */
  month: string
  newCustomerCount: number
  newCustomerAmount: number
  entries: NewCustomersDetailEntry[]
}

export interface NewCustomersTrendDetailResult {
  hasInvoices: boolean
  months: NewCustomersMonthDetail[]
}

/** Record-level detail behind the "new customers" chart — every customer counted in each month, for the "export to Excel" verification button. */
export async function getNewCustomersTrendDetailRequest(fromYear?: string, item?: string): Promise<NewCustomersTrendDetailResult> {
  const res = await httpClient.get<ApiEnvelope<NewCustomersTrendDetailResult>>('/metrics/quickbooks/new-customers-trend/detail', { params: { fromYear, item } })
  return res.data.data
}

export type CustomerUpgradesTrendGranularity = 'monthly' | 'annually'

export interface CustomerUpgradesTrendPoint {
  /** "YYYY-MM" for 'monthly', "YYYY" for 'annually'. */
  period: string
  /** How many customers upgraded this period — the "customer wise" view. */
  upgradeCount: number
  /** Total $ increase across every upgrading customer this period — the "amount wise" view. */
  upgradeAmount: number
  /** How many customers downgraded this period — still a customer, just a lower bill than the prior period. Excludes churn. */
  downgradeCount: number
  /** Total $ decrease across every downgrading customer this period — the downgrades card's "amount wise" view. */
  downgradeAmount: number
  /** How many customers fully cancelled this period (bill dropped all the way to $0) — the churn card's "customer wise" view. */
  churnCount: number
  /** Total $ lost across every churned customer this period — the churn card's "amount wise" view. */
  churnAmount: number
  /** Sum of every existing customer's prior-period revenue (the GRR/NRR denominator) — 0 when nobody had revenue to retain that period. */
  startingRevenue: number
  /** GRR % for this product this period — null when startingRevenue is 0 (nothing to retain). */
  grrPct: number | null
  /** NRR % for this product this period — can exceed 100%. Null under the same condition as grrPct. */
  nrrPct: number | null
}

export interface CustomerUpgradesTrendResult {
  /** False when the product isn't categorized recurring with the billing frequency this granularity needs. */
  hasData: boolean
  points: CustomerUpgradesTrendPoint[]
}

/**
 * How many customers' invoiced revenue for one recurring product went up
 * from one period to the next — storage-backed, never calls QuickBooks
 * live. `item` is required (a QuickBooks Item id); `granularity` picks
 * which billing frequency that product must have: 'monthly' needs a
 * monthly-billed product, 'annually' needs a yearly-billed one. Each point
 * carries upgrade, downgrade, churn, and GRR/NRR stats together — the
 * "Customer upgrades," "Customer downgrades," "Customer churn," and
 * "Customer retention" dashboard cards all call this, each reading its own
 * part.
 */
export async function getCustomerUpgradesTrendRequest(item?: string, granularity: CustomerUpgradesTrendGranularity = 'monthly'): Promise<CustomerUpgradesTrendResult> {
  const res = await httpClient.get<ApiEnvelope<CustomerUpgradesTrendResult>>('/metrics/quickbooks/customer-upgrades-trend', { params: { item, granularity } })
  return res.data.data
}

export interface CustomerUpgradesDetailEntry {
  customerRecordId: string
  customerName: string | null
  priorRevenue: number
  currentRevenue: number
  /** currentRevenue - priorRevenue — negative for downgrade/churn. */
  delta: number
  bucket: 'upgrade' | 'downgrade' | 'churn'
}

export interface CustomerUpgradesPeriodDetail extends CustomerUpgradesTrendPoint {
  /** Every existing customer behind this period's upgrade/downgrade/churn counts — "flat" customers (current === prior) are omitted, same as the aggregate. */
  entries: CustomerUpgradesDetailEntry[]
}

export interface CustomerUpgradesTrendDetailResult {
  hasData: boolean
  periods: CustomerUpgradesPeriodDetail[]
}

/**
 * Record-level detail behind the Upgrades/Downgrades/Churn charts — every
 * existing customer's prior/current revenue and which bucket they fell
 * into each period, for the "export to Excel" verification button shared
 * by all three cards (each calls this with its own product/granularity
 * selection, same as the aggregate).
 */
export async function getCustomerUpgradesTrendDetailRequest(item?: string, granularity: CustomerUpgradesTrendGranularity = 'monthly'): Promise<CustomerUpgradesTrendDetailResult> {
  const res = await httpClient.get<ApiEnvelope<CustomerUpgradesTrendDetailResult>>('/metrics/quickbooks/customer-upgrades-trend/detail', { params: { item, granularity } })
  return res.data.data
}
