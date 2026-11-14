import { z } from 'zod'

/** View state every dashboard read takes (oryon-web contract). `window`/filters are accepted but not applied yet. */
export const dashboardQuerySchema = z.object({
  asOf: z
    .string()
    .regex(/^\d{4}-((0[1-9]|1[0-2])|Q[1-4])$/, 'asOf must be "YYYY-MM" or "YYYY-Qn"')
    .optional(),
  window: z.enum(['P', 'TTM']).optional(),
  span: z.enum(['4', '8', '12']).optional(),
  n: z.string().regex(/^\d{1,2}$/).optional(),
  compareOn: z.enum(['revenue', 'grossProfit', 'grossMargin', 'growth', 'mix']).optional(),
  breakdown: z.string().optional(),
  breakdownBy: z.string().optional(),
  region: z.string().optional(),
  segment: z.string().optional(),
  product: z.string().optional()
})

export type DashboardQueryInput = z.infer<typeof dashboardQuerySchema>

export const familyParamsSchema = z.object({ family: z.enum(['VC', 'CB', 'CM']) })
export const metricParamsSchema = z.object({ metricId: z.string().regex(/^(VC|CB|CM)-\d{2}$/) })
