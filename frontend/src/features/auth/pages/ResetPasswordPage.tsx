import React from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useNavigate, useSearchParams, Link } from 'react-router-dom'
import { toast } from 'sonner'
import { AuthCard } from '../components/AuthCard'
import { FieldError, inputClass, buttonClass } from '../components/formControls'
import { resetPasswordSchema, ResetPasswordFormValues } from '../schemas/authSchemas'
import { useResetPassword } from '../hooks/useAuthMutations'

export const ResetPasswordPage: React.FC = () => {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const token = searchParams.get('token') || ''
  const resetPassword = useResetPassword()
  const {
    register,
    handleSubmit,
    formState: { errors }
  } = useForm<ResetPasswordFormValues>({ resolver: zodResolver(resetPasswordSchema) })

  const onSubmit = async (values: ResetPasswordFormValues) => {
    if (!token) {
      toast.error('Missing or invalid reset link')
      return
    }
    try {
      await resetPassword.mutateAsync({ token, password: values.password })
      toast.success('Password reset successfully. Please log in.')
      navigate('/login')
    } catch (err: any) {
      toast.error(err?.response?.data?.error?.message || 'Could not reset password')
    }
  }

  return (
    <AuthCard title="Reset password">
      {!token ? (
        <p className="text-sm text-red-600">
          Missing reset token.{' '}
          <Link to="/forgot-password" className="auth-link">
            Request a new link
          </Link>
        </p>
      ) : (
        <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
          <div>
            <label htmlFor="password" className="form-label">
              New password
            </label>
            <input
              id="password"
              className={`${inputClass} ${errors.password ? 'form-input-error' : ''}`}
              type="password"
              {...register('password')}
            />
            <FieldError message={errors.password?.message} />
          </div>
          <div>
            <label htmlFor="confirmPassword" className="form-label">
              Confirm password
            </label>
            <input
              id="confirmPassword"
              className={`${inputClass} ${errors.confirmPassword ? 'form-input-error' : ''}`}
              type="password"
              {...register('confirmPassword')}
            />
            <FieldError message={errors.confirmPassword?.message} />
          </div>
          <button type="submit" className={buttonClass} disabled={resetPassword.isPending}>
            {resetPassword.isPending && <span className="spinner" aria-hidden="true" />}
            {resetPassword.isPending ? 'Resetting…' : 'Reset password'}
          </button>
        </form>
      )}
    </AuthCard>
  )
}
