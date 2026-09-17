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
    .optional()
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
