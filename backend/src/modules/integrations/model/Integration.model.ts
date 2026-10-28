import { Schema, Document, Types, Connection, Model } from 'mongoose'

export type IntegrationProvider = 'hubspot' | 'salesforce' | 'quickbooks'

export interface IntegrationDocument extends Document {
  _id: Types.ObjectId
  orgId: Types.ObjectId
  provider: IntegrationProvider
  accessToken: string
  refreshToken: string
  expiresAt: Date
  scope: string[]
  /** Provider-side account identifier (e.g. HubSpot's hub/portal id), for display only. */
  accountId?: string | null
  /** Provider-side account domain/label (e.g. HubSpot's hub domain), for display only. */
  accountDomain?: string | null
  /** Per-account API base URL (e.g. Salesforce's instance_url) — required for providers whose API host varies per connected account, unlike HubSpot's fixed api.hubapi.com. Null for providers that don't need it. */
  instanceUrl?: string | null
  /** When the last sync job for this connection completed successfully; drives incremental syncs and UI display. */
  lastSyncedAt?: Date | null
  connectedBy: Types.ObjectId
  createdAt: Date
  updatedAt: Date
}

export const integrationSchema = new Schema<IntegrationDocument>(
  {
    orgId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    provider: { type: String, enum: ['hubspot', 'salesforce', 'quickbooks'], required: true },
    accessToken: { type: String, required: true },
    refreshToken: { type: String, required: true },
    expiresAt: { type: Date, required: true },
    scope: { type: [String], default: [] },
    accountId: { type: String, default: null },
    accountDomain: { type: String, default: null },
    instanceUrl: { type: String, default: null },
    lastSyncedAt: { type: Date, default: null },
    connectedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true }
  },
  { timestamps: true }
)

// Every tenant database only ever holds this one org's integrations, but the
// index is kept as a safety net / carried over from the pre-tenant-db schema.
integrationSchema.index({ orgId: 1, provider: 1 }, { unique: true })

// Cache one compiled model per tenant connection so repeated calls within the
// same request/process don't re-register (and error on) the model.
const modelCache = new WeakMap<Connection, Model<IntegrationDocument>>()

/** Returns the Integration model bound to the given tenant connection, compiling it once per connection. */
export function getIntegrationModel(connection: Connection): Model<IntegrationDocument> {
  const cached = modelCache.get(connection)
  if (cached) return cached
  const model =
    (connection.models.Integration as Model<IntegrationDocument>) ||
    connection.model<IntegrationDocument>('Integration', integrationSchema)
  modelCache.set(connection, model)
  return model
}
