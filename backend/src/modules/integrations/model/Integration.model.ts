import { Schema, model, Document, Types } from 'mongoose'

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
  connectedBy: Types.ObjectId
  createdAt: Date
  updatedAt: Date
}

const integrationSchema = new Schema<IntegrationDocument>(
  {
    orgId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    provider: { type: String, enum: ['hubspot', 'salesforce', 'quickbooks'], required: true },
    accessToken: { type: String, required: true },
    refreshToken: { type: String, required: true },
    expiresAt: { type: Date, required: true },
    scope: { type: [String], default: [] },
    accountId: { type: String, default: null },
    accountDomain: { type: String, default: null },
    connectedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true }
  },
  { timestamps: true }
)

// A given organization can only have a single connection per provider; logging
// in again under the same org reuses this existing connection.
integrationSchema.index({ orgId: 1, provider: 1 }, { unique: true })

export const IntegrationModel = model<IntegrationDocument>('Integration', integrationSchema)
