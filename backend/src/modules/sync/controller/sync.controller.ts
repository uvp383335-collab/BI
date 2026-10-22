import { Request, Response } from 'express'
import { asyncHandler } from '../../../shared/utils/asyncHandler'
import { sendSuccess } from '../../../shared/utils/apiResponse'
import { syncService } from '../service/sync.service'

export const startSync = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const provider = String(req.params.provider)
  const orgId = req.auth!.orgId!
  const force = req.query.force === 'true'
  const result = await syncService.startSync(orgId, provider, { force })
  sendSuccess(res, result, 202)
})

export const getStatus = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const provider = String(req.params.provider)
  const orgId = req.auth!.orgId!
  const job = await syncService.getStatus(orgId, provider)
  sendSuccess(res, job)
})

export const getEntityCounts = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const provider = String(req.params.provider)
  const orgId = req.auth!.orgId!
  const counts = await syncService.getEntityCounts(orgId, provider)
  sendSuccess(res, counts)
})

export const listProducts = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const provider = String(req.params.provider)
  const orgId = req.auth!.orgId!
  const products = await syncService.listProducts(orgId, provider)
  sendSuccess(res, { products })
})

export const updateProductCategories = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const provider = String(req.params.provider)
  const orgId = req.auth!.orgId!
  const { updates } = req.body as { updates: { providerRecordId: string; category: 'recurring' | 'non_recurring' | 'not_sure'; billingFrequency?: 'monthly' | 'quarterly' | 'yearly' }[] }
  await syncService.updateProductCategories(orgId, provider, updates)
  const products = await syncService.listProducts(orgId, provider)
  sendSuccess(res, { products })
})
