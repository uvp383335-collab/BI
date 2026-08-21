import crypto from 'crypto'

/**
 * Generates a URL-safe random token plus its SHA-256 hash.
 * The raw `token` is sent to the user (email link); only `tokenHash` is persisted,
 * so a leaked database never reveals usable tokens.
 */
export function generateToken(): { token: string; tokenHash: string } {
  const token = crypto.randomBytes(32).toString('hex')
  const tokenHash = hashToken(token)
  return { token, tokenHash }
}

export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex')
}
