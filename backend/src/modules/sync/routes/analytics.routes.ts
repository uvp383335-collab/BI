import { Router } from 'express'
import * as analyticsController from '../controller/analytics.controller'
import { requireAuth, requireOrgContext } from '../../../middleware/auth'

export const analyticsRouter = Router()

analyticsRouter.get('/:provider/pipeline-progression', requireAuth, requireOrgContext, analyticsController.getPipelineProgression)
analyticsRouter.get('/:provider/pipelines', requireAuth, requireOrgContext, analyticsController.getPipelines)
analyticsRouter.get('/:provider/owners', requireAuth, requireOrgContext, analyticsController.getOwnerIds)
