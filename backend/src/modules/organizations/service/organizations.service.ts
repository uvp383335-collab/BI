import { organizationsRepository } from '../repository/organizations.repository'

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
