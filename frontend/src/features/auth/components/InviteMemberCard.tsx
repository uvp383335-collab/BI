import React, { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useAuthContext } from '../../../shared/context/AuthContext'
import { useCreateInvitation } from '../hooks/useAuthMutations'
import { createInvitationSchema, type CreateInvitationFormValues } from '../schemas/authSchemas'
import { FieldError } from './formControls'
import { Banner } from '../../../shared/components/Banner'
import { type MembershipRole } from '../../../entities/user/types'

const roleOptions: Array<{ value: MembershipRole; label: string }> = [
  { value: 'admin', label: 'Admin' },
  { value: 'member', label: 'Member' }
]

export const InviteMemberCard: React.FC<{ organizationRole?: MembershipRole }> = ({ organizationRole }) => {
  const { organization } = useAuthContext()
  const orgRole = organizationRole ?? organization?.role
  const createInvitation = useCreateInvitation()
  const [banner, setBanner] = useState<{ variant: 'success' | 'error'; message: string } | null>(null)

  const {
    register,
    handleSubmit,
    formState: { errors },
    reset
  } = useForm<CreateInvitationFormValues>({
    resolver: zodResolver(createInvitationSchema),
    defaultValues: {
      email: '',
      role: 'member'
    }
  })

  const isManager = orgRole === 'owner' || orgRole === 'admin'
  const canInviteOwner = orgRole === 'owner'

  const roleSelectOptions = canInviteOwner
    ? [{ value: 'owner', label: 'Owner' }, ...roleOptions]
    : roleOptions

  const onSubmit = async (values: CreateInvitationFormValues) => {
    try {
      await createInvitation.mutateAsync(values)
      setBanner({ variant: 'success', message: `Invitation sent to ${values.email}.` })
      reset({ email: '', role: 'member' })
    } catch (err: any) {
      setBanner({ variant: 'error', message: err?.response?.data?.error?.message || 'Could not send invitation' })
    }
  }

  return (
    <div className="card w-full max-w-2xl p-8">
      <div className="mb-6">
        <p className="text-sm font-semibold text-brand">Team Invitation</p>
        <h2 className="mt-2 text-2xl font-semibold text-ink">Invite someone to your organization</h2>
        <p className="mt-2 text-sm text-ink-2">
          Send a secure invite link to a teammate so they can join your current organization.
        </p>
      </div>

      {!isManager ? (
        <div className="rounded-2xl border border-line bg-surface-3 p-6">
          <p className="text-sm font-medium text-ink">Invitation access</p>
          <p className="mt-2 text-sm text-ink-2">
            Only organization owners and admins can invite new members. Contact an owner or admin to invite people.
          </p>
        </div>
      ) : (
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
          {banner && <Banner variant={banner.variant} message={banner.message} onDismiss={() => setBanner(null)} />}
          <div>
            <label htmlFor="email" className="mb-1 block text-sm font-medium text-ink-2">
              Email address
            </label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              className={`form-input-dark w-full ${errors.email ? 'border-danger focus:border-danger focus:ring-danger/40' : ''}`}
              {...register('email')}
            />
            <FieldError message={errors.email?.message} />
          </div>

          <div>
            <label htmlFor="role" className="mb-1 block text-sm font-medium text-ink-2">
              Role
            </label>
            <select
              id="role"
              className={`form-input-dark w-full ${errors.role ? 'border-danger focus:border-danger focus:ring-danger/40' : ''}`}
              {...register('role')}
            >
              {roleSelectOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <FieldError message={errors.role?.message} />
          </div>

          <button type="submit" className="btn-primary w-auto px-6 py-2" disabled={createInvitation.isPending}>
            {createInvitation.isPending && <span className="spinner" aria-hidden="true" />}
            {createInvitation.isPending ? 'Sending invite…' : 'Send invitation'}
          </button>
        </form>
      )}
    </div>
  )
}
