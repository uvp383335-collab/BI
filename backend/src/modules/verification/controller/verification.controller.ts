import { Request, Response } from 'express'
import { asyncHandler } from '../../../shared/utils/asyncHandler'
import { sendSuccess } from '../../../shared/utils/apiResponse'
import * as verificationService from '../service/verification.service'
import { AppError } from '../../../shared/utils/AppError'

export const verifyEmail = asyncHandler(async (req: Request, res: Response) => {
  const token = (req.query.token as string) || req.body?.token
  if (!token) {
    throw AppError.badRequest('Token is required', 'MISSING_TOKEN')
  }
  await verificationService.verifyEmail(token)
  return sendSuccess(res, { verified: true })
})

export const resendVerification = asyncHandler(async (req: Request, res: Response) => {
  await verificationService.resendVerification(req.body.email)
  return sendSuccess(res, { message: 'If that account needs verification, an email has been sent.' })
})
