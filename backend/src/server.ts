import dotenv from 'dotenv'
import { createApp } from './app'
import { connectDatabase } from './database/connection'

dotenv.config()

const app = createApp()

const PORT = process.env.PORT || 4000

connectDatabase()
  .then(() => {
    app.listen(PORT, () => {
      // eslint-disable-next-line no-console
      console.log(`Server running on port ${PORT}`)
    })
  })
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error('Failed to connect to database', err)
    process.exit(1)
  })
