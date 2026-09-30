import { Request, Response } from 'express'
import { asyncHandler } from '../../../shared/utils/asyncHandler'
import { sendSuccess } from '../../../shared/utils/apiResponse'
import { AppError } from '../../../shared/utils/AppError'
import * as organizationsService from '../service/organizations.service'

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

export const createOrganization = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.auth?.userId
  if (!userId) throw AppError.unauthorized('Not authenticated', 'NOT_AUTHENTICATED')
  const result = await organizationsService.createOrganizationForUser(userId, req.body.name)
  setRefreshCookie(res, result.refreshToken)
  return sendSuccess(res, { accessToken: result.accessToken, organization: result.organization }, 201)
})
