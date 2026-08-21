import { Router } from 'express'
import * as verificationController from '../controller/verification.controller'
import { validateBody } from '../../../middleware/validate'
import { resendVerificationSchema } from '../validator/verification.validator'
import { resendVerificationRateLimiter } from '../../../middleware/rateLimit'

export const verificationRouter = Router()

verificationRouter.get('/verify-email', verificationController.verifyEmail)
verificationRouter.post(
  '/resend-verification',
  resendVerificationRateLimiter,
  validateBody(resendVerificationSchema),
  verificationController.resendVerification
)
