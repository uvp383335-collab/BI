import { invitationsRepository } from '../repository/invitations.repository'
import { organizationsRepository } from '../../organizations/repository/organizations.repository'
import { membershipsRepository } from '../../organizations/repository/memberships.repository'
import { usersRepository } from '../../users/repository/users.repository'
import { generateToken, hashToken } from '../../../shared/utils/token'
import { hashPassword, comparePassword } from '../../../shared/utils/password'
import { sendInvitationEmail } from '../../../shared/utils/email'
import { AppError } from '../../../shared/utils/AppError'
import { MembershipRole } from '../../organizations/model/Membership.model'

const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000 // 7 days

export async function createInvitation(
  orgId: string,
  invitedBy: string,
  email: string,
  role: MembershipRole
) {
  const existingUser = await usersRepository.findByEmail(email)
  if (existingUser) {
    const existingMembership = await membershipsRepository.findByUserAndOrg(existingUser._id, orgId)
    if (existingMembership && existingMembership.status === 'active') {
      throw AppError.conflict('This user is already a member of the organization', 'ALREADY_MEMBER')
    }
  }
  const existingInvite = await invitationsRepository.findPendingByEmailAndOrg(email, orgId)
  if (existingInvite) {
    throw AppError.conflict('An invitation is already pending for this email', 'INVITATION_PENDING')
  }

  const org = await organizationsRepository.findById(orgId)
  if (!org) {
    throw AppError.notFound('Organization not found', 'ORG_NOT_FOUND')
  }

  const { token, tokenHash } = generateToken()
  const invitation = await invitationsRepository.create({
    orgId,
    email,
    role,
    tokenHash,
    invitedBy,
    expiresAt: new Date(Date.now() + INVITATION_TTL_MS)
  })
  await sendInvitationEmail(email, token, org.name)
  return { invitationId: invitation._id.toString() }
}

export async function previewInvitation(token: string) {
  const tokenHash = hashToken(token)
  const invitation = await invitationsRepository.findValidByHash(tokenHash)
  if (!invitation) {
    throw AppError.badRequest('Invalid or expired invitation', 'INVALID_TOKEN')
  }
  const org = await organizationsRepository.findById(invitation.orgId)
  const existingUser = await usersRepository.findByEmail(invitation.email)
  return {
    email: invitation.email,
    role: invitation.role,
    organizationName: org?.name ?? 'the organization',
    hasExistingAccount: !!existingUser
  }
}

export async function acceptInvitation(token: string, password: string, name?: string) {
  const tokenHash = hashToken(token)
  const invitation = await invitationsRepository.findValidByHash(tokenHash)
  if (!invitation) {
    throw AppError.badRequest('Invalid or expired invitation', 'INVALID_TOKEN')
  }

  let user = await usersRepository.findByEmail(invitation.email)

  if (user) {
    // Existing account: confirm identity by verifying the current password.
    const passwordOk = await comparePassword(password, user.passwordHash)
    if (!passwordOk) {
      throw AppError.unauthorized('Incorrect password', 'INVALID_CREDENTIALS')
    }
  } else {
    // New account: this password becomes the account's password. Invitation
    // acceptance implies a verified email since the link was delivered to that inbox.
    const passwordHash = await hashPassword(password)
    user = await usersRepository.create({
      email: invitation.email,
      passwordHash,
      name: name || invitation.email.split('@')[0],
      status: 'active'
    })
    await usersRepository.markEmailVerified(user._id)
  }

  const existingMembership = await membershipsRepository.findByUserAndOrg(user._id, invitation.orgId)
  if (existingMembership) {
    if (existingMembership.status !== 'active') {
      await membershipsRepository.activate(existingMembership._id)
    }
  } else {
    await membershipsRepository.create({
      userId: user._id,
      orgId: invitation.orgId,
      role: invitation.role,
      status: 'active',
      invitedBy: invitation.invitedBy
    })
  }

  await invitationsRepository.markAccepted(invitation._id)
  return { userId: user._id.toString(), organizationId: invitation.orgId.toString() }
}

// List invitations for an organization with pagination/filtering
export async function listInvitations(
  orgId: string,
  opts: { page?: number; pageSize?: number; status?: string; role?: string; sort?: string } = {}
) {
  const result = await invitationsRepository.findByOrg(orgId, opts)
  // items have invitedBy populated (may be null if user deleted)
  return result
}