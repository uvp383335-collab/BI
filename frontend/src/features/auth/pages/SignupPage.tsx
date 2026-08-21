import React from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Link, useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { AuthCard } from '../components/AuthCard'
import { FieldError, inputClass, buttonClass } from '../components/formControls'
import { signupSchema, SignupFormValues } from '../schemas/authSchemas'
import { useSignup } from '../hooks/useAuthMutations'

export const SignupPage: React.FC = () => {
  const navigate = useNavigate()
  const signup = useSignup()
  const {
    register,
    handleSubmit,
    formState: { errors }
  } = useForm<SignupFormValues>({ resolver: zodResolver(signupSchema) })

  const onSubmit = async (values: SignupFormValues) => {
    try {
      await signup.mutateAsync(values)
      toast.success('Account created! Check your email to verify your address.')
      navigate('/login')
    } catch (err: any) {
      toast.error(err?.response?.data?.error?.message || 'Signup failed')
    }
  }

  return (
    <AuthCard title="Create your account" subtitle="Set up your organization and admin account">
      <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
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
      <p className="text-sm text-gray-500 mt-4 text-center">
        Already have an account?{' '}
        <Link to="/login" className="auth-link">
          Log in
        </Link>
      </p>
    </AuthCard>
  )
}
