import { Router } from 'express'
import * as authController from '../controller/auth.controller'
import { validateBody } from '../../../middleware/validate'
import { requireAuth } from '../../../middleware/auth'
import {
  signupSchema,
  loginSchema,
  selectOrgSchema,
  forgotPasswordSchema,
  resetPasswordSchema
} from '../validator/auth.validator'
import {
  loginRateLimiter,
  signupRateLimiter,
  forgotPasswordRateLimiter
} from '../../../middleware/rateLimit'

export const authRouter = Router()

authRouter.post('/signup', signupRateLimiter, validateBody(signupSchema), authController.signup)
authRouter.post('/login', loginRateLimiter, validateBody(loginSchema), authController.login)
authRouter.post('/select-org', requireAuth, validateBody(selectOrgSchema), authController.selectOrg)
authRouter.get('/organizations', requireAuth, authController.listOrganizations)
authRouter.post('/switch-org', requireAuth, validateBody(selectOrgSchema), authController.switchOrg)
authRouter.post('/refresh', authController.refresh)
authRouter.post('/logout', authController.logout)
authRouter.post(
  '/forgot-password',
  forgotPasswordRateLimiter,
  validateBody(forgotPasswordSchema),
  authController.forgotPassword
)
authRouter.post('/reset-password', validateBody(resetPasswordSchema), authController.resetPassword)
