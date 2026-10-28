import { Schema, Document, Types, Connection, Model } from 'mongoose'

/**
 * Generic, per-tenant Salesforce Account record. Deliberately narrow (`Id`/
 * `Name`/`ParentId` only, per the existing narrow-sync policy) — this app
 * doesn't treat Account as its Contact entity (Leads are, see
 * crm-integrations skill's Salesforce section); it exists solely to resolve
 * subsidiary hierarchy for CM-02's customer-concentration grouping.
 * Salesforce-only, unlike Contact/Deal — there's no equivalent "Company"
 * object synced from HubSpot in this app.
 */
export interface SalesforceAccountDocument extends Document {
  _id: Types.ObjectId
  orgId: Types.ObjectId
  provider: string
  providerRecordId: string
  name?: string
  parentRecordId?: string
  createdAt: Date
  updatedAt: Date
}

const salesforceAccountSchema = new Schema<SalesforceAccountDocument>(
  {
    orgId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    provider: { type: String, required: true },
    providerRecordId: { type: String, required: true },
    name: { type: String },
    parentRecordId: { type: String }
  },
  { timestamps: true }
)

salesforceAccountSchema.index({ orgId: 1, provider: 1, providerRecordId: 1 }, { unique: true })

const modelCache = new WeakMap<Connection, Model<SalesforceAccountDocument>>()

/** Returns the SalesforceAccount model bound to the given tenant connection, compiling it once per connection. */
export function getSalesforceAccountModel(connection: Connection): Model<SalesforceAccountDocument> {
  const cached = modelCache.get(connection)
  if (cached) return cached
  const model =
    (connection.models.SalesforceAccount as Model<SalesforceAccountDocument>) ||
    connection.model<SalesforceAccountDocument>('SalesforceAccount', salesforceAccountSchema)
  modelCache.set(connection, model)
  return model
}
