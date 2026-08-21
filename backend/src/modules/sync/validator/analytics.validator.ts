import { z } from 'zod'

export const getFunnelsQuerySchema = z
  .object({
    pipeline: z.string().min(1).optional(),
    from: z.string().date().optional(),
    to: z.string().date().optional()
  })
  .refine((data) => !data.from || !data.to || data.from <= data.to, {
    message: '"from" must not be after "to"',
    path: ['from']
  })

export type GetFunnelsQuery = z.infer<typeof getFunnelsQuerySchema>
