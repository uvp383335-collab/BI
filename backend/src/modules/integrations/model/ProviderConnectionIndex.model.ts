import { Schema, model, Document, Types } from 'mongoose'

/**
 * Control-plane (default connection) index mapping a third-party account
 * (e.g. HubSpot's hub_id) to the single org it's connected to.
 *
 * This is intentionally NOT the same document as Integration (which holds
 * tokens and now lives in each org's isolated tenant database) — since tenant
 * databases can't be queried cross-database, this small, non-sensitive index
 * is what lets us detect "this HubSpot account is already connected to a
 * different organization" without ever touching another tenant's tokens.
 */
export interface ProviderConnectionIndexDocument extends Document {
  _id: Types.ObjectId
  provider: string
  /** The provider's own account identifier, e.g. HubSpot's hub_id. */
  externalAccountId: string
  /** Human-readable label for messaging, e.g. HubSpot's hub_domain. */
  externalAccountLabel?: string | null
  orgId: Types.ObjectId
  createdAt: Date
  updatedAt: Date
}

const providerConnectionIndexSchema = new Schema<ProviderConnectionIndexDocument>(
  {
    provider: { type: String, required: true },
    externalAccountId: { type: String, required: true },
    externalAccountLabel: { type: String, default: null },
    orgId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true }
  },
  { timestamps: true }
)

// One external provider account can only ever be claimed by a single org.
providerConnectionIndexSchema.index({ provider: 1, externalAccountId: 1 }, { unique: true })

export const ProviderConnectionIndexModel = model<ProviderConnectionIndexDocument>(
  'ProviderConnectionIndex',
  providerConnectionIndexSchema
)
