import { Router } from 'express'
import * as organizationsController from '../controller/organizations.controller'
import { requireAuth, requireOrgContext } from '../../../middleware/auth'
import { requireRole } from '../../../middleware/rbac'
import { validateBody } from '../../../middleware/validate'
import {
  createOrganizationSchema,
  updateOrganizationSettingsSchema,
  updateSalesforceOpportunityExtraFieldsSchema,
  updateCashMetricsAccountsSchema,
  updateGAndAAccountsSchema,
  updateCACSettingsSchema
} from '../validator/organizations.validator'
import { createOrgRateLimiter } from '../../../middleware/rateLimit'

export const organizationsRouter = Router()

// Any authenticated user (regardless of which org, if any, their current
// token is scoped to) can create a brand new organization and becomes its
// owner immediately — this is the "Add organization" action post-login.
organizationsRouter.post(
  '/',
  requireAuth,
  createOrgRateLimiter,
  validateBody(createOrganizationSchema),
  organizationsController.createOrganization
)

// Any org member can view settings (CM-03 needs to read the configured
// competitor field to render "not computable" correctly); only owners/admins
// can change them — same role split as sync's manual-trigger endpoint.
organizationsRouter.get('/settings', requireAuth, requireOrgContext, organizationsController.getSettings)
organizationsRouter.patch(
  '/settings',
  requireAuth,
  requireOrgContext,
  requireRole('owner', 'admin'),
  validateBody(updateOrganizationSettingsSchema),
  organizationsController.updateSettings
)
organizationsRouter.patch(
  '/settings/salesforce-opportunity-fields',
  requireAuth,
  requireOrgContext,
  requireRole('owner', 'admin'),
  validateBody(updateSalesforceOpportunityExtraFieldsSchema),
  organizationsController.updateOpportunityExtraFields
)

// CB-07/CB-10's account pickers (docs/server.js's dropdown-selection pattern, mirrored here as a
// settings-driven config instead of a per-request query param — see cbMetrics.service.ts). The
// options list is a live QuickBooks read (any org member); saving the selection is owner/admin-only,
// same role split as every other settings write on this router.
organizationsRouter.get('/settings/quickbooks-accounts', requireAuth, requireOrgContext, organizationsController.getCashMetricsAccountOptions)
organizationsRouter.patch(
  '/settings/cash-metrics-accounts',
  requireAuth,
  requireOrgContext,
  requireRole('owner', 'admin'),
  validateBody(updateCashMetricsAccountsSchema),
  organizationsController.updateCashMetricsAccounts
)

// G&A % of Revenue's account picker — same live-read/owner-admin-write split as the
// cash-metrics accounts above, just sourced from the P&L report's expense accounts instead.
organizationsRouter.get('/settings/ga-accounts', requireAuth, requireOrgContext, organizationsController.getGAndAAccountOptions)
organizationsRouter.patch(
  '/settings/ga-accounts',
  requireAuth,
  requireOrgContext,
  requireRole('owner', 'admin'),
  validateBody(updateGAndAAccountsSchema),
  organizationsController.updateGAndAAccounts
)

// Customer Acquisition Cost's account + duration picker — same identical account universe as
// G&A's picker above (reuses getCACAccountOptions -> listGAndAAccountOptions), plus a duration
// (in months) saved alongside the account selection.
organizationsRouter.get('/settings/cac-accounts', requireAuth, requireOrgContext, organizationsController.getCACAccountOptions)
organizationsRouter.patch(
  '/settings/cac-accounts',
  requireAuth,
  requireOrgContext,
  requireRole('owner', 'admin'),
  validateBody(updateCACSettingsSchema),
  organizationsController.updateCACSettings
)
