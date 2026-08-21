import { Router } from 'express'
import * as invitationsController from '../controller/invitations.controller'
import { validateBody } from '../../../middleware/validate'
import { requireAuth, requireOrgContext } from '../../../middleware/auth'
import { requireRole } from '../../../middleware/rbac'
import { createInvitationSchema, acceptInvitationSchema } from '../validator/invitations.validator'
import { invitationRateLimiter } from '../../../middleware/rateLimit'

export const invitationsRouter = Router()

invitationsRouter.post(
  '/',
  requireAuth,
  requireOrgContext,
  requireRole('owner', 'admin'),
  invitationRateLimiter,
  validateBody(createInvitationSchema),
  invitationsController.createInvitation
)

// New: list invitations (paginated) for current org
invitationsRouter.get(
  '/',
  requireAuth,
  requireOrgContext,
  requireRole('owner', 'admin'),
  invitationsController.listInvitations
)

invitationsRouter.get('/:token', invitationsController.previewInvitation)
invitationsRouter.post(
  '/:token/accept',
  validateBody(acceptInvitationSchema),
  invitationsController.acceptInvitation
)
