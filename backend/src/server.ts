import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import dotenv from 'dotenv'
import { json } from 'body-parser'
import { healthRouter } from './routes/health'
import { errorHandler } from './middleware/errorHandler'

dotenv.config()

const app = express()
app.use(helmet())
app.use(cors())
app.use(json())

app.use('/api/v1/health', healthRouter)

app.use(errorHandler)

const PORT = process.env.PORT || 4000
app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`Server running on port ${PORT}`)
})
