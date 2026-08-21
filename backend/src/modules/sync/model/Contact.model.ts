import { Schema, Document, Types, Connection, Model } from 'mongoose'

/**
 * Generic, per-tenant contact record. Lives in the organization's own tenant
 * database (compiled per-connection, same pattern as Integration.model.ts)
 * so that contacts synced from different CRM providers (HubSpot, Salesforce,
 * ...) are stored as one unified pool of "this org's contacts", distinguished
 * only by `provider` + `providerRecordId`. Only the fields needed for
 * dashboard stats are stored — no email-engagement/marketing data is synced.
 */
export interface LifecycleStageHistoryEntry {
  value: string
  timestamp: Date
}

export interface ContactDocument extends Document {
  _id: Types.ObjectId
  orgId: Types.ObjectId
  provider: string
  providerRecordId: string
  email?: string
  firstname?: string
  lastname?: string
  lifecycleStage?: string
  leadStatus?: string
  lifecycleStageHistory: LifecycleStageHistoryEntry[]
  createdAt: Date
  updatedAt: Date
}

const stageHistorySchema = new Schema<LifecycleStageHistoryEntry>(
  {
    value: { type: String, required: true },
    timestamp: { type: Date, required: true }
  },
  { _id: false }
)

const contactSchema = new Schema<ContactDocument>(
  {
    orgId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    provider: { type: String, required: true },
    providerRecordId: { type: String, required: true },
    email: { type: String },
    firstname: { type: String },
    lastname: { type: String },
    lifecycleStage: { type: String },
    leadStatus: { type: String },
    lifecycleStageHistory: { type: [stageHistorySchema], default: [] }
  },
  { timestamps: true }
)

// Every tenant database only ever holds this one org's contacts, but orgId is
// kept in the unique key as a safety net, same rationale as Integration.model.ts.
contactSchema.index({ orgId: 1, provider: 1, providerRecordId: 1 }, { unique: true })

// Cache one compiled model per tenant connection so repeated calls within the
// same request/process don't re-register (and error on) the model.
const modelCache = new WeakMap<Connection, Model<ContactDocument>>()

/** Returns the Contact model bound to the given tenant connection, compiling it once per connection. */
export function getContactModel(connection: Connection): Model<ContactDocument> {
  const cached = modelCache.get(connection)
  if (cached) return cached
  const model =
    (connection.models.Contact as Model<ContactDocument>) || connection.model<ContactDocument>('Contact', contactSchema)
  modelCache.set(connection, model)
  return model
}
