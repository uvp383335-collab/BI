import mongoose, { Connection } from 'mongoose'
import { OrganizationModel } from '../modules/organizations/model/Organization.model'

/**
 * Manages one MongoDB connection per tenant database, all on the same cluster
 * (MONGO_URI), so each organization's tenant-scoped data (e.g. Integration
 * tokens) lives in its own isolated database while control-plane data
 * (User/Organization/Membership) stays on the default connection.
 *
 * Connections are cached by dbName and lazily created on first use. Idle
 * connections are closed after a timeout so the pool doesn't grow unbounded
 * as more tenants are onboarded.
 */

const IDLE_TIMEOUT_MS = 30 * 60 * 1000 // close a tenant connection after 30 min of no use

interface CachedConnection {
  connection: Connection
  lastUsedAt: number
  idleTimer: NodeJS.Timeout
}

const connectionCache = new Map<string, CachedConnection>()

/** Derives the base cluster URI (everything up to the database segment) from MONGO_URI. */
function getBaseUri(): string {
  const uri = process.env.MONGO_URI
  if (!uri) {
    throw new Error('MONGO_URI is not set')
  }
  return uri
}

/** Builds a tenant-specific connection URI by swapping in the tenant's database name. */
function buildTenantUri(dbName: string): string {
  const base = getBaseUri()
  // Supports both mongodb:// and mongodb+srv:// forms, and URIs with or without
  // an existing db path segment / query string.
  const [withoutQuery, query] = base.split('?')
  const trimmed = withoutQuery.replace(/\/$/, '')
  const lastSlash = trimmed.lastIndexOf('/')
  const protocolEnd = trimmed.indexOf('://') + 3
  const hasDbSegment = lastSlash > trimmed.indexOf('://') + 3 && lastSlash > protocolEnd
  const base2 = hasDbSegment ? trimmed.slice(0, lastSlash) : trimmed
  return `${base2}/${dbName}${query ? `?${query}` : ''}`
}

function scheduleEviction(dbName: string) {
  const cached = connectionCache.get(dbName)
  if (!cached) return
  clearTimeout(cached.idleTimer)
  cached.idleTimer = setTimeout(() => {
    const entry = connectionCache.get(dbName)
    if (!entry) return
    // Only evict if nothing has touched this connection since the timer was set.
    if (Date.now() - entry.lastUsedAt >= IDLE_TIMEOUT_MS) {
      connectionCache.delete(dbName)
      entry.connection.close().catch(() => {
        // Best-effort close; nothing actionable if it fails during eviction.
      })
    }
  }, IDLE_TIMEOUT_MS)
  cached.idleTimer.unref?.()
}

/**
 * Returns an open, ready-to-use connection for the given tenant database,
 * opening a new one on first access and reusing it thereafter.
 */
export async function getTenantConnectionByDbName(dbName: string): Promise<Connection> {
  if (!dbName) {
    throw new Error('dbName is required to resolve a tenant connection')
  }

  const cached = connectionCache.get(dbName)
  if (cached) {
    cached.lastUsedAt = Date.now()
    scheduleEviction(dbName)
    return cached.connection
  }

  const connection = mongoose.createConnection(buildTenantUri(dbName))
  await new Promise<void>((resolve, reject) => {
    connection.once('open', () => resolve())
    connection.once('error', (err) => reject(err))
  })

  const entry: CachedConnection = {
    connection,
    lastUsedAt: Date.now(),
    idleTimer: setTimeout(() => {}, 0)
  }
  connectionCache.set(dbName, entry)
  scheduleEviction(dbName)

  connection.on('error', () => {
    // Drop the bad connection from the cache so the next request re-opens it,
    // rather than repeatedly handing out a broken connection.
    connectionCache.delete(dbName)
  })

  return connection
}

// orgId -> dbName cache, so resolving a tenant connection from an orgId doesn't
// require a control-plane DB round-trip on every call. dbName is immutable
// once assigned (see Organization.model.ts), so this cache never goes stale.
const orgDbNameCache = new Map<string, string>()

/**
 * Resolves an organization's tenant connection from its orgId, looking up
 * (and caching) the org's dbName from the control-plane Organization collection.
 */
export async function getTenantConnection(orgId: string): Promise<Connection> {
  let dbName = orgDbNameCache.get(orgId)
  if (!dbName) {
    const org = await OrganizationModel.findById(orgId).select('dbName').lean()
    if (!org?.dbName) {
      throw new Error(`No dbName found for organization ${orgId}`)
    }
    dbName = org.dbName
    orgDbNameCache.set(orgId, dbName)
  }
  return getTenantConnectionByDbName(dbName)
}

/** Closes and evicts every cached tenant connection. Call during graceful shutdown. */
export async function closeAllTenantConnections(): Promise<void> {
  const entries = Array.from(connectionCache.values())
  connectionCache.clear()
  await Promise.all(
    entries.map((entry) => {
      clearTimeout(entry.idleTimer)
      return entry.connection.close().catch(() => {
        // Best-effort; shutdown continues regardless.
      })
    })
  )
}
