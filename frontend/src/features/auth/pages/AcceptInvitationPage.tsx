import React, { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useNavigate, useSearchParams, Link } from 'react-router-dom'
import { toast } from 'sonner'
import { AuthCard } from '../components/AuthCard'
import { FieldError, inputClass, buttonClass } from '../components/formControls'
import { acceptInvitationSchema, AcceptInvitationFormValues } from '../schemas/authSchemas'
import { usePreviewInvitation, useAcceptInvitation } from '../hooks/useAuthMutations'

export const AcceptInvitationPage: React.FC = () => {
  const navigate = useNavigate()
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
    try {
      await acceptInvitation.mutateAsync({ token, password: values.password, name: values.name })
      toast.success('Invitation accepted! Please log in.')
      navigate('/login')
    } catch (err: any) {
      toast.error(err?.response?.data?.error?.message || 'Could not accept invitation')
    }
  }

  if (previewError) {
    return (
      <AuthCard title="Invitation">
        <p className="text-sm text-red-600">
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
        <p className="text-sm text-gray-600">Loading invitation…</p>
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
