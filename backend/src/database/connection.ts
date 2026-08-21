import mongoose from 'mongoose'

/**
 * Connects to MongoDB using MONGO_URI. Call once during server startup.
 */
export async function connectDatabase(): Promise<void> {
  const uri = process.env.MONGO_URI
  if (!uri) {
    throw new Error('MONGO_URI is not set')
  }
  mongoose.set('strictQuery', true)
  await mongoose.connect(uri)
  // eslint-disable-next-line no-console
  console.log('Connected to MongoDB')
}
