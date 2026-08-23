import jwt, { SignOptions } from 'jsonwebtoken'
import { AppError } from './AppError'

export interface AccessTokenPayload {
  sub: string // userId
  orgId?: string
  role?: 'owner' | 'admin' | 'member'
  /** true for the short-lived token issued right after login, before an org is selected */
  pending?: boolean
}

export interface RefreshTokenPayload {
  sub: string // userId
  jti: string // refresh token id, used to look up/rotate/revoke in DB
}

const ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || 'change-me'
const REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'change-me'
const ACCESS_EXPIRES_IN = process.env.JWT_ACCESS_EXPIRES_IN || '15m'
const REFRESH_EXPIRES_IN = process.env.JWT_REFRESH_EXPIRES_IN || '30d'

export function signAccessToken(payload: AccessTokenPayload): string {
  return jwt.sign(payload, ACCESS_SECRET, { expiresIn: ACCESS_EXPIRES_IN } as SignOptions)
}

/** Short-lived token issued after credential verification but before org selection. */
export function signPendingToken(userId: string): string {
  return jwt.sign({ sub: userId, pending: true }, ACCESS_SECRET, { expiresIn: '5m' } as SignOptions)
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  try {
    return jwt.verify(token, ACCESS_SECRET) as AccessTokenPayload
  } catch {
    throw AppError.unauthorized('Invalid or expired access token', 'INVALID_ACCESS_TOKEN')
  }
}

export function signRefreshToken(payload: RefreshTokenPayload): string {
  return jwt.sign(payload, REFRESH_SECRET, { expiresIn: REFRESH_EXPIRES_IN } as SignOptions)
}

export function verifyRefreshToken(token: string): RefreshTokenPayload {
  try {
    return jwt.verify(token, REFRESH_SECRET) as RefreshTokenPayload
  } catch {
    throw AppError.unauthorized('Invalid or expired refresh token', 'INVALID_REFRESH_TOKEN')
  }
}

export const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000 // 30 days, keep in sync with REFRESH_EXPIRES_IN

export interface IntegrationStatePayload {
  userId: string
  orgId: string
  provider: string
  /** PKCE verifier for providers requiring it (e.g. Salesforce) — carried through the redirect since it can't be kept server-side across a stateless OAuth callback. */
  codeVerifier?: string
}

/**
 * Short-lived, signed token carrying org/user context through a third-party OAuth
 * redirect (e.g. HubSpot), which cannot forward our Authorization header.
 */
export function signIntegrationState(payload: IntegrationStatePayload): string {
  return jwt.sign(payload, ACCESS_SECRET, { expiresIn: '10m' } as SignOptions)
}

export function verifyIntegrationState(token: string): IntegrationStatePayload {
  try {
    return jwt.verify(token, ACCESS_SECRET) as IntegrationStatePayload
  } catch {
    throw AppError.badRequest('Invalid or expired OAuth state', 'INVALID_OAUTH_STATE')
  }
}
