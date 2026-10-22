import { Router } from 'express'
import * as syncController from '../controller/sync.controller'
import { requireAuth, requireOrgContext } from '../../../middleware/auth'
import { requireRole } from '../../../middleware/rbac'
import { validateBody } from '../../../middleware/validate'
import { updateProductCategoriesSchema } from '../validator/product.validator'

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

// Any org member can view how products are categorized (VC-13 and VC-01/02
// read this to render "not computable" correctly); only owners/admins can change it.
syncRouter.get('/:provider/products', requireAuth, requireOrgContext, syncController.listProducts)
syncRouter.patch(
  '/:provider/products/categories',
  requireAuth,
  requireOrgContext,
  requireRole('owner', 'admin'),
  validateBody(updateProductCategoriesSchema),
  syncController.updateProductCategories
)
