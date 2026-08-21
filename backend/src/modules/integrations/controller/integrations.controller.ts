import { Request, Response } from 'express'
import { asyncHandler } from '../../../shared/utils/asyncHandler'
import { sendSuccess } from '../../../shared/utils/apiResponse'
import * as integrationsService from '../service/integrations.service'
import { syncService } from '../../sync/service/sync.service'

const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173'

export const getAuthorizeUrl = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const provider = String(req.params.provider)
  const orgId = req.auth!.orgId!
  const userId = req.auth!.userId
  const authUrl = await integrationsService.getAuthorizationUrl(orgId, userId, provider)
  console.log(authUrl)
  sendSuccess(res, { authUrl })
})

export const handleCallback = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const provider = String(req.params.provider)
  const { code, state } = req.query

  if (!code || typeof code !== 'string' || !state || typeof state !== 'string') {
    res.redirect(`${FRONTEND_URL}/connect?provider=${provider}&status=error&reason=missing_params`)
    return
  }

  try {
    const { orgId } = await integrationsService.handleCallback(provider, code, state)
    // Kick off the initial data sync in the background; the dashboard the user
    // lands on next will show live progress rather than blocking the redirect on it.
    syncService.startSync(orgId, provider).catch(() => {
      // Sync failures surface via the job status endpoint, not the OAuth redirect.
    })
    res.redirect(`${FRONTEND_URL}/dashboard/${provider}?status=success`)
  } catch {
    res.redirect(`${FRONTEND_URL}/connect?provider=${provider}&status=error`)
  }
})

export const getStatus = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const orgId = req.auth!.orgId!
  const status = await integrationsService.getStatus(orgId)
  sendSuccess(res, status)
})

export const disconnectProvider = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const provider = String(req.params.provider)
  const orgId = req.auth!.orgId!
  await integrationsService.disconnect(orgId, provider)
  sendSuccess(res, { disconnected: true })
})
