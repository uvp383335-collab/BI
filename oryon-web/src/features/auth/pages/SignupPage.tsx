import React, { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Link } from 'react-router-dom'
import { AuthCard } from '../components/AuthCard'
import { FieldError, inputClass, buttonClass } from '../components/formControls'
import { Banner } from '../../../shared/components/Banner'
import { signupSchema, SignupFormValues } from '../schemas/authSchemas'
import { useSignup } from '../hooks/useAuthMutations'

export const SignupPage: React.FC = () => {
  const signup = useSignup()
  const [error, setError] = useState<string | null>(null)
  const [created, setCreated] = useState(false)
  const {
    register,
    handleSubmit,
    formState: { errors }
  } = useForm<SignupFormValues>({ resolver: zodResolver(signupSchema) })

  const onSubmit = async (values: SignupFormValues) => {
    setError(null)
    try {
      await signup.mutateAsync(values)
      setCreated(true)
    } catch (err: any) {
      setError(err?.response?.data?.error?.message || 'Signup failed')
    }
  }

  if (created) {
    return (
      <AuthCard title="Check your email">
        <p className="text-sm text-success">Account created! Check your email to verify your address.</p>
        <Link to="/login" className="auth-link mt-4 inline-block text-sm">
          Continue to log in
        </Link>
      </AuthCard>
    )
  }

  return (
    <AuthCard title="Create your account" subtitle="Set up your organization and admin account">
      <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
        {error && <Banner variant="error" message={error} onDismiss={() => setError(null)} />}
        <div>
          <label htmlFor="name" className="form-label">
            Full name
          </label>
          <input
            id="name"
            className={`${inputClass} ${errors.name ? 'form-input-error' : ''}`}
            {...register('name')}
          />
          <FieldError message={errors.name?.message} />
        </div>
        <div>
          <label htmlFor="organizationName" className="form-label">
            Organization name
          </label>
          <input
            id="organizationName"
            className={`${inputClass} ${errors.organizationName ? 'form-input-error' : ''}`}
            {...register('organizationName')}
          />
          <FieldError message={errors.organizationName?.message} />
        </div>
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
        <div>
          <label htmlFor="password" className="form-label">
            Password
          </label>
          <input
            id="password"
            className={`${inputClass} ${errors.password ? 'form-input-error' : ''}`}
            type="password"
            {...register('password')}
          />
          <FieldError message={errors.password?.message} />
        </div>
        <button type="submit" className={buttonClass} disabled={signup.isPending}>
          {signup.isPending && <span className="spinner" aria-hidden="true" />}
          {signup.isPending ? 'Creating account…' : 'Sign up'}
        </button>
      </form>
      <p className="text-sm text-ink-3 mt-4 text-center">
        Already have an account?{' '}
        <Link to="/login" className="auth-link">
          Log in
        </Link>
      </p>
    </AuthCard>
  )
}
