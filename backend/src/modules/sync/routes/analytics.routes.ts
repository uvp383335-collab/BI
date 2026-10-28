import { Router } from 'express'
import * as analyticsController from '../controller/analytics.controller'
import { requireAuth, requireOrgContext } from '../../../middleware/auth'
import { validateQuery } from '../../../middleware/validate'
import { getFunnelsQuerySchema, paginationQuerySchema } from '../validator/analytics.validator'

export const analyticsRouter = Router()

analyticsRouter.get(
  '/:provider/funnels',
  requireAuth,
  requireOrgContext,
  validateQuery(getFunnelsQuerySchema),
  analyticsController.getFunnels
)
analyticsRouter.get('/:provider/pipelines', requireAuth, requireOrgContext, analyticsController.getPipelines)
analyticsRouter.get('/:provider/products', requireAuth, requireOrgContext, analyticsController.getProducts)
analyticsRouter.get(
  '/:provider/opportunities',
  requireAuth,
  requireOrgContext,
  validateQuery(paginationQuerySchema),
  analyticsController.getOpportunities
)
analyticsRouter.get(
  '/:provider/campaigns',
  requireAuth,
  requireOrgContext,
  validateQuery(paginationQuerySchema),
  analyticsController.getCampaigns
)
