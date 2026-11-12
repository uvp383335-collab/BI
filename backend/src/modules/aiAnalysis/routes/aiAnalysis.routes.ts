import { Router } from 'express'
import * as aiAnalysisController from '../controller/aiAnalysis.controller'
import { requireAuth, requireOrgContext } from '../../../middleware/auth'
import { validateBody } from '../../../middleware/validate'
import { aiAnalysisRateLimiter } from '../../../middleware/rateLimit'
import { analyzeChartBodySchema } from '../validator/aiAnalysis.validator'

export const aiAnalysisRouter = Router()

aiAnalysisRouter.post(
  '/:chartKey',
  requireAuth,
  requireOrgContext,
  aiAnalysisRateLimiter,
  validateBody(analyzeChartBodySchema),
  aiAnalysisController.analyzeChartHandler
)
aiAnalysisRouter.get('/:chartKey/latest', requireAuth, requireOrgContext, aiAnalysisController.getLatestChartAnalysisHandler)
