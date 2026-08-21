import { usersRepository } from '../../users/repository/users.repository'
import { verificationTokenRepository } from '../repository/verificationToken.repository'
import { generateToken, hashToken } from '../../../shared/utils/token'
import { sendVerificationEmail } from '../../../shared/utils/email'
import { AppError } from '../../../shared/utils/AppError'

const EMAIL_VERIFY_TTL_MS = 24 * 60 * 60 * 1000 // 24h

export async function verifyEmail(token: string) {
  const tokenHash = hashToken(token)
  const record = await verificationTokenRepository.findValidByHash(tokenHash, 'email_verify')
  console.log(record)
  if (!record) {
    throw AppError.badRequest('Invalid or expired verification link', 'INVALID_TOKEN')
  }
  await usersRepository.markEmailVerified(record.userId)
  await verificationTokenRepository.markUsed(record._id)
}

export async function resendVerification(email: string) {
  const user = await usersRepository.findByEmail(email)
  if (!user || user.emailVerifiedAt) {
    // Do not reveal account existence or verification state.
    return
  }
  await verificationTokenRepository.invalidateAllForUser(user._id, 'email_verify')
  const { token, tokenHash } = generateToken()
  await verificationTokenRepository.create({
    userId: user._id,
    tokenHash,
    type: 'email_verify',
    expiresAt: new Date(Date.now() + EMAIL_VERIFY_TTL_MS)
  })
  await sendVerificationEmail(user.email, token)
}
