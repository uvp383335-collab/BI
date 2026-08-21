import React from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { toast } from 'sonner'
import { useAuthContext } from '../../../shared/context/AuthContext'
import { useCreateInvitation } from '../hooks/useAuthMutations'
import { createInvitationSchema, type CreateInvitationFormValues } from '../schemas/authSchemas'
import { FieldError, inputClass, buttonClass } from './formControls'
import { type MembershipRole } from '../../../entities/user/types'

const roleOptions: Array<{ value: MembershipRole; label: string }> = [
  { value: 'admin', label: 'Admin' },
  { value: 'member', label: 'Member' }
]

export const InviteMemberCard: React.FC<{ organizationRole?: MembershipRole }> = ({ organizationRole }) => {
  const { organization } = useAuthContext()
  const orgRole = organizationRole ?? organization?.role
  const createInvitation = useCreateInvitation()

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
      toast.success('Invitation sent successfully.')
      reset({ email: '', role: 'member' })
    } catch (err: any) {
      toast.error(err?.response?.data?.error?.message || 'Could not send invitation')
    }
  }

  return (
    <div className="w-full max-w-2xl rounded-3xl bg-white p-8 shadow-xl shadow-slate-200/50 ring-1 ring-black/5">
      <div className="mb-6">
        <p className="text-sm font-semibold text-blue-600">Team Invitation</p>
        <h2 className="mt-2 text-2xl font-semibold text-gray-900">Invite someone to your organization</h2>
        <p className="mt-2 text-sm text-gray-600">
          Send a secure invite link to a teammate so they can join your current organization.
        </p>
      </div>

      {!isManager ? (
        <div className="rounded-2xl border border-gray-200 bg-gray-50 p-6">
          <p className="text-sm font-medium text-gray-900">Invitation access</p>
          <p className="mt-2 text-sm text-gray-600">
            Only organization owners and admins can invite new members. Contact an owner or admin to invite people.
          </p>
        </div>
      ) : (
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
          <div>
            <label htmlFor="email" className="form-label">
              Email address
            </label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              className={`${inputClass} ${errors.email ? 'form-input-error' : ''}`}
              {...register('email')}
            />
            <FieldError message={errors.email?.message} />
          </div>

          <div>
            <label htmlFor="role" className="form-label">
              Role
            </label>
            <select id="role" className={`${inputClass} ${errors.role ? 'form-input-error' : ''}`} {...register('role')}>
              {roleSelectOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <FieldError message={errors.role?.message} />
          </div>

          <button type="submit" className={buttonClass} disabled={createInvitation.isPending}>
            {createInvitation.isPending && <span className="spinner" aria-hidden="true" />}
            {createInvitation.isPending ? 'Sending invite…' : 'Send invitation'}
          </button>
        </form>
      )}
    </div>
  )
}
