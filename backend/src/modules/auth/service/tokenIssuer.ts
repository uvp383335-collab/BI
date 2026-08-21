import { v4 as uuidv4 } from 'uuid'
import { signAccessToken, signRefreshToken, REFRESH_TOKEN_TTL_MS } from '../../../shared/utils/jwt'
import { refreshTokenRepository } from '../repository/refreshToken.repository'
import { MembershipRole } from '../../organizations/model/Membership.model'

/**
 * Issues a scoped access token (with org+role) and a rotated refresh token,
 * persisting the refresh token's jti so it can be validated/revoked later.
 */
export async function issueTokenPair(userId: string, orgId: string, role: MembershipRole) {
  const accessToken = signAccessToken({ sub: userId, orgId, role })
  const jti = uuidv4()
  const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_MS)
  await refreshTokenRepository.create({ userId, orgId, jti, expiresAt })
  const refreshToken = signRefreshToken({ sub: userId, jti })
  return { accessToken, refreshToken }
}
