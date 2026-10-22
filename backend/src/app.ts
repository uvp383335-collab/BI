import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import cookieParser from 'cookie-parser'
import { json } from 'body-parser'
import { healthRouter } from './routes/health'
import { authRouter } from './modules/auth/routes/auth.routes'
import { verificationRouter } from './modules/verification/routes/verification.routes'
import { invitationsRouter } from './modules/invitations/routes/invitations.routes'
import { integrationsRouter } from './modules/integrations/routes/integrations.routes'
import { organizationsRouter } from './modules/organizations/routes/organizations.routes'
import { syncRouter } from './modules/sync/routes/sync.routes'
import { analyticsRouter } from './modules/sync/routes/analytics.routes'
import { metricsRouter } from './modules/metrics/routes/metrics.routes'
import { errorHandler } from './middleware/errorHandler'

/**
 * Builds the Express application without starting the HTTP listener or
 * connecting to the database, so it can be mounted directly in tests (supertest).
 */
export function createApp() {
  const app = express()
  app.use(helmet())
  app.use(cors({ origin: process.env.FRONTEND_URL || 'http://localhost:5173', credentials: true }))
  app.use(json())
  app.use(cookieParser())

  app.use('/api/v1/health', healthRouter)
  app.use('/api/v1/auth', authRouter)
  app.use('/api/v1/auth', verificationRouter)
  app.use('/api/v1/invitations', invitationsRouter)
  app.use('/api/v1/organizations', organizationsRouter)
  app.use('/api/v1/integrations', integrationsRouter)
  app.use('/api/v1/sync', syncRouter)
  app.use('/api/v1/analytics', analyticsRouter)
  app.use('/api/v1/metrics', metricsRouter)

  app.use(errorHandler)
  return app
}
