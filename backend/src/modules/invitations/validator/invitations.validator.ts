import { z } from 'zod'

export const createInvitationSchema = z.object({
  email: z.string().email('Invalid email address'),
  role: z.enum(['admin', 'member'])
})

export const acceptInvitationSchema = z
  .object({
    password: z.string().min(8, 'Password must be at least 8 characters'),
    name: z.string().min(1).max(100).optional()
  })
  .refine((data) => !!data.password, { message: 'Password is required' })

export type CreateInvitationInput = z.infer<typeof createInvitationSchema>
export type AcceptInvitationInput = z.infer<typeof acceptInvitationSchema>
