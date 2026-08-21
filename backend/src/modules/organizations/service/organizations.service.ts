import { organizationsRepository } from '../repository/organizations.repository'
import { membershipsRepository } from '../repository/memberships.repository'
import { issueTokenPair } from '../../auth/service/tokenIssuer'

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
