import { Request, Response, NextFunction } from 'express'
import { AppError } from '../shared/utils/AppError'

/**
 * Restricts access to users whose org-scoped role (set by requireAuth via the
 * access token) is one of the allowed roles. Must run after requireAuth + requireOrgContext.
 */
export function requireRole(...allowedRoles: Array<'owner' | 'admin' | 'member'>) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const role = req.auth?.role
    if (!role || !allowedRoles.includes(role)) {
      throw AppError.forbidden('Insufficient permissions', 'FORBIDDEN_ROLE')
    }
    next()
  }
}
