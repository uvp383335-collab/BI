import { Router } from 'express'
import * as dashboardController from '../controller/dashboard.controller'
import { requireAuth, requireOrgContext } from '../../../middleware/auth'
import { validateQuery } from '../../../middleware/validate'
import { dashboardQuerySchema } from '../validator/dashboard.validator'

/**
 * Screen-shaped read API for the oryon-web dashboard. The organization always
 * comes from the access token (never the URL), so there is no company id to
 * tamper with.
 */
export const dashboardRouter = Router()

const guards = [requireAuth, requireOrgContext, validateQuery(dashboardQuerySchema)] as const

dashboardRouter.get('/meta', requireAuth, requireOrgContext, dashboardController.getMetaHandler)
dashboardRouter.get('/overview', ...guards, dashboardController.getOverviewHandler)
dashboardRouter.get('/families/:family', ...guards, dashboardController.getFamilyHandler)
dashboardRouter.get('/metrics/:metricId', ...guards, dashboardController.getMetricHandler)
dashboardRouter.get('/alerts', ...guards, dashboardController.getAlertsHandler)
