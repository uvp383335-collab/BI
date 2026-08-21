import { Router } from 'express'
import * as syncController from '../controller/sync.controller'
import { requireAuth, requireOrgContext } from '../../../middleware/auth'
import { requireRole } from '../../../middleware/rbac'

export const syncRouter = Router()

// Any org member can view sync progress/counts, but only owners/admins can trigger a (re)sync.
syncRouter.post(
  '/:provider/start',
  requireAuth,
  requireOrgContext,
  requireRole('owner', 'admin'),
  syncController.startSync
)
syncRouter.get('/:provider/status', requireAuth, requireOrgContext, syncController.getStatus)
syncRouter.get('/:provider/counts', requireAuth, requireOrgContext, syncController.getEntityCounts)
