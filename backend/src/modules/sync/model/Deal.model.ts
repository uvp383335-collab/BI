import { Schema, Document, Types, Connection, Model } from 'mongoose'

export interface DealStageHistoryEntry {
  value: string
  timestamp: Date
}

/**
 * Generic, per-tenant deal record. Lives in the organization's own tenant
 * database (compiled per-connection, same pattern as Integration.model.ts)
 * so that deals synced from different CRM providers (HubSpot, Salesforce,
 * ...) are stored as one unified pool of "this org's deals", distinguished
 * only by `provider` + `providerRecordId`. Includes `dealStageHistory`, the
 * raw timeline of stage changes — this is the only "history" data synced,
 * it powers both the deal-detail view and, exploded into FunnelStageEvent
 * rows at sync time, the deal-stage funnel chart.
 */
export interface DealDocument extends Document {
  _id: Types.ObjectId
  orgId: Types.ObjectId
  provider: string
  providerRecordId: string
  dealname?: string
  amount?: number
  closedate?: Date
  pipeline?: string
  dealstage?: string
  ownerId?: string
  contactIds: string[]
  dealStageHistory: DealStageHistoryEntry[]
  createdAt: Date
  updatedAt: Date
}

const stageHistorySchema = new Schema<DealStageHistoryEntry>(
  {
    value: { type: String, required: true },
    timestamp: { type: Date, required: true }
  },
  { _id: false }
)

const dealSchema = new Schema<DealDocument>(
  {
    orgId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    provider: { type: String, required: true },
    providerRecordId: { type: String, required: true },
    dealname: { type: String },
    amount: { type: Number },
    closedate: { type: Date },
    pipeline: { type: String, index: true },
    dealstage: { type: String },
    ownerId: { type: String, index: true },
    contactIds: { type: [String], default: [] },
    dealStageHistory: { type: [stageHistorySchema], default: [] }
  },
  { timestamps: true }
)

// Every tenant database only ever holds this one org's deals, but orgId is
// kept in the unique key as a safety net, same rationale as Integration.model.ts.
dealSchema.index({ orgId: 1, provider: 1, providerRecordId: 1 }, { unique: true })

// Cache one compiled model per tenant connection so repeated calls within the
// same request/process don't re-register (and error on) the model.
const modelCache = new WeakMap<Connection, Model<DealDocument>>()

/** Returns the Deal model bound to the given tenant connection, compiling it once per connection. */
export function getDealModel(connection: Connection): Model<DealDocument> {
  const cached = modelCache.get(connection)
  if (cached) return cached
  const model = (connection.models.Deal as Model<DealDocument>) || connection.model<DealDocument>('Deal', dealSchema)
  modelCache.set(connection, model)
  return model
}
