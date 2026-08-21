import React, { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useSearchParams, Link } from 'react-router-dom'
import { AuthCard } from '../components/AuthCard'
import { FieldError, inputClass, buttonClass } from '../components/formControls'
import { Banner } from '../../../shared/components/Banner'
import { resetPasswordSchema, ResetPasswordFormValues } from '../schemas/authSchemas'
import { useResetPassword } from '../hooks/useAuthMutations'

export const ResetPasswordPage: React.FC = () => {
  const [searchParams] = useSearchParams()
  const token = searchParams.get('token') || ''
  const resetPassword = useResetPassword()
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const {
    register,
    handleSubmit,
    formState: { errors }
  } = useForm<ResetPasswordFormValues>({ resolver: zodResolver(resetPasswordSchema) })

  const onSubmit = async (values: ResetPasswordFormValues) => {
    setError(null)
    try {
      await resetPassword.mutateAsync({ token, password: values.password })
      setDone(true)
    } catch (err: any) {
      setError(err?.response?.data?.error?.message || 'Could not reset password')
    }
  }

  if (done) {
    return (
      <AuthCard title="Password reset">
        <p className="text-sm text-success">Password reset successfully. Please log in.</p>
        <Link to="/login" className="auth-link mt-4 inline-block text-sm">
          Continue to log in
        </Link>
      </AuthCard>
    )
  }

  return (
    <AuthCard title="Reset password">
      {!token ? (
        <p className="text-sm text-danger">
          Missing reset token.{' '}
          <Link to="/forgot-password" className="auth-link">
            Request a new link
          </Link>
        </p>
      ) : (
        <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
          {error && <Banner variant="error" message={error} onDismiss={() => setError(null)} />}
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
