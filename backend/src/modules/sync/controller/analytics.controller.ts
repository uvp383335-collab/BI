import { Request, Response } from 'express'
import { asyncHandler } from '../../../shared/utils/asyncHandler'
import { sendSuccess } from '../../../shared/utils/apiResponse'
import { analyticsService } from '../service/analytics.service'

export const getPipelineProgression = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const provider = String(req.params.provider)
  const orgId = req.auth!.orgId!
  const { startDate, endDate, pipeline, hubspotOwnerId } = req.query

  const data = await analyticsService.getPipelineProgression(orgId, provider, {
    startDate: startDate as string | undefined,
    endDate: endDate as string | undefined,
    pipeline: pipeline as string | undefined,
    hubspotOwnerId: hubspotOwnerId as string | undefined
  })

  sendSuccess(res, data)
})

export const getPipelines = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const provider = String(req.params.provider)
  const orgId = req.auth!.orgId!
  const pipelines = await analyticsService.getPipelines(orgId, provider)
  sendSuccess(res, pipelines)
})

export const getOwnerIds = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const provider = String(req.params.provider)
  const orgId = req.auth!.orgId!
  const ownerIds = await analyticsService.getOwnerIds(orgId, provider)
  sendSuccess(res, ownerIds)
})
