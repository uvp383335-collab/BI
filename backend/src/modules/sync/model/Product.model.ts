import { Schema, Document, Types, Connection, Model } from 'mongoose'

/**
 * Generic, per-tenant product catalog entry (HubSpot `Product` object;
 * Salesforce `Product2`; QuickBooks `Item`, sellable types only). Lives in
 * the organization's own tenant database (same pattern as
 * PipelineStageDefinition). For HubSpot/Salesforce this only exists to label
 * `Deal.productIds` in the funnel product-filter dropdown; for QuickBooks it
 * also backs the per-product filter on the VC-04/09/10/13 P&L trend cards
 * (see `PLItemSnapshot`) — no pricing or catalog detail is synced either way.
 *
 * `category`/`billingFrequency` are the one piece of catalog detail that IS
 * user-maintained rather than synced: whether this product's revenue is
 * recurring, and if so how often it bills. Defaults to `not_sure` on every
 * new/synced product — VC-13 (recurring-revenue split) and VC-01/VC-02
 * (frequency-aware GRR/NRR) treat `not_sure` the same as uncategorized
 * (excluded from the recurring/non-recurring split) until an owner/admin
 * explicitly sets it from Settings.
 */
export type ProductCategory = 'recurring' | 'non_recurring' | 'not_sure'
export type ProductBillingFrequency = 'monthly' | 'quarterly' | 'yearly'

export interface ProductDocument extends Document {
  _id: Types.ObjectId
  orgId: Types.ObjectId
  provider: string
  providerRecordId: string
  name: string
  category: ProductCategory
  /** Only meaningful when `category === 'recurring'`. */
  billingFrequency?: ProductBillingFrequency
  createdAt: Date
  updatedAt: Date
}

const productSchema = new Schema<ProductDocument>(
  {
    orgId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    provider: { type: String, required: true },
    providerRecordId: { type: String, required: true },
    name: { type: String, required: true },
    category: { type: String, enum: ['recurring', 'non_recurring', 'not_sure'], default: 'not_sure', required: true },
    billingFrequency: { type: String, enum: ['monthly', 'quarterly', 'yearly'] }
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
