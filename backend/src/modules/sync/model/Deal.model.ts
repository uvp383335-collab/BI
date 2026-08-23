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
  /** Salesforce-only (`Opportunity.Type`/`LeadSource`/`CampaignId`/`AccountId`) — undefined for HubSpot deals. Used by VC-03/VC-06/CM-02 (metrics guide). */
  type?: string
  leadSource?: string
  campaignId?: string
  accountId?: string
  /** The CRM's own deal-creation date (HubSpot `createdate`) — distinct from `createdAt` below, which is when *this app* first synced the row. CM-05 needs "pipeline created this period," which means the former. Salesforce-undefined for now (Opportunity `CreatedDate` isn't pulled). */
  dealCreatedAt?: Date
  /** Salesforce-only, 'field' mode — value of the org's configured competitor field (Organization.settings.salesforceCompetitorField), pulled dynamically since the field name varies per org. Undefined for HubSpot deals and for Salesforce orgs with no competitor field configured. CM-03. */
  competitor?: string
  /** Salesforce-only, 'junction' mode — every named competitor from the standard `OpportunityCompetitor` object (a deal can name several at once, unlike `competitor` above). Mutually exclusive with `competitor` in practice — which one gets populated depends on `Organization.settings.salesforceCompetitorSource`. CM-03 (gap G-24). */
  competitors?: string[]
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
    dealStageHistory: { type: [stageHistorySchema], default: [] },
    type: { type: String },
    leadSource: { type: String },
    campaignId: { type: String },
    accountId: { type: String, index: true },
    dealCreatedAt: { type: Date, index: true },
    competitor: { type: String, index: true },
    competitors: { type: [String], default: undefined }
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
