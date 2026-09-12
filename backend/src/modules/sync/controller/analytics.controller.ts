import { Request, Response } from 'express'
import { asyncHandler } from '../../../shared/utils/asyncHandler'
import { sendSuccess } from '../../../shared/utils/apiResponse'
import { analyticsService } from '../service/analytics.service'
import { funnelService } from '../service/funnel.service'
import { GetFunnelsQuery } from '../validator/analytics.validator'

export const getFunnels = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const provider = String(req.params.provider)
  const orgId = req.auth!.orgId!
  const { pipeline, from, to, productId } = req.query as unknown as GetFunnelsQuery
  const data = await funnelService.getFunnels(orgId, provider, {
    pipeline,
    from: from ? new Date(from) : undefined,
    // Inclusive end date: a bare YYYY-MM-DD parses to 00:00:00 UTC, so push
    // "to" to the end of that day or the day itself would be excluded.
    to: to ? new Date(`${to}T23:59:59.999Z`) : undefined,
    productId
  })
  sendSuccess(res, data)
})

export const getPipelines = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const provider = String(req.params.provider)
  const orgId = req.auth!.orgId!
  const pipelines = await analyticsService.getPipelines(orgId, provider)
  sendSuccess(res, pipelines)
})

export const getProducts = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const provider = String(req.params.provider)
  const orgId = req.auth!.orgId!
  const products = await analyticsService.getProducts(orgId, provider)
  sendSuccess(res, products)
})
