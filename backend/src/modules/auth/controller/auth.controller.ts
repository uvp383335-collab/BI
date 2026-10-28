import { Request, Response } from 'express'
import { asyncHandler } from '../../../shared/utils/asyncHandler'
import { sendSuccess } from '../../../shared/utils/apiResponse'
import * as authService from '../service/auth.service'
import { AppError } from '../../../shared/utils/AppError'

const REFRESH_COOKIE_NAME = 'refreshToken'
const isProd = process.env.NODE_ENV === 'production'

function setRefreshCookie(res: Response, token: string) {
  res.cookie(REFRESH_COOKIE_NAME, token, {
    httpOnly: true,
    secure: isProd,
    sameSite: 'lax',
    maxAge: 30 * 24 * 60 * 60 * 1000,
    path: '/api/v1/auth'
  })
}

function clearRefreshCookie(res: Response) {
  res.clearCookie(REFRESH_COOKIE_NAME, { path: '/api/v1/auth' })
}

export const signup = asyncHandler(async (req: Request, res: Response) => {
  const result = await authService.signup(req.body)
  return sendSuccess(res, result, 201)
})

export const login = asyncHandler(async (req: Request, res: Response) => {
  const result = await authService.login(req.body)
  if (!result.requiresOrgSelection) {
    setRefreshCookie(res, result.refreshToken)
    return sendSuccess(res, { accessToken: result.accessToken, organization: result.organization })
  }
  return sendSuccess(res, { requiresOrgSelection: true, pendingToken: result.pendingToken, organizations: result.organizations })
})

export const selectOrg = asyncHandler(async (req: Request, res: Response) => {
  if (!req.auth?.pending) {
    throw AppError.unauthorized('A pending login token is required', 'PENDING_TOKEN_REQUIRED')
  }
  const result = await authService.selectOrganization(req.auth.userId, req.body.orgId)
  setRefreshCookie(res, result.refreshToken)
  return sendSuccess(res, { accessToken: result.accessToken, organization: result.organization })
})

export const listOrganizations = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.auth?.userId
  if (!userId) throw AppError.unauthorized('Not authenticated', 'NOT_AUTHENTICATED')
  const orgs = await authService.listOrganizationsForUser(userId)
  return sendSuccess(res, orgs)
})

export const switchOrg = asyncHandler(async (req: Request, res: Response) => {
  // Allow switching when the user is already authenticated with a valid access token.
  const userId = req.auth?.userId
  if (!userId) throw AppError.unauthorized('Not authenticated', 'NOT_AUTHENTICATED')
  const result = await authService.switchOrganizationForUser(userId, req.body.orgId)
  setRefreshCookie(res, result.refreshToken)
  return sendSuccess(res, { accessToken: result.accessToken, organization: result.organization })
})

export const refresh = asyncHandler(async (req: Request, res: Response) => {
  const token = req.cookies?.[REFRESH_COOKIE_NAME]
  if (!token) {
    throw AppError.unauthorized('Missing refresh token', 'MISSING_REFRESH_TOKEN')
  }
  const result = await authService.refreshSession(token)
  setRefreshCookie(res, result.refreshToken)
  // Return accessToken and organization so the frontend can restore org state on refresh
  return sendSuccess(res, { accessToken: result.accessToken, organization: result.organization })
})
export const logout = asyncHandler(async (req: Request, res: Response) => {
  const token = req.cookies?.[REFRESH_COOKIE_NAME]
  if (token) {
    await authService.logout(token)
  }
  clearRefreshCookie(res)
  return sendSuccess(res, { loggedOut: true })
})

export const forgotPassword = asyncHandler(async (req: Request, res: Response) => {
  await authService.forgotPassword(req.body.email)
  // Always respond success to avoid leaking whether the email is registered.
  return sendSuccess(res, { message: 'If that email is registered, a reset link has been sent.' })
})

export const resetPassword = asyncHandler(async (req: Request, res: Response) => {
  await authService.resetPassword(req.body.token, req.body.password)
  return sendSuccess(res, { message: 'Password has been reset successfully.' })
})
