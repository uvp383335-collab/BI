import dotenv from 'dotenv'
import { createApp } from './app'
import { connectDatabase } from './database/connection'
import { closeAllTenantConnections } from './database/tenantConnection'

dotenv.config()

const app = createApp()

const PORT = process.env.PORT || 4000

connectDatabase()
  .then(() => {
    const server = app.listen(PORT, () => {
      // eslint-disable-next-line no-console
      console.log(`Server running on port ${PORT}`)
    })

    const shutdown = () => {
      server.close(() => {
        closeAllTenantConnections()
          .catch(() => {
            // Best-effort; the process is exiting regardless.
          })
          .finally(() => process.exit(0))
      })
    }
    process.on('SIGTERM', shutdown)
    process.on('SIGINT', shutdown)
  })
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error('Failed to connect to database', err)
    process.exit(1)
  })
