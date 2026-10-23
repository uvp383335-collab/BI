import { Request, Response } from 'express'
import { asyncHandler } from '../../../shared/utils/asyncHandler'
import { sendSuccess } from '../../../shared/utils/apiResponse'
import { AppError } from '../../../shared/utils/AppError'
import * as organizationsService from '../service/organizations.service'

const REFRESH_COOKIE_NAME = 'refreshToken'
const isProd = process.env.NODE_ENV === 'production'

function setRefreshCookie(res: Response, token: string) {
  res.cookie(REFRESH_COOKIE_NAME, token, {
    httpOnly: true,
    secure: isProd,
    sameSite: 'lax',
    maxAge: 30 * 24 * 60 * 60 * 1000,
    path: '/api/v1/auth'
  })
}

export const createOrganization = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.auth?.userId
  if (!userId) throw AppError.unauthorized('Not authenticated', 'NOT_AUTHENTICATED')
  const result = await organizationsService.createOrganizationForUser(userId, req.body.name)
  setRefreshCookie(res, result.refreshToken)
  return sendSuccess(res, { accessToken: result.accessToken, organization: result.organization }, 201)
})

export const getSettings = asyncHandler(async (req: Request, res: Response) => {
  const orgId = req.auth!.orgId!
  const settings = await organizationsService.getOrgSettings(orgId)
  return sendSuccess(res, settings)
})

export const updateSettings = asyncHandler(async (req: Request, res: Response) => {
  const orgId = req.auth!.orgId!
  const { salesforceCompetitorSource, salesforceCompetitorField } = req.body as {
    salesforceCompetitorSource: 'field' | 'junction' | null
    salesforceCompetitorField: string | null
  }
  const settings = await organizationsService.updateOrgSettings(orgId, { salesforceCompetitorSource, salesforceCompetitorField })
  return sendSuccess(res, settings)
})

export const updateOpportunityExtraFields = asyncHandler(async (req: Request, res: Response) => {
  const orgId = req.auth!.orgId!
  const { fields } = req.body as { fields: { apiName: string; label: string }[] }
  const settings = await organizationsService.updateSalesforceOpportunityExtraFields(orgId, fields)
  return sendSuccess(res, settings)
})

export const getCashMetricsAccountOptions = asyncHandler(async (req: Request, res: Response) => {
  const orgId = req.auth!.orgId!
  const accounts = await organizationsService.listCashMetricsAccountOptions(orgId)
  return sendSuccess(res, { accounts })
})

export const updateCashMetricsAccounts = asyncHandler(async (req: Request, res: Response) => {
  const orgId = req.auth!.orgId!
  const { cb07ExpenditureAccountIds, cb10AccountsReceivableAccountId, cb10AccountsPayableAccountId, cb10InventoryAccountId } = req.body as {
    cb07ExpenditureAccountIds: string[]
    cb10AccountsReceivableAccountId: string | null
    cb10AccountsPayableAccountId: string | null
    cb10InventoryAccountId: string | null
  }
  const settings = await organizationsService.updateCashMetricsAccountSettings(orgId, {
    cb07ExpenditureAccountIds,
    cb10AccountsReceivableAccountId,
    cb10AccountsPayableAccountId,
    cb10InventoryAccountId
  })
  return sendSuccess(res, settings)
})

export const getGAndAAccountOptions = asyncHandler(async (req: Request, res: Response) => {
  const orgId = req.auth!.orgId!
  const accounts = await organizationsService.listGAndAAccountOptions(orgId)
  return sendSuccess(res, { accounts })
})

export const updateGAndAAccounts = asyncHandler(async (req: Request, res: Response) => {
  const orgId = req.auth!.orgId!
  const { gaExpenseAccountIds } = req.body as { gaExpenseAccountIds: string[] }
  const settings = await organizationsService.updateGAndAAccountSettings(orgId, gaExpenseAccountIds)
  return sendSuccess(res, settings)
})

/** Same account universe as G&A's picker (P&L Expense/Other-Expense leaf accounts) — reuses `listGAndAAccountOptions` directly rather than a near-duplicate function. */
export const getCACAccountOptions = asyncHandler(async (req: Request, res: Response) => {
  const orgId = req.auth!.orgId!
  const accounts = await organizationsService.listGAndAAccountOptions(orgId)
  return sendSuccess(res, { accounts })
})

export const updateCACSettings = asyncHandler(async (req: Request, res: Response) => {
  const orgId = req.auth!.orgId!
  const { cacExpenseAccountIds, cacDurationMonths } = req.body as { cacExpenseAccountIds: string[]; cacDurationMonths: number }
  const settings = await organizationsService.updateCACSettings(orgId, { cacExpenseAccountIds, cacDurationMonths })
  return sendSuccess(res, settings)
})

export const updateMarketingSpendAccounts = asyncHandler(async (req: Request, res: Response) => {
  const orgId = req.auth!.orgId!
  const { marketingSpendAccountIds } = req.body as { marketingSpendAccountIds: string[] }
  const settings = await organizationsService.updateMarketingSpendAccountSettings(orgId, marketingSpendAccountIds)
  return sendSuccess(res, settings)
})

export const updateCm04Targets = asyncHandler(async (req: Request, res: Response) => {
  const orgId = req.auth!.orgId!
  const { targets } = req.body as { targets: { fromMonth: string; toMonth: string; targetAmount: number }[] }
  const settings = await organizationsService.updateCm04Targets(orgId, targets)
  return sendSuccess(res, settings)
})

export const updateCm08MqlTargets = asyncHandler(async (req: Request, res: Response) => {
  const orgId = req.auth!.orgId!
  const { targets } = req.body as { targets: { fromMonth: string; toMonth: string; targetCount: number }[] }
  const settings = await organizationsService.updateCm08MqlTargets(orgId, targets)
  return sendSuccess(res, settings)
})

export const updateHubSpotHistorySource = asyncHandler(async (req: Request, res: Response) => {
  const orgId = req.auth!.orgId!
  const { hubspotUseImportedHistory } = req.body as { hubspotUseImportedHistory: boolean }
  const settings = await organizationsService.updateHubSpotHistorySource(orgId, hubspotUseImportedHistory)
  return sendSuccess(res, settings)
})
