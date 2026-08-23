import { Router } from 'express'
import * as metricsController from '../controller/metrics.controller'
import { requireAuth, requireOrgContext } from '../../../middleware/auth'
import { validateQuery } from '../../../middleware/validate'
import { getMetricQuerySchema } from '../validator/metrics.validator'

export const metricsRouter = Router()

const guards = [requireAuth, requireOrgContext, validateQuery(getMetricQuerySchema)] as const

metricsRouter.get('/vc-01', ...guards, metricsController.getVC01)
metricsRouter.get('/vc-02', ...guards, metricsController.getVC02)
metricsRouter.get('/vc-03', ...guards, metricsController.getVC03)
metricsRouter.get('/vc-04', ...guards, metricsController.getVC04)
metricsRouter.get('/vc-06', ...guards, metricsController.getVC06)
metricsRouter.get('/vc-07', ...guards, metricsController.getVC07)
metricsRouter.get('/vc-09', ...guards, metricsController.getVC09)
metricsRouter.get('/vc-10', ...guards, metricsController.getVC10)
metricsRouter.get('/vc-12', ...guards, metricsController.getVC12)
metricsRouter.get('/vc-13', ...guards, metricsController.getVC13)
metricsRouter.get('/vc-14', ...guards, metricsController.getVC14)
metricsRouter.get('/cb-05', ...guards, metricsController.getCB05)
metricsRouter.get('/cb-07', ...guards, metricsController.getCB07)
metricsRouter.get('/cb-10', ...guards, metricsController.getCB10)
metricsRouter.get('/cm-02', ...guards, metricsController.getCM02)
metricsRouter.get('/cm-03', ...guards, metricsController.getCM03)
metricsRouter.get('/cm-04', ...guards, metricsController.getCM04)
metricsRouter.get('/cm-05', ...guards, metricsController.getCM05)
metricsRouter.get('/cm-06', ...guards, metricsController.getCM06)
metricsRouter.get('/cm-07', ...guards, metricsController.getCM07)
metricsRouter.get('/cm-08', ...guards, metricsController.getCM08)
