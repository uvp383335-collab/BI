import { Router } from 'express'
import * as integrationsController from '../controller/integrations.controller'
import { requireAuth, requireOrgContext } from '../../../middleware/auth'
import { requireRole } from '../../../middleware/rbac'

export const integrationsRouter = Router()

// Read-only status is visible to any org member so everyone can see what's connected.
integrationsRouter.get('/status', requireAuth, requireOrgContext, integrationsController.getStatus)

// Connecting/disconnecting a third-party provider is an org-level action restricted to owners/admins.
integrationsRouter.get(
  '/:provider/authorize',
  requireAuth,
  requireOrgContext,
  requireRole('owner', 'admin'),
  integrationsController.getAuthorizeUrl
)

// Public: the provider (e.g. HubSpot) redirects the user's browser here directly, with no auth header.
integrationsRouter.get('/:provider/callback', integrationsController.handleCallback)

integrationsRouter.delete(
  '/:provider/disconnect',
  requireAuth,
  requireOrgContext,
  requireRole('owner', 'admin'),
  integrationsController.disconnectProvider
)
