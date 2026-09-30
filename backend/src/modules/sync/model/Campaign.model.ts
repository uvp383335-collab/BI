import { Schema, Document, Types, Connection, Model } from 'mongoose'

/**
 * Generic, per-tenant Campaign record — cost + the standard won-opportunity/
 * lead rollups Salesforce computes automatically from records that reference
 * the Campaign. Salesforce-only for now (no HubSpot Campaigns API connector,
 * see crm-integrations skill). Drives the "Marketing ROI by channel" widget
 * (channel = `type`) and, per-campaign, CAC.
 */
export interface CampaignDocument extends Document {
  _id: Types.ObjectId
  orgId: Types.ObjectId
  provider: string
  providerRecordId: string
  name?: string
  type?: string
  isActive: boolean
  actualCost: number
  numberOfLeads: number
  numberOfConvertedLeads: number
  numberOfOpportunities: number
  numberOfWonOpportunities: number
  amountAllOpportunities: number
  amountWonOpportunities: number
  createdAt: Date
  updatedAt: Date
}

const campaignSchema = new Schema<CampaignDocument>(
  {
    orgId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    provider: { type: String, required: true },
    providerRecordId: { type: String, required: true },
    name: { type: String },
    type: { type: String },
    isActive: { type: Boolean, default: false },
    actualCost: { type: Number, default: 0 },
    numberOfLeads: { type: Number, default: 0 },
    numberOfConvertedLeads: { type: Number, default: 0 },
    numberOfOpportunities: { type: Number, default: 0 },
    numberOfWonOpportunities: { type: Number, default: 0 },
    amountAllOpportunities: { type: Number, default: 0 },
    amountWonOpportunities: { type: Number, default: 0 }
  },
  { timestamps: true }
)

campaignSchema.index({ orgId: 1, provider: 1, providerRecordId: 1 }, { unique: true })

const modelCache = new WeakMap<Connection, Model<CampaignDocument>>()

/** Returns the Campaign model bound to the given tenant connection, compiling it once per connection. */
export function getCampaignModel(connection: Connection): Model<CampaignDocument> {
  const cached = modelCache.get(connection)
  if (cached) return cached
  const model =
    (connection.models.Campaign as Model<CampaignDocument>) || connection.model<CampaignDocument>('Campaign', campaignSchema)
  modelCache.set(connection, model)
  return model
}
