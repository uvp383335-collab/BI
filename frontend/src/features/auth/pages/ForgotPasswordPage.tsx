import React, { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Link } from 'react-router-dom'
import { AuthCard } from '../components/AuthCard'
import { FieldError, inputClass, buttonClass } from '../components/formControls'
import { Banner } from '../../../shared/components/Banner'
import { forgotPasswordSchema, ForgotPasswordFormValues } from '../schemas/authSchemas'
import { useForgotPassword } from '../hooks/useAuthMutations'

export const ForgotPasswordPage: React.FC = () => {
  const forgotPassword = useForgotPassword()
  const [banner, setBanner] = useState<{ variant: 'success' | 'error'; message: string } | null>(null)
  const {
    register,
    handleSubmit,
    formState: { errors }
  } = useForm<ForgotPasswordFormValues>({ resolver: zodResolver(forgotPasswordSchema) })

  const onSubmit = async (values: ForgotPasswordFormValues) => {
    try {
      await forgotPassword.mutateAsync(values.email)
      setBanner({ variant: 'success', message: 'If that email is registered, a reset link has been sent.' })
    } catch (err: any) {
      setBanner({ variant: 'error', message: err?.response?.data?.error?.message || 'Something went wrong' })
    }
  }

  return (
    <AuthCard title="Forgot password" subtitle="We'll email you a link to reset it">
      <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
        {banner && <Banner variant={banner.variant} message={banner.message} onDismiss={() => setBanner(null)} />}
        <div>
          <label htmlFor="email" className="form-label">
            Email
          </label>
          <input
            id="email"
            className={`${inputClass} ${errors.email ? 'form-input-error' : ''}`}
            type="email"
            {...register('email')}
          />
          <FieldError message={errors.email?.message} />
        </div>
        <button type="submit" className={buttonClass} disabled={forgotPassword.isPending}>
          {forgotPassword.isPending && <span className="spinner" aria-hidden="true" />}
          {forgotPassword.isPending ? 'Sending…' : 'Send reset link'}
        </button>
      </form>
      <p className="text-sm text-ink-3 mt-4 text-center">
        <Link to="/login" className="auth-link">
          Back to log in
        </Link>
      </p>
    </AuthCard>
  )
}
