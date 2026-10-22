import { Request, Response, NextFunction } from 'express'
import { verifyAccessToken } from '../shared/utils/jwt'
import { AppError } from '../shared/utils/AppError'

export interface AuthenticatedUser {
  userId: string
  orgId?: string
  role?: 'owner' | 'admin' | 'member'
  pending?: boolean
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: AuthenticatedUser
    }
  }
}

/**
 * Verifies the Bearer access token and attaches the decoded identity to req.auth.
 */
export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization
  if (!header || !header.startsWith('Bearer ')) {
    throw AppError.unauthorized('Missing access token', 'MISSING_TOKEN')
  }
  const token = header.slice('Bearer '.length)
  const payload = verifyAccessToken(token)
  req.auth = { userId: payload.sub, orgId: payload.orgId, role: payload.role, pending: payload.pending }
  next()
}

/**
 * Ensures the request has an organization context (i.e. the access token was
 * issued after org selection), required for org-scoped endpoints like invitations.
 */
export function requireOrgContext(req: Request, _res: Response, next: NextFunction) {
  if (!req.auth?.orgId) {
    throw AppError.forbidden('Organization context required', 'ORG_CONTEXT_REQUIRED')
  }
  next()
}
