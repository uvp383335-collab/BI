import { z } from 'zod'
import { MembershipRole } from '../../../entities/user/types'

const passwordRules = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .regex(/[A-Z]/, 'Must contain an uppercase letter')
  .regex(/[a-z]/, 'Must contain a lowercase letter')
  .regex(/[0-9]/, 'Must contain a number')

export const signupSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  email: z.string().email('Invalid email address'),
  password: passwordRules,
  organizationName: z.string().min(1, 'Organization name is required')
})
export type SignupFormValues = z.infer<typeof signupSchema>

export const loginSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(1, 'Password is required')
})
export type LoginFormValues = z.infer<typeof loginSchema>

export const forgotPasswordSchema = z.object({
  email: z.string().email('Invalid email address')
})
export type ForgotPasswordFormValues = z.infer<typeof forgotPasswordSchema>

export const resetPasswordSchema = z
  .object({
    password: passwordRules,
    confirmPassword: z.string()
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword']
  })
export type ResetPasswordFormValues = z.infer<typeof resetPasswordSchema>

export const createInvitationSchema = z.object({
  email: z.string().email('Invalid email address'),
  role: z.enum(['owner', 'admin', 'member'] as const)
})
export type CreateInvitationFormValues = z.infer<typeof createInvitationSchema>

export const acceptInvitationSchema = z.object({
  password: z.string().min(8, 'Password must be at least 8 characters'),
  name: z.string().optional()
})
export type AcceptInvitationFormValues = z.infer<typeof acceptInvitationSchema>
