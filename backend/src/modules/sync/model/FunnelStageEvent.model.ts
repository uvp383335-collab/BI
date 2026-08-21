import { Schema, Document, Types, Connection, Model } from 'mongoose'

/**
 * Generic, per-tenant stage-transition event. Lives in the organization's
 * own tenant database (same pattern as Contact/Deal). One row per
 * stage-entry, across both the lead lifecycle (Contact.lifecycleStage) and
 * the deal lifecycle (Deal.dealstage), so the funnel chart can query one
 * collection instead of joining two different embedded-array shapes.
 *
 * Funnels render per-provider (see docs/funnel-normalization-design.md) —
 * `rawStage` is the exact value the CRM sent, with no cross-provider
 * mapping. Ordering/closed-won-lost comes from PipelineStageDefinition,
 * joined on (orgId, provider, entityType, pipeline, rawStage).
 */
export interface FunnelStageEventDocument extends Document {
  _id: Types.ObjectId
  orgId: Types.ObjectId
  provider: string
  entityType: 'lead' | 'deal'
  providerRecordId: string
  pipeline: string
  rawStage: string
  enteredAt: Date
  convertedToRecordId?: string
  createdAt: Date
  updatedAt: Date
}

const funnelStageEventSchema = new Schema<FunnelStageEventDocument>(
  {
    orgId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    provider: { type: String, required: true },
    entityType: { type: String, enum: ['lead', 'deal'], required: true },
    providerRecordId: { type: String, required: true },
    pipeline: { type: String, required: true },
    rawStage: { type: String, required: true },
    enteredAt: { type: Date, required: true },
    convertedToRecordId: { type: String }
  },
  { timestamps: true }
)

// One row per distinct transition — re-syncing the same record diffs
// against this and only inserts genuinely new transitions.
funnelStageEventSchema.index(
  { orgId: 1, provider: 1, entityType: 1, providerRecordId: 1, rawStage: 1, enteredAt: 1 },
  { unique: true }
)

// Funnel chart's main query shape: group by pipeline/stage for a provider.
funnelStageEventSchema.index({ orgId: 1, provider: 1, entityType: 1, pipeline: 1 })

const modelCache = new WeakMap<Connection, Model<FunnelStageEventDocument>>()

/** Returns the FunnelStageEvent model bound to the given tenant connection, compiling it once per connection. */
export function getFunnelStageEventModel(connection: Connection): Model<FunnelStageEventDocument> {
  const cached = modelCache.get(connection)
  if (cached) return cached
  const model =
    (connection.models.FunnelStageEvent as Model<FunnelStageEventDocument>) ||
    connection.model<FunnelStageEventDocument>('FunnelStageEvent', funnelStageEventSchema)
  modelCache.set(connection, model)
  return model
}
