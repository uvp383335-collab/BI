import { MongoMemoryServer } from 'mongodb-memory-server'
import mongoose from 'mongoose'
import { closeAllTenantConnections } from '../database/tenantConnection'

let mongoServer: MongoMemoryServer

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create()
  const uri = mongoServer.getUri()
  // Tenant connections (per-org databases) derive their URI from MONGO_URI,
  // so it must point at the same in-memory server used by the default connection.
  process.env.MONGO_URI = uri
  await mongoose.connect(uri)
})

afterEach(async () => {
  const collections = mongoose.connection.collections
  for (const key of Object.keys(collections)) {
    await collections[key].deleteMany({})
  }
  await closeAllTenantConnections()
})

afterAll(async () => {
  await closeAllTenantConnections()
  await mongoose.disconnect()
  await mongoServer.stop()
})
