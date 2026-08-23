import { organizationsRepository } from '../repository/organizations.repository'
import { membershipsRepository } from '../repository/memberships.repository'
import { issueTokenPair } from '../../auth/service/tokenIssuer'
import { AppError } from '../../../shared/utils/AppError'
import { OrganizationSettings } from '../model/Organization.model'
import { integrationsRepository } from '../../integrations/repository/integrations.repository'
import { syncService } from '../../sync/service/sync.service'

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
