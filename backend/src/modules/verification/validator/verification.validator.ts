import { z } from 'zod'

export const verifyEmailSchema = z.object({
  token: z.string().min(1, 'Token is required')
})

export const resendVerificationSchema = z.object({
  email: z.string().email('Invalid email address')
})

export type VerifyEmailInput = z.infer<typeof verifyEmailSchema>
export type ResendVerificationInput = z.infer<typeof resendVerificationSchema>
