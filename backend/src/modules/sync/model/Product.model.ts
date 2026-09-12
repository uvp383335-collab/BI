import { Schema, Document, Types, Connection, Model } from 'mongoose'

/**
 * Generic, per-tenant product catalog entry (HubSpot `Product` object;
 * Salesforce `Product2`). Lives in the organization's own tenant database
 * (same pattern as PipelineStageDefinition). Only exists to label
 * `Deal.productIds` in the funnel product-filter dropdown — no pricing or
 * catalog detail is synced.
 */
export interface ProductDocument extends Document {
  _id: Types.ObjectId
  orgId: Types.ObjectId
  provider: string
  providerRecordId: string
  name: string
  createdAt: Date
  updatedAt: Date
}

const productSchema = new Schema<ProductDocument>(
  {
    orgId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    provider: { type: String, required: true },
    providerRecordId: { type: String, required: true },
    name: { type: String, required: true }
  },
  { timestamps: true }
)

// A product's name can change in the CRM — upsert on this key rather than insert-once.
productSchema.index({ orgId: 1, provider: 1, providerRecordId: 1 }, { unique: true })

const modelCache = new WeakMap<Connection, Model<ProductDocument>>()

/** Returns the Product model bound to the given tenant connection, compiling it once per connection. */
export function getProductModel(connection: Connection): Model<ProductDocument> {
  const cached = modelCache.get(connection)
  if (cached) return cached
  const model = (connection.models.Product as Model<ProductDocument>) || connection.model<ProductDocument>('Product', productSchema)
  modelCache.set(connection, model)
  return model
}
