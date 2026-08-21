import React, { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useSearchParams, Link } from 'react-router-dom'
import { AuthCard } from '../components/AuthCard'
import { FieldError, inputClass, buttonClass } from '../components/formControls'
import { Banner } from '../../../shared/components/Banner'
import { acceptInvitationSchema, AcceptInvitationFormValues } from '../schemas/authSchemas'
import { usePreviewInvitation, useAcceptInvitation } from '../hooks/useAuthMutations'

export const AcceptInvitationPage: React.FC = () => {
  const [searchParams] = useSearchParams()
  const token = searchParams.get('token') || ''
  const previewInvitation = usePreviewInvitation()
  const acceptInvitation = useAcceptInvitation()
  const [preview, setPreview] = useState<{
    email: string
    organizationName: string
    hasExistingAccount: boolean
  } | null>(null)
  const [previewError, setPreviewError] = useState(false)
  const [accepted, setAccepted] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const {
    register,
    handleSubmit,
    formState: { errors }
  } = useForm<AcceptInvitationFormValues>({ resolver: zodResolver(acceptInvitationSchema) })

  useEffect(() => {
    if (!token) {
      setPreviewError(true)
      return
    }
    previewInvitation.mutate(token, {
      onSuccess: (data) => setPreview(data),
      onError: () => setPreviewError(true)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token])

  const onSubmit = async (values: AcceptInvitationFormValues) => {
    setError(null)
    try {
      await acceptInvitation.mutateAsync({ token, password: values.password, name: values.name })
      setAccepted(true)
    } catch (err: any) {
      setError(err?.response?.data?.error?.message || 'Could not accept invitation')
    }
  }

  if (accepted) {
    return (
      <AuthCard title="Invitation accepted">
        <p className="text-sm text-success">You're in! Please log in to continue.</p>
        <Link to="/login" className="auth-link mt-4 inline-block text-sm">
          Continue to log in
        </Link>
      </AuthCard>
    )
  }

  if (previewError) {
    return (
      <AuthCard title="Invitation">
        <p className="text-sm text-danger">
          This invitation link is invalid or has expired.{' '}
          <Link to="/login" className="auth-link">
            Back to log in
          </Link>
        </p>
      </AuthCard>
    )
  }

  if (!preview) {
    return (
      <AuthCard title="Invitation">
        <p className="text-sm text-ink-2">Loading invitation…</p>
      </AuthCard>
    )
  }

  return (
    <AuthCard
      title={`Join ${preview.organizationName}`}
      subtitle={
        preview.hasExistingAccount
          ? `Confirm your password for ${preview.email} to accept this invitation`
          : `Set a password for ${preview.email} to create your account`
      }
    >
      <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
        {error && <Banner variant="error" message={error} onDismiss={() => setError(null)} />}
        {!preview.hasExistingAccount && (
          <div>
            <label htmlFor="name" className="form-label">
              Your name
            </label>
            <input
              id="name"
              className={`${inputClass} ${errors.name ? 'form-input-error' : ''}`}
              {...register('name')}
            />
            <FieldError message={errors.name?.message} />
          </div>
        )}
        <div>
          <label htmlFor="password" className="form-label">
            {preview.hasExistingAccount ? 'Current password' : 'Set a password'}
          </label>
          <input
            id="password"
            className={`${inputClass} ${errors.password ? 'form-input-error' : ''}`}
            type="password"
            {...register('password')}
          />
          <FieldError message={errors.password?.message} />
        </div>
        <button type="submit" className={buttonClass} disabled={acceptInvitation.isPending}>
          {acceptInvitation.isPending && <span className="spinner" aria-hidden="true" />}
          {acceptInvitation.isPending ? 'Joining…' : 'Accept invitation'}
        </button>
      </form>
    </AuthCard>
  )
}
