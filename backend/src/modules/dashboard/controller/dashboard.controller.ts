import { Request, Response } from 'express'
import { asyncHandler } from '../../../shared/utils/asyncHandler'
import { sendSuccess } from '../../../shared/utils/apiResponse'
import { AppError } from '../../../shared/utils/AppError'
import { getAlerts, getFamily, getMeta, getMetric, getOverview } from '../service/dashboard.service'
import { DashboardQueryInput, familyParamsSchema, metricParamsSchema } from '../validator/dashboard.validator'

const orgOf = (req: Request): string => req.auth!.orgId!
const queryOf = (req: Request) => req.query as unknown as DashboardQueryInput

export const getMetaHandler = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  sendSuccess(res, await getMeta(orgOf(req)))
})

export const getOverviewHandler = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  sendSuccess(res, await getOverview(orgOf(req), queryOf(req)))
})

export const getFamilyHandler = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const params = familyParamsSchema.safeParse(req.params)
  if (!params.success) throw AppError.notFound('Unknown metric family', 'FAMILY_NOT_FOUND')
  sendSuccess(res, await getFamily(orgOf(req), params.data.family, queryOf(req)))
})

export const getMetricHandler = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const params = metricParamsSchema.safeParse(req.params)
  if (!params.success) throw AppError.notFound('Unknown metric', 'METRIC_NOT_FOUND')
  sendSuccess(res, await getMetric(orgOf(req), params.data.metricId, queryOf(req)))
})

export const getAlertsHandler = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  sendSuccess(res, await getAlerts(orgOf(req), queryOf(req)))
})
