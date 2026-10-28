import { Request, Response } from 'express'
import { asyncHandler } from '../../../shared/utils/asyncHandler'
import { sendSuccess } from '../../../shared/utils/apiResponse'
import * as integrationsService from '../service/integrations.service'
import { syncService } from '../../sync/service/sync.service'
import { AppError } from '../../../shared/utils/AppError'

const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173'

export const getAuthorizeUrl = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const provider = String(req.params.provider)
  const orgId = req.auth!.orgId!
  const userId = req.auth!.userId
  const authUrl = await integrationsService.getAuthorizationUrl(orgId, userId, provider)
  sendSuccess(res, { authUrl })
})

// Providers with a working sync.service implementation.
const SYNC_IMPLEMENTED_PROVIDERS = ['hubspot', 'salesforce', 'quickbooks']

export const handleCallback = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const provider = String(req.params.provider)
  const { code, state, realmId } = req.query

  if (!code || typeof code !== 'string' || !state || typeof state !== 'string') {
    res.redirect(`${FRONTEND_URL}/connect?provider=${provider}&status=error&reason=missing_params`)
    return
  }

  try {
    const { orgId } = await integrationsService.handleCallback(
      provider,
      code,
      state,
      typeof realmId === 'string' ? realmId : undefined
    )
    if (SYNC_IMPLEMENTED_PROVIDERS.includes(provider)) {
      // Kick off the initial data sync in the background; the dashboard the user
      // lands on next will show live progress rather than blocking the redirect on it.
      syncService.startSync(orgId, provider).catch(() => {
        // Sync failures surface via the job status endpoint, not the OAuth redirect.
      })
    }
    // The dashboard is unified per tenant, not per provider (no more /dashboard/:provider) —
    // every connected provider gets its own section on the same page.
    res.redirect(`${FRONTEND_URL}/dashboard?status=success`)
  } catch (err) {
    if (err instanceof AppError && err.code.endsWith('_ALREADY_CONNECTED_SWITCH')) {
      const details = err.details as { orgId?: string; orgName?: string; orgSlug?: string } | undefined
      const params = new URLSearchParams({
        provider,
        status: 'error',
        reason: 'already_connected_switch',
        orgId: details?.orgId ?? '',
        orgName: details?.orgName ?? '',
        orgSlug: details?.orgSlug ?? ''
      })
      res.redirect(`${FRONTEND_URL}/connect?${params.toString()}`)
      return
    }
    if (err instanceof AppError && err.code.endsWith('_ALREADY_CONNECTED_REQUEST_ACCESS')) {
      res.redirect(`${FRONTEND_URL}/connect?provider=${provider}&status=error&reason=already_connected_request_access`)
      return
    }
    if (err instanceof AppError && err.code.endsWith('_ORG_LOCKED_TO_ACCOUNT')) {
      res.redirect(`${FRONTEND_URL}/connect?provider=${provider}&status=error&reason=org_locked_to_account`)
      return
    }
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
