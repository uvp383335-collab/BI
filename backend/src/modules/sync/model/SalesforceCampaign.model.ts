import { Schema, Document, Types, Connection, Model } from 'mongoose'

/**
 * Generic, per-tenant Salesforce Campaign record. `name`/`type` originally
 * fed only CM-05's marketing-attribution breakdown (see cmMetrics.service.ts);
 * the rest are the standard Campaign ROI/influence rollup fields (the same
 * numbers Salesforce's own "Campaign Influence Report" is built from) plus
 * detail-view fields, added to power the Campaigns browse/detail view.
 * Salesforce-only, unlike Contact/Deal — there's no equivalent object synced
 * from HubSpot in this app.
 */
export interface SalesforceCampaignDocument extends Document {
  _id: Types.ObjectId
  orgId: Types.ObjectId
  provider: string
  providerRecordId: string
  name?: string
  type?: string
  status?: string
  startDate?: Date
  endDate?: Date
  active?: boolean
  ownerName?: string
  expectedRevenue?: number
  budgetedCost?: number
  actualCost?: number
  expectedResponsePct?: number
  numberSent?: number
  parentCampaignName?: string
  description?: string
  createdByName?: string
  lastModifiedByName?: string
  lastModifiedAt?: Date
  numberOfLeads?: number
  numberOfConvertedLeads?: number
  numberOfContacts?: number
  numberOfResponses?: number
  numberOfOpportunities?: number
  numberOfWonOpportunities?: number
  amountAllOpportunities?: number
  amountWonOpportunities?: number
  createdAt: Date
  updatedAt: Date
}

const salesforceCampaignSchema = new Schema<SalesforceCampaignDocument>(
  {
    orgId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    provider: { type: String, required: true },
    providerRecordId: { type: String, required: true },
    name: { type: String },
    type: { type: String },
    status: { type: String },
    startDate: { type: Date },
    endDate: { type: Date },
    active: { type: Boolean },
    ownerName: { type: String },
    expectedRevenue: { type: Number },
    budgetedCost: { type: Number },
    actualCost: { type: Number },
    expectedResponsePct: { type: Number },
    numberSent: { type: Number },
    parentCampaignName: { type: String },
    description: { type: String },
    createdByName: { type: String },
    lastModifiedByName: { type: String },
    lastModifiedAt: { type: Date },
    numberOfLeads: { type: Number },
    numberOfConvertedLeads: { type: Number },
    numberOfContacts: { type: Number },
    numberOfResponses: { type: Number },
    numberOfOpportunities: { type: Number },
    numberOfWonOpportunities: { type: Number },
    amountAllOpportunities: { type: Number },
    amountWonOpportunities: { type: Number }
  },
  { timestamps: true }
)

salesforceCampaignSchema.index({ orgId: 1, provider: 1, providerRecordId: 1 }, { unique: true })

const modelCache = new WeakMap<Connection, Model<SalesforceCampaignDocument>>()

/** Returns the SalesforceCampaign model bound to the given tenant connection, compiling it once per connection. */
export function getSalesforceCampaignModel(connection: Connection): Model<SalesforceCampaignDocument> {
  const cached = modelCache.get(connection)
  if (cached) return cached
  const model =
    (connection.models.SalesforceCampaign as Model<SalesforceCampaignDocument>) ||
    connection.model<SalesforceCampaignDocument>('SalesforceCampaign', salesforceCampaignSchema)
  modelCache.set(connection, model)
  return model
}
