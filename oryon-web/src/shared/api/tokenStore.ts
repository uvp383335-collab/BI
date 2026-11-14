/**
 * In-memory store for the current access token. Kept out of localStorage to
 * reduce XSS token-theft exposure; the refresh token lives in an httpOnly cookie.
 * Lost on full page reload — the app calls /auth/refresh on bootstrap to recover it.
 */
let accessToken: string | null = null

export function getAccessToken(): string | null {
  return accessToken
}

export function setAccessToken(token: string | null): void {
  accessToken = token
}
