import { z } from 'zod'

export const getMetricQuerySchema = z.object({
  period: z
    .string()
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'period must be "YYYY-MM"')
    .optional(),
  // Only the CM-04/06/08 handlers read this — they're the first metrics that
  // depend on which CRM's funnel/pipeline data to read (hubspot vs. salesforce).
  provider: z.enum(['hubspot', 'salesforce']).optional()
})

export type GetMetricQuery = z.infer<typeof getMetricQuerySchema>
