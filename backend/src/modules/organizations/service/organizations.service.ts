import { organizationsRepository } from '../repository/organizations.repository'
import { membershipsRepository } from '../repository/memberships.repository'
import { issueTokenPair } from '../../auth/service/tokenIssuer'
import { AppError } from '../../../shared/utils/AppError'
import { OrganizationSettings, Cm04Target, Cm08MqlTarget } from '../model/Organization.model'
import { integrationsRepository } from '../../integrations/repository/integrations.repository'
import { syncService } from '../../sync/service/sync.service'
import { funnelStageEventRepository } from '../../sync/repository/funnelStageEvent.repository'
import { syncJobRepository } from '../../sync/repository/syncJob.repository'
import { getQuickBooksAuth } from '../../metrics/service/plReport.service'
import { QuickBooksService } from '../../integrations/service/quickbooks.service'
import { extractLeafAccounts, LeafAccount } from '../../metrics/service/reportParser'

/** Lowercases, strips non-alphanumerics to hyphens, trims leading/trailing hyphens. */
function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)+/g, '')
}

/**
 * Generates a unique slug for a new organization by appending a numeric
 * suffix if the base slug is already taken.
 */
export async function generateUniqueSlug(name: string): Promise<string> {
  const base = slugify(name) || 'org'
  let candidate = base
  let suffix = 1
  // eslint-disable-next-line no-await-in-loop
  while (await organizationsRepository.slugExists(candidate)) {
    suffix += 1
    candidate = `${base}-${suffix}`
  }
  return candidate
}

/**
 * Lets an already-authenticated user spin up a brand new organization (e.g.
 * via "Add organization" after login), becoming its owner immediately. Each
 * org gets its own dedicated tenant database (assigned at creation time),
 * fully isolated from every other org's data, including this same user's
 * other organizations.
 */
export async function createOrganizationForUser(userId: string, name: string) {
  const slug = await generateUniqueSlug(name)
  const org = await organizationsRepository.create({ name, slug })
  await membershipsRepository.create({ userId, orgId: org._id, role: 'owner', status: 'active' })

  // Immediately issue tokens scoped to the new org so the user lands directly
  // on its connect screen, mirroring the post-signup / select-org experience.
  const tokens = await issueTokenPair(userId, org._id.toString(), 'owner')
  return {
    ...tokens,
    organization: { id: org._id.toString(), name: org.name, slug: org.slug, role: 'owner' as const }
  }
}

export async function getOrgSettings(orgId: string): Promise<OrganizationSettings> {
  const org = await organizationsRepository.findById(orgId)
  if (!org) throw AppError.notFound('Organization not found', 'ORGANIZATION_NOT_FOUND')
  return org.settings ?? {}
}

export async function updateOrgSettings(
  orgId: string,
  settings: { salesforceCompetitorSource: 'field' | 'junction' | null; salesforceCompetitorField: string | null }
): Promise<OrganizationSettings> {
  const org = await organizationsRepository.updateSalesforceCompetitorSettings(orgId, settings)
  if (!org) throw AppError.notFound('Organization not found', 'ORGANIZATION_NOT_FOUND')

  // This setting changes what Salesforce sync actually pulls (which field, or the
  // OpportunityCompetitor object) — an already-connected org's existing Opportunities
  // won't have that data yet, and an ordinary incremental sync would never revisit
  // them (it only re-fetches records that changed in Salesforce, not ones affected by
  // a *local* config change). A forced full resync is the only way to backfill it.
  // Fire-and-forget, same pattern as the OAuth-callback's post-connect sync kickoff —
  // this settings save shouldn't block on however long a full Salesforce sync takes.
  const salesforceConnected = await integrationsRepository.findByOrgAndProvider(orgId, 'salesforce')
  if (salesforceConnected) {
    syncService.startSync(orgId, 'salesforce', { force: true }).catch(() => {
      // Sync failures surface via the job status endpoint, not this settings save.
    })
  }

  return org.settings ?? {}
}

/**
 * Per-org custom Opportunity detail fields (Order Number, Current
 * Generator(s), etc. — Organization.model.ts). Same forced-full-resync
 * rationale as updateOrgSettings above: this changes what the Opportunity
 * SOQL query pulls, and an incremental sync would never revisit
 * already-synced Opportunities just because a *local* config changed.
 */
export async function updateSalesforceOpportunityExtraFields(
  orgId: string,
  fields: { apiName: string; label: string }[]
): Promise<OrganizationSettings> {
  const org = await organizationsRepository.updateSalesforceOpportunityExtraFields(orgId, fields)
  if (!org) throw AppError.notFound('Organization not found', 'ORGANIZATION_NOT_FOUND')

  const salesforceConnected = await integrationsRepository.findByOrgAndProvider(orgId, 'salesforce')
  if (salesforceConnected) {
    syncService.startSync(orgId, 'salesforce', { force: true }).catch(() => {
      // Sync failures surface via the job status endpoint, not this settings save.
    })
  }

  return org.settings ?? {}
}

/**
 * CB-07/CB-10's account pickers (Organization.model.ts). Unlike the
 * Salesforce settings above, this never needs a forced resync: every leaf
 * account's amount is already captured into `PLSnapshot.accountAmounts` on
 * every sync regardless of which accounts are currently configured (see
 * `sync.service.ts`), so changing the selection just changes which already-
 * stored numbers `cbMetrics.service.ts` reads next time.
 */
export async function updateCashMetricsAccountSettings(
  orgId: string,
  settings: {
    cb07ExpenditureAccountIds: string[]
    cb10AccountsReceivableAccountId: string | null
    cb10AccountsPayableAccountId: string | null
    cb10InventoryAccountId: string | null
  }
): Promise<OrganizationSettings> {
  const org = await organizationsRepository.updateCashMetricsAccountSettings(orgId, settings)
  if (!org) throw AppError.notFound('Organization not found', 'ORGANIZATION_NOT_FOUND')
  return org.settings ?? {}
}

/**
 * Lists the QuickBooks accounts an org can choose from for CB-07's
 * expenditure accounts and CB-10's A/R, A/P, and Inventory accounts — read
 * live off the current Cash Flow + Balance Sheet reports (same reports
 * `sync.service.ts` already pulls), not a separate Chart-of-Accounts call,
 * per `extractLeafAccounts`'s own "only accounts already inside the
 * relevant report" rule. A live call is acceptable here (unlike the metrics
 * themselves) since this only runs when an admin opens the settings page,
 * not on every dashboard view.
 */
export async function listCashMetricsAccountOptions(orgId: string): Promise<LeafAccount[]> {
  const { accessToken, realmId } = await getQuickBooksAuth(orgId)
  const today = new Date().toISOString().slice(0, 10)
  const oneYearAgo = new Date(new Date(today).setFullYear(new Date(today).getFullYear() - 1)).toISOString().slice(0, 10)

  const [cashFlowReport, balanceSheetReport] = await Promise.all([
    QuickBooksService.getCashFlowReport(accessToken, realmId, oneYearAgo, today),
    QuickBooksService.getBalanceSheetReport(accessToken, realmId, today)
  ])

  const byId = new Map<string, LeafAccount>()
  for (const account of [...extractLeafAccounts(cashFlowReport), ...extractLeafAccounts(balanceSheetReport)]) {
    byId.set(account.id, account)
  }
  return [...byId.values()]
}

/**
 * Lists the QuickBooks P&L expense accounts an org can choose from for G&A %
 * of Revenue's account picker — read live off the current Profit & Loss
 * report's Expense/Other-Expense sections (the only sections a G&A account
 * could ever sensibly come from), not a separate Chart-of-Accounts call,
 * same "only accounts already inside the relevant report" rule as
 * `listCashMetricsAccountOptions`. A live call is acceptable here for the
 * same reason as that one: this only runs when an admin opens the settings
 * page, not on every dashboard view.
 */
export async function listGAndAAccountOptions(orgId: string): Promise<LeafAccount[]> {
  const { accessToken, realmId } = await getQuickBooksAuth(orgId)
  const today = new Date().toISOString().slice(0, 10)
  const oneYearAgo = new Date(new Date(today).setFullYear(new Date(today).getFullYear() - 1)).toISOString().slice(0, 10)

  const report = await QuickBooksService.getProfitAndLossReport(accessToken, realmId, oneYearAgo, today)
  return extractLeafAccounts(report).filter((account) => account.section === 'Expenses' || account.section === 'OtherExpenses')
}

/**
 * G&A % of Revenue's account picker (Organization.model.ts). Like CB-07/
 * CB-10 above, never needs a forced resync — every P&L expense line item is
 * already captured per quarter/month regardless of which accounts are
 * currently configured; changing the selection just changes which
 * already-stored line items gaExpenseTrend.service.ts sums next time.
 */
export async function updateGAndAAccountSettings(orgId: string, gaExpenseAccountIds: string[]): Promise<OrganizationSettings> {
  const org = await organizationsRepository.updateGAndAAccountSettings(orgId, gaExpenseAccountIds)
  if (!org) throw AppError.notFound('Organization not found', 'ORGANIZATION_NOT_FOUND')
  return org.settings ?? {}
}

/**
 * Customer Acquisition Cost's account + duration picker. No dedicated
 * account-listing function here — the CAC picker's options are the
 * identical universe as G&A's (P&L Expense/Other-Expense leaf accounts), so
 * callers reuse `listGAndAAccountOptions` directly.
 */
export async function updateCACSettings(orgId: string, settings: { cacExpenseAccountIds: string[]; cacDurationMonths: number }): Promise<OrganizationSettings> {
  const org = await organizationsRepository.updateCACSettings(orgId, settings)
  if (!org) throw AppError.notFound('Organization not found', 'ORGANIZATION_NOT_FOUND')
  return org.settings ?? {}
}

/**
 * CM-04's new-business targets (Organization.model.ts). Like the QuickBooks
 * account pickers above, never needs a resync: CM-04 reads the targets at
 * compute time, against deals that are already synced.
 */
export async function updateCm04Targets(orgId: string, targets: Cm04Target[]): Promise<OrganizationSettings> {
  const org = await organizationsRepository.updateCm04Targets(orgId, targets)
  if (!org) throw AppError.notFound('Organization not found', 'ORGANIZATION_NOT_FOUND')
  return org.settings ?? {}
}

/**
 * CM-07's marketing-spend account picker. No dedicated account-listing
 * function — the options are the same P&L Expense/Other-Expense leaf
 * accounts as G&A's, so callers reuse `listGAndAAccountOptions` (CAC does
 * the same). No resync: every P&L line is already stored per quarter.
 */
export async function updateMarketingSpendAccountSettings(orgId: string, marketingSpendAccountIds: string[]): Promise<OrganizationSettings> {
  const org = await organizationsRepository.updateMarketingSpendAccountSettings(orgId, marketingSpendAccountIds)
  if (!org) throw AppError.notFound('Organization not found', 'ORGANIZATION_NOT_FOUND')
  return org.settings ?? {}
}

/** CM-08's monthly MQL plan (Organization.model.ts) — read at compute time like CM-04's targets, so no resync. */
export async function updateCm08MqlTargets(orgId: string, targets: Cm08MqlTarget[]): Promise<OrganizationSettings> {
  const org = await organizationsRepository.updateCm08MqlTargets(orgId, targets)
  if (!org) throw AppError.notFound('Organization not found', 'ORGANIZATION_NOT_FOUND')
  return org.settings ?? {}
}

/**
 * HubSpot history source (Organization.model.ts). Same forced-full-resync
 * rationale as the Salesforce settings above: switching it changes where
 * HubSpot sync reads stage history from, and an incremental sync would never
 * revisit already-synced contacts/deals just because a *local* config changed.
 * On an actual switch, the stored HubSpot stage events are cleared first —
 * they only ever accumulate, so the old source's dates would otherwise sit
 * next to the new source's and skew every funnel cohort.
 */
export async function updateHubSpotHistorySource(orgId: string, hubspotUseImportedHistory: boolean): Promise<OrganizationSettings> {
  const before = await organizationsRepository.findById(orgId)
  if (!before) throw AppError.notFound('Organization not found', 'ORGANIZATION_NOT_FOUND')
  const switched = (before.settings?.hubspotUseImportedHistory ?? false) !== hubspotUseImportedHistory
  // A sync already running read the old setting when it started and would keep
  // writing that source's events after the clear below.
  if (switched && (await syncJobRepository.findActiveByOrgAndProvider(orgId, 'hubspot'))) {
    throw AppError.conflict('A HubSpot sync is running — try again once it finishes', 'HUBSPOT_SYNC_IN_PROGRESS')
  }

  const org = await organizationsRepository.updateHubSpotHistorySource(orgId, hubspotUseImportedHistory)
  if (!org) throw AppError.notFound('Organization not found', 'ORGANIZATION_NOT_FOUND')

  const hubspotConnected = await integrationsRepository.findByOrgAndProvider(orgId, 'hubspot')
  if (hubspotConnected && switched) {
    await funnelStageEventRepository.deleteForProvider(orgId, 'hubspot')
    syncService.startSync(orgId, 'hubspot', { force: true }).catch(() => {
      // Sync failures surface via the job status endpoint, not this settings save.
    })
  }

  return org.settings ?? {}
}
