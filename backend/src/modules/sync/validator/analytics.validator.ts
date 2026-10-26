import { z } from 'zod'

export const getFunnelsQuerySchema = z
  .object({
    pipeline: z.string().min(1).optional(),
    from: z.string().date().optional(),
    to: z.string().date().optional(),
    productId: z.string().min(1).optional()
  })
  .refine((data) => !data.from || !data.to || data.from <= data.to, {
    message: '"from" must not be after "to"',
    path: ['from']
  })

export type GetFunnelsQuery = z.infer<typeof getFunnelsQuerySchema>

/** Shared by the Campaigns, Opportunities & Contacts browse endpoints (raw record lists, not the aggregated metrics). */
export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).optional()
})

export type PaginationQuery = z.infer<typeof paginationQuerySchema>
