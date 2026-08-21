import React, { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { AuthCard } from '../components/AuthCard'
import { FieldError, inputClass, buttonClass } from '../components/formControls'
import { Banner } from '../../../shared/components/Banner'
import { loginSchema, LoginFormValues } from '../schemas/authSchemas'
import { useLogin, useSelectOrg } from '../hooks/useAuthMutations'
import { useAuthContext } from '../../../shared/context/AuthContext'
import { OrganizationSummary } from '../api/authApi'

export const LoginPage: React.FC = () => {
  const navigate = useNavigate()
  const login = useLogin()
  const selectOrg = useSelectOrg()
  const { setSession, isAuthenticated } = useAuthContext()
  const [orgChoice, setOrgChoice] = useState<{ pendingToken: string; organizations: OrganizationSummary[] } | null>(
    null
  )
  const [error, setError] = useState<string | null>(null)

  const {
    register,
    handleSubmit,
    formState: { errors }
  } = useForm<LoginFormValues>({ resolver: zodResolver(loginSchema) })

  const onSubmit = async (values: LoginFormValues) => {
    setError(null)
    try {
      const result = await login.mutateAsync(values)
      if (result.requiresOrgSelection && result.pendingToken && result.organizations) {
        setOrgChoice({ pendingToken: result.pendingToken, organizations: result.organizations })
        return
      }
      if (result.accessToken && result.organization) {
        setSession(result.accessToken, result.organization)
        navigate('/')
      }
    } catch (err: any) {
      setError(err?.response?.data?.error?.message || 'Login failed')
    }
  }

  const onSelectOrg = async (orgId: string) => {
    if (!orgChoice) return
    setError(null)
    try {
      const result = await selectOrg.mutateAsync({ orgId, pendingToken: orgChoice.pendingToken })
      setSession(result.accessToken, result.organization)
      navigate('/')
    } catch (err: any) {
      setError(err?.response?.data?.error?.message || 'Could not select organization')
    }
  }

  if (isAuthenticated) {
    return <Navigate to="/" replace />
  }

  if (orgChoice) {
    return (
      <AuthCard title="Choose an organization" subtitle="You belong to more than one organization">
        {error && <Banner variant="error" message={error} onDismiss={() => setError(null)} className="mb-4" />}
        <div className="space-y-2.5">
          {orgChoice.organizations.map((org) => (
            <button
              key={org.id}
              onClick={() => onSelectOrg(org.id)}
              disabled={selectOrg.isPending}
              className="btn-outline"
            >
              <div className="font-medium text-ink">{org.name}</div>
              <div className="text-xs text-ink-3 capitalize">{org.role}</div>
            </button>
          ))}
        </div>
      </AuthCard>
    )
  }

  return (
    <AuthCard title="Log in" subtitle="Welcome back">
      <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
        {error && <Banner variant="error" message={error} onDismiss={() => setError(null)} />}
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
        <button type="submit" className={buttonClass} disabled={login.isPending}>
          {login.isPending && <span className="spinner" aria-hidden="true" />}
          {login.isPending ? 'Logging in…' : 'Log in'}
        </button>
      </form>
      <div className="flex justify-between text-sm mt-4">
        <Link to="/forgot-password" className="auth-link">
          Forgot password?
        </Link>
        <Link to="/signup" className="auth-link">
          Create an account
        </Link>
      </div>
    </AuthCard>
  )
}
