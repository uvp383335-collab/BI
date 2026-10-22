import rateLimit from 'express-rate-limit'

const standardOptions = {
  standardHeaders: true,
  legacyHeaders: false,
  // Rate limiting is disabled under test so integration tests can exercise flows
  // (many signups/logins in a single run) without tripping limits meant for production abuse.
  skip: () => process.env.NODE_ENV === 'test',
  message: { success: false, error: { message: 'Too many requests, please try again later.', code: 'RATE_LIMITED' } }
}

export const loginRateLimiter = rateLimit({
  ...standardOptions,
  windowMs: 15 * 60 * 1000,
  limit: 10
})

export const signupRateLimiter = rateLimit({
  ...standardOptions,
  windowMs: 60 * 60 * 1000,
  limit: 5
})

export const resendVerificationRateLimiter = rateLimit({
  ...standardOptions,
  windowMs: 15 * 60 * 1000,
  limit: 3
})

export const forgotPasswordRateLimiter = rateLimit({
  ...standardOptions,
  windowMs: 15 * 60 * 1000,
  limit: 3
})

export const invitationRateLimiter = rateLimit({
  ...standardOptions,
  windowMs: 60 * 60 * 1000,
  limit: 20
})

// Each new org provisions its own tenant database/connection, so cap creation
// rate to avoid abuse spinning up excessive tenant DBs/connections.
export const createOrgRateLimiter = rateLimit({
  ...standardOptions,
  windowMs: 60 * 60 * 1000,
  limit: 10
})
