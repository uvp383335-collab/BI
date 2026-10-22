import { z } from 'zod'

const PROVIDER_RECORD_ID_REGEX = /^[A-Za-z0-9_-]{1,64}$/

const productCategoryUpdateSchema = z
  .object({
    providerRecordId: z.string().regex(PROVIDER_RECORD_ID_REGEX),
    category: z.enum(['recurring', 'non_recurring', 'not_sure']),
    billingFrequency: z.enum(['monthly', 'quarterly', 'yearly']).optional()
  })
  .refine((data) => data.category === 'recurring' || data.billingFrequency === undefined, {
    message: 'billingFrequency is only allowed when category is "recurring"',
    path: ['billingFrequency']
  })

export const updateProductCategoriesSchema = z.object({
  updates: z.array(productCategoryUpdateSchema).min(1).max(500)
})

export type UpdateProductCategoriesBody = z.infer<typeof updateProductCategoriesSchema>
