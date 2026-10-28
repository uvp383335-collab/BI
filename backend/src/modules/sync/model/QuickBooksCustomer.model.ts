import { Schema, Document, Types, Connection, Model } from 'mongoose'

/**
 * Generic, per-tenant billing-customer record — QuickBooks' `Customer` object.
 * Lives in the organization's own tenant database, same pattern as
 * Contact/Deal. `parentRecordId` mirrors QuickBooks `Customer.ParentRef` —
 * captured now (it costs nothing extra, same API payload) even though the
 * subsidiary-grouping logic that consumes it (CM-02) isn't built yet, so a
 * later phase doesn't need a resync just to backfill this field.
 */
export interface QuickBooksCustomerDocument extends Document {
  _id: Types.ObjectId
  orgId: Types.ObjectId
  provider: string
  providerRecordId: string
  displayName?: string
  parentRecordId?: string
  active: boolean
  createdAt: Date
  updatedAt: Date
}

const quickBooksCustomerSchema = new Schema<QuickBooksCustomerDocument>(
  {
    orgId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    provider: { type: String, required: true },
    providerRecordId: { type: String, required: true },
    displayName: { type: String },
    parentRecordId: { type: String },
    active: { type: Boolean, default: true }
  },
  { timestamps: true }
)

quickBooksCustomerSchema.index({ orgId: 1, provider: 1, providerRecordId: 1 }, { unique: true })

const modelCache = new WeakMap<Connection, Model<QuickBooksCustomerDocument>>()

/** Returns the QuickBooksCustomer model bound to the given tenant connection, compiling it once per connection. */
export function getQuickBooksCustomerModel(connection: Connection): Model<QuickBooksCustomerDocument> {
  const cached = modelCache.get(connection)
  if (cached) return cached
  const model =
    (connection.models.QuickBooksCustomer as Model<QuickBooksCustomerDocument>) ||
    connection.model<QuickBooksCustomerDocument>('QuickBooksCustomer', quickBooksCustomerSchema)
  modelCache.set(connection, model)
  return model
}
