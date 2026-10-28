import { usersRepository } from '../../users/repository/users.repository'
import { organizationsRepository } from '../../organizations/repository/organizations.repository'
import { membershipsRepository } from '../../organizations/repository/memberships.repository'
import { generateUniqueSlug } from '../../organizations/service/organizations.service'
import { verificationTokenRepository } from '../../verification/repository/verificationToken.repository'
import { hashPassword, comparePassword } from '../../../shared/utils/password'
import { generateToken, hashToken } from '../../../shared/utils/token'
import { signPendingToken, verifyRefreshToken } from '../../../shared/utils/jwt'
import { issueTokenPair } from './tokenIssuer'
import { refreshTokenRepository } from '../repository/refreshToken.repository'
import { sendVerificationEmail, sendPasswordResetEmail } from '../../../shared/utils/email'
import { AppError } from '../../../shared/utils/AppError'
import { SignupInput, LoginInput } from '../validator/auth.validator'
import { MembershipDocument } from '../../organizations/model/Membership.model'
import { OrganizationDocument } from '../../organizations/model/Organization.model'

const EMAIL_VERIFY_TTL_MS = 24 * 60 * 60 * 1000 // 24h
const PASSWORD_RESET_TTL_MS = 60 * 60 * 1000 // 1h

export async function signup(input: SignupInput) {
  const existing = await usersRepository.findByEmail(input.email)
  if (existing) {
    throw AppError.conflict('An account with this email already exists', 'EMAIL_TAKEN')
  }

  const passwordHash = await hashPassword(input.password)
  const user = await usersRepository.create({
    email: input.email,
    passwordHash,
    name: input.name,
    status: 'pending_verification'
  })

  const slug = await generateUniqueSlug(input.organizationName)
  const org = await organizationsRepository.create({ name: input.organizationName, slug })
  await membershipsRepository.create({ userId: user._id, orgId: org._id, role: 'owner', status: 'active' })

  const { token, tokenHash } = generateToken()
  await verificationTokenRepository.create({
    userId: user._id,
    tokenHash,
    type: 'email_verify',
    expiresAt: new Date(Date.now() + EMAIL_VERIFY_TTL_MS)
  })
  await sendVerificationEmail(user.email, token)

  return { userId: user._id.toString(), organizationId: org._id.toString(), slug: org.slug }
}

export async function login(input: LoginInput) {
  const user = await usersRepository.findByEmail(input.email)
  if (!user) {
    throw AppError.unauthorized('Invalid email or password', 'INVALID_CREDENTIALS')
  }
  const passwordOk = await comparePassword(input.password, user.passwordHash)
  if (!passwordOk) {
    throw AppError.unauthorized('Invalid email or password', 'INVALID_CREDENTIALS')
  }
  if (!user.emailVerifiedAt) {
    throw AppError.forbidden('Please verify your email before logging in', 'EMAIL_NOT_VERIFIED')
  }
  if (user.status === 'disabled') {
    throw AppError.forbidden('This account has been disabled', 'ACCOUNT_DISABLED')
  }

  const memberships = (await membershipsRepository.findActiveByUser(user._id)) as unknown as Array<
    MembershipDocument & { orgId: OrganizationDocument }
  >

  if (memberships.length === 0) {
    throw AppError.forbidden('No active organization membership found', 'NO_MEMBERSHIP')
  }

  if (memberships.length === 1) {
    const membership = memberships[0]
    const org = membership.orgId
    const tokens = await issueTokenPair(user._id.toString(), org._id.toString(), membership.role)
    return {
      requiresOrgSelection: false as const,
      ...tokens,
      organization: { id: org._id.toString(), name: org.name, slug: org.slug, role: membership.role }
    }
  }

  const pendingToken = signPendingToken(user._id.toString())
  return {
    requiresOrgSelection: true as const,
    pendingToken,
    organizations: memberships.map((m) => ({
      id: m.orgId._id.toString(),
      name: m.orgId.name,
      slug: m.orgId.slug,
      role: m.role
    }))
  }
}

export async function selectOrganization(userId: string, orgId: string) {
  const membership = await membershipsRepository.findByUserAndOrg(userId, orgId)
  if (!membership || membership.status !== 'active') {
    throw AppError.forbidden('You do not have access to this organization', 'MEMBERSHIP_NOT_FOUND')
  }
  const org = await organizationsRepository.findById(orgId)
  if (!org) {
    throw AppError.notFound('Organization not found', 'ORG_NOT_FOUND')
  }
  const tokens = await issueTokenPair(userId, orgId, membership.role)
  return { ...tokens, organization: { id: org._id.toString(), name: org.name, slug: org.slug, role: membership.role } }
}

export async function listOrganizationsForUser(userId: string) {
  const memberships = (await membershipsRepository.findActiveByUser(userId)) as unknown as Array<
    MembershipDocument & { orgId: OrganizationDocument }
  >
  return memberships.map((m) => ({ id: m.orgId._id.toString(), name: m.orgId.name, slug: m.orgId.slug, role: m.role }))
}

export async function switchOrganizationForUser(userId: string, orgId: string) {
  // Reuse the existing selectOrganization logic which verifies membership and issues tokens.
  return selectOrganization(userId, orgId)
}

export async function refreshSession(refreshToken: string) {
  const payload = verifyRefreshToken(refreshToken)
  const stored = await refreshTokenRepository.findActiveByJti(payload.jti)
  if (!stored) {
    throw AppError.unauthorized('Refresh token has been revoked or expired', 'INVALID_REFRESH_TOKEN')
  }
  // Rotate: revoke the old token before issuing a new one, preventing replay.
  await refreshTokenRepository.revoke(stored._id)

  // Re-derive the membership/role rather than trusting the old token, so a
  // revoked or changed membership is respected on every refresh.
  const membership = await membershipsRepository.findByUserAndOrg(stored.userId, stored.orgId)
  if (!membership || membership.status !== 'active') {
    throw AppError.forbidden('You no longer have access to this organization', 'MEMBERSHIP_NOT_FOUND')
  }
  const org = await organizationsRepository.findById(stored.orgId)
  if (!org) {
    throw AppError.notFound('Organization not found', 'ORG_NOT_FOUND')
  }
  const tokens = await issueTokenPair(stored.userId.toString(), stored.orgId.toString(), membership.role)
  return { ...tokens, organization: { id: org._id.toString(), name: org.name, slug: org.slug, role: membership.role } }
}

export async function logout(refreshToken: string) {
  try {
    const payload = verifyRefreshToken(refreshToken)
    await refreshTokenRepository.revokeByJti(payload.jti)
  } catch {
    // Already invalid/expired — logout is idempotent, nothing to do.
  }
}

export async function forgotPassword(email: string) {
  const user = await usersRepository.findByEmail(email)
  if (!user) {
    // Do not reveal whether the email exists.
    return
  }
  await verificationTokenRepository.invalidateAllForUser(user._id, 'password_reset')
  const { token, tokenHash } = generateToken()
  await verificationTokenRepository.create({
    userId: user._id,
    tokenHash,
    type: 'password_reset',
    expiresAt: new Date(Date.now() + PASSWORD_RESET_TTL_MS)
  })
  await sendPasswordResetEmail(user.email, token)
}

export async function resetPassword(token: string, newPassword: string) {
  const tokenHash = hashToken(token)
  const record = await verificationTokenRepository.findValidByHash(tokenHash, 'password_reset')
  if (!record) {
    throw AppError.badRequest('Invalid or expired token', 'INVALID_TOKEN')
  }
  const passwordHash = await hashPassword(newPassword)
  await usersRepository.updatePassword(record.userId, passwordHash)
  await verificationTokenRepository.markUsed(record._id)
}
