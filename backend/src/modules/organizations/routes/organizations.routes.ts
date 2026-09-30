import { Router } from 'express'
import * as organizationsController from '../controller/organizations.controller'
import { requireAuth } from '../../../middleware/auth'
import { validateBody } from '../../../middleware/validate'
import { createOrganizationSchema } from '../validator/organizations.validator'
import { createOrgRateLimiter } from '../../../middleware/rateLimit'

export const organizationsRouter = Router()

// Any authenticated user (regardless of which org, if any, their current
// token is scoped to) can create a brand new organization and becomes its
// owner immediately — this is the "Add organization" action post-login.
organizationsRouter.post(
  '/',
  requireAuth,
  createOrgRateLimiter,
  validateBody(createOrganizationSchema),
  organizationsController.createOrganization
)
