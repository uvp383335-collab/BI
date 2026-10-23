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
  updateCACSettingsSchema,
  updateHubSpotHistorySourceSchema,
  updateCm04TargetsSchema,
  updateCm08MqlTargetsSchema,
  updateMarketingSpendAccountsSchema
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

// CM-07 Marketing ROI's marketing-spend account picker — options come from the same
// GET /settings/ga-accounts listing (identical P&L expense-account universe), only the save differs.
organizationsRouter.patch(
  '/settings/marketing-accounts',
  requireAuth,
  requireOrgContext,
  requireRole('owner', 'admin'),
  validateBody(updateMarketingSpendAccountsSchema),
  organizationsController.updateMarketingSpendAccounts
)

// CM-04 Pipeline Coverage's new-business targets (operating-plan data no CRM holds) —
// owner/admin-only write, readable by every member through GET /settings like the rest.
organizationsRouter.patch(
  '/settings/cm04-targets',
  requireAuth,
  requireOrgContext,
  requireRole('owner', 'admin'),
  validateBody(updateCm04TargetsSchema),
  organizationsController.updateCm04Targets
)

// CM-08 Lead Volume vs. Plan's monthly MQL plan — same shape and role split as the CM-04 targets above.
organizationsRouter.patch(
  '/settings/cm08-mql-targets',
  requireAuth,
  requireOrgContext,
  requireRole('owner', 'admin'),
  validateBody(updateCm08MqlTargetsSchema),
  organizationsController.updateCm08MqlTargets
)

// HubSpot history source — whether sync reads native history or the `rl_*` imported
// history (see Organization.model.ts). Owner/admin-only, same as every other settings write.
organizationsRouter.patch(
  '/settings/hubspot-history-source',
  requireAuth,
  requireOrgContext,
  requireRole('owner', 'admin'),
  validateBody(updateHubSpotHistorySourceSchema),
  organizationsController.updateHubSpotHistorySource
)
