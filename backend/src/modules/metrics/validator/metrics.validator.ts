import { z } from 'zod'

export const getMetricQuerySchema = z.object({
  period: z
    .string()
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'period must be "YYYY-MM"')
    .optional(),
  // Only the CM-04/06/08 handlers read this — they're the first metrics that
  // depend on which CRM's funnel/pipeline data to read (hubspot vs. salesforce).
  provider: z.enum(['hubspot', 'salesforce']).optional(),
  // Only VC-04/09/10/13 (and their /trend/:id counterparts) read this — a QuickBooks
  // Item id to filter the P&L trend cards to a single product/service.
  item: z.string().optional(),
  // Only /trend/:id reads this — how far back the trend series starts (mirrors
  // docs/server.js's "From year" control). Defaults to the current year when omitted.
  fromYear: z
    .string()
    .regex(/^\d{4}$/, 'fromYear must be "YYYY"')
    .optional(),
  // Only VC-13 (Revenue Growth) reads this — billing state filter for revenue metrics.
  state: z.string().optional(),
  // Only VC-13 (Revenue Growth) reads this — view mode for displaying percentage vs. absolute revenue.
  viewMode: z.enum(['percentage', 'absolute']).optional()
})

export type GetMetricQuery = z.infer<typeof getMetricQuerySchema>

// GET /metrics/quickbooks/product-revenue-growth — the live "Revenue growth by product" section
// (docs/server.js §5). Separate from getMetricQuerySchema: this endpoint doesn't take period/provider.
export const getProductRevenueGrowthQuerySchema = z.object({
  fromYear: z
    .string()
    .regex(/^\d{4}$/, 'fromYear must be "YYYY"')
    .optional(),
  department: z.string().optional(),
  state: z.string().optional()
})

export type GetProductRevenueGrowthQuery = z.infer<typeof getProductRevenueGrowthQuerySchema>

// GET /metrics/quickbooks/product-revenue-growth/detail — record-level backing data (QuickBooks'
// live per-product P&L revenue plus the matching locally-synced invoice lines) behind one product's
// series in the chart above, for the "export to Excel" verification button. Takes the same
// fromYear/department/state filters as the aggregate, plus which product to drill into.
export const getProductRevenueGrowthDetailQuerySchema = z.object({
  productId: z.string().min(1, 'productId is required'),
  // The product's display name, already known client-side from the aggregate response — passed
  // through rather than re-fetched so this endpoint doesn't need its own QuickBooks Items call.
  productName: z.string().min(1, 'productName is required'),
  fromYear: z
    .string()
    .regex(/^\d{4}$/, 'fromYear must be "YYYY"')
    .optional(),
  department: z.string().optional(),
  state: z.string().optional()
})

export type GetProductRevenueGrowthDetailQuery = z.infer<typeof getProductRevenueGrowthDetailQuerySchema>

// GET /metrics/quickbooks/invoice-revenue-growth-by-product — "Revenue growth by product" computed
// entirely from synced Invoice line items instead of a live QuickBooks P&L report per product.
// No department/state filters: neither is captured on locally-synced Invoice/Customer records.
export const getInvoiceRevenueGrowthByProductQuerySchema = z.object({
  fromYear: z
    .string()
    .regex(/^\d{4}$/, 'fromYear must be "YYYY"')
    .optional()
})

export type GetInvoiceRevenueGrowthByProductQuery = z.infer<typeof getInvoiceRevenueGrowthByProductQuerySchema>

// GET /metrics/quickbooks/invoice-revenue-growth-by-product/detail — record-level backing data (every
// synced invoice line) behind one product's series in the chart above, for the "export to Excel"
// verification button. Same fromYear filter as the aggregate, plus which product to drill into.
export const getInvoiceRevenueGrowthByProductDetailQuerySchema = z.object({
  productId: z.string().min(1, 'productId is required'),
  // The product's display name, already known client-side from the aggregate response — passed
  // through rather than re-fetched so this endpoint doesn't need its own product lookup.
  productName: z.string().min(1, 'productName is required'),
  fromYear: z
    .string()
    .regex(/^\d{4}$/, 'fromYear must be "YYYY"')
    .optional()
})

export type GetInvoiceRevenueGrowthByProductDetailQuery = z.infer<typeof getInvoiceRevenueGrowthByProductDetailQuerySchema>

// GET /metrics/quickbooks/recurring-revenue-trend — the dashboard's recurring-vs-non-recurring
// revenue bar chart. `granularity` toggles between the trailing 6 quarters (default) and the
// trailing 18 months, both covering the same window.
export const getRecurringRevenueTrendQuerySchema = z.object({
  granularity: z.enum(['monthly', 'quarterly']).optional()
})

export type GetRecurringRevenueTrendQuery = z.infer<typeof getRecurringRevenueTrendQuerySchema>

// GET /metrics/quickbooks/ga-expense-trend — the dashboard's "G&A % of Revenue" bar chart.
// `granularity` toggles between the trailing 6 quarters (default), the trailing 18 months, and
// up to 3 trailing 12-month chunks.
export const getGAndAExpenseTrendQuerySchema = z.object({
  granularity: z.enum(['monthly', 'quarterly', 'yearly']).optional()
})

export type GetGAndAExpenseTrendQuery = z.infer<typeof getGAndAExpenseTrendQuerySchema>

// GET /metrics/quickbooks/new-customers-trend — the dashboard's "new customers" bar chart.
export const getNewCustomersTrendQuerySchema = z.object({
  fromYear: z
    .string()
    .regex(/^\d{4}$/, 'fromYear must be "YYYY"')
    .optional(),
  // A QuickBooks Item id — narrows "new" to customers new to that specific product.
  item: z.string().optional()
})

export type GetNewCustomersTrendQuery = z.infer<typeof getNewCustomersTrendQuerySchema>

// GET /metrics/quickbooks/customer-upgrades-trend — the dashboard's "customer upgrades" bar chart.
export const getCustomerUpgradesTrendQuerySchema = z.object({
  // A QuickBooks Item id — required to compute anything (upgrades only make sense for one product at a time).
  item: z.string().optional(),
  granularity: z.enum(['monthly', 'annually']).optional()
})

export type GetCustomerUpgradesTrendQuery = z.infer<typeof getCustomerUpgradesTrendQuerySchema>

// GET /metrics/qualified-pipeline-trend — the dashboard's "Qualified Pipeline Created vs. Target"
// chart. Deals are hubspot/salesforce-scoped, so unlike the QuickBooks trend endpoints above this
// one takes `provider`; `fromMonth`/`toMonth` default to the trailing 12 months.
export const getQualifiedPipelineTrendQuerySchema = z.object({
  provider: z.enum(['hubspot', 'salesforce']).optional(),
  fromMonth: z
    .string()
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'fromMonth must be "YYYY-MM"')
    .optional(),
  toMonth: z
    .string()
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'toMonth must be "YYYY-MM"')
    .optional()
})

export type GetQualifiedPipelineTrendQuery = z.infer<typeof getQualifiedPipelineTrendQuerySchema>

// GET /metrics/lead-to-mql-trend — the dashboard's "Lead -> MQL Conversion Rate" trend chart.
// `granularity` picks the cohort period (defaults to quarterly); `from`/`to` accept any "YYYY-MM"
// inside the desired starting/ending period and default to a trailing window sized to the granularity.
export const getLeadToMqlTrendQuerySchema = z.object({
  provider: z.enum(['hubspot', 'salesforce']).optional(),
  granularity: z.enum(['monthly', 'quarterly', 'yearly']).optional(),
  from: z
    .string()
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'from must be "YYYY-MM"')
    .optional(),
  to: z
    .string()
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'to must be "YYYY-MM"')
    .optional()
})

export type GetLeadToMqlTrendQuery = z.infer<typeof getLeadToMqlTrendQuerySchema>

// GET /metrics/mql-to-sql-trend — the dashboard's "MQL -> SQL Conversion Rate" trend chart.
// Same shape as lead-to-mql-trend above, one stage transition over.
export const getMqlToSqlTrendQuerySchema = getLeadToMqlTrendQuerySchema

export type GetMqlToSqlTrendQuery = z.infer<typeof getMqlToSqlTrendQuerySchema>
