import { Request, Response } from 'express'
import { asyncHandler } from '../../../shared/utils/asyncHandler'
import { sendSuccess } from '../../../shared/utils/apiResponse'
import { AppError } from '../../../shared/utils/AppError'
import { computeVC01, computeVC02, computeVC03 } from '../service/metrics.service'
import { computeVC04, computeVC06, computeVC07, computeVC09, computeVC10, computeVC12, computeVC13, computeVC14 } from '../service/plMetrics.service'
import { computeCB05, computeCB07, computeCB10 } from '../service/cbMetrics.service'
import { computeCM02, computeCM03, computeCM04, computeCM05, computeCM06, computeCM07, computeCM08 } from '../service/cmMetrics.service'
import { computeMetricTrend, TREND_METRIC_IDS, TrendMetricId } from '../service/metricsTrend.service'
import { GetMetricQuery } from '../validator/metrics.validator'

function metricHandler(compute: (orgId: string, period?: string) => Promise<unknown>) {
  return asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const orgId = req.auth!.orgId!
    const { period } = req.query as unknown as GetMetricQuery
    const result = await compute(orgId, period)
    sendSuccess(res, result)
  })
}

/** CM-04/06/08 additionally depend on which CRM's funnel/pipeline data to read (`?provider=hubspot|salesforce`, defaults to hubspot). */
function metricHandlerWithProvider(compute: (orgId: string, provider: string, period?: string) => Promise<unknown>) {
  return asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const orgId = req.auth!.orgId!
    const { period, provider } = req.query as unknown as GetMetricQuery
    const result = await compute(orgId, provider ?? 'hubspot', period)
    sendSuccess(res, result)
  })
}

export const getVC01 = metricHandler(computeVC01)
export const getVC02 = metricHandler(computeVC02)
export const getVC03 = metricHandler(computeVC03)
export const getVC04 = metricHandler(computeVC04)
export const getVC06 = metricHandler(computeVC06)
export const getVC07 = metricHandler(computeVC07)
export const getVC09 = metricHandler(computeVC09)
export const getVC10 = metricHandler(computeVC10)
export const getVC12 = metricHandler(computeVC12)
export const getVC13 = metricHandler(computeVC13)
export const getVC14 = metricHandler(computeVC14)

// CB-05 is checked daily and has no meaningful `?period=` (it's always "as of the latest sync").
export const getCB05 = metricHandler((orgId) => computeCB05(orgId))
export const getCB07 = metricHandler(computeCB07)
export const getCB10 = metricHandler(computeCB10)
export const getCM02 = metricHandler(computeCM02)
export const getCM03 = metricHandler(computeCM03)
export const getCM04 = metricHandlerWithProvider(computeCM04)
export const getCM06 = metricHandlerWithProvider(computeCM06)
export const getCM08 = metricHandlerWithProvider(computeCM08)
export const getCM05 = metricHandler(computeCM05)
export const getCM07 = metricHandler(computeCM07)

export const getMetricTrend = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const orgId = req.auth!.orgId!
  const { id } = req.params
  if (!TREND_METRIC_IDS.includes(id as TrendMetricId)) {
    throw AppError.badRequest(`Unsupported trend metric "${id}"`, 'UNSUPPORTED_TREND_METRIC')
  }
  const result = await computeMetricTrend(orgId, id as TrendMetricId)
  sendSuccess(res, result)
})
