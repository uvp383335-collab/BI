import { Schema, Document, Types, Connection, Model } from 'mongoose'

/**
 * Generic, per-tenant pipeline-stage metadata. Lives in the organization's
 * own tenant database (same pattern as Contact/Deal/FunnelStageEvent).
 *
 * Without a cross-provider canonical stage enum, stage order and
 * closed/won status have to come from the CRM's own pipeline
 * configuration rather than being guessed — this collection is that
 * synced metadata, refreshed alongside FunnelStageEvent so the funnel
 * chart can order + flag stages using the client's real pipeline setup.
 * See docs/funnel-normalization-design.md §3.4.
 */
export interface PipelineStageDefinitionDocument extends Document {
  _id: Types.ObjectId
  orgId: Types.ObjectId
  provider: string
  entityType: 'lead' | 'deal'
  pipeline: string
  rawStage: string
  label: string
  displayOrder: number
  isClosed: boolean
  isWon: boolean
  createdAt: Date
  updatedAt: Date
}

const pipelineStageDefinitionSchema = new Schema<PipelineStageDefinitionDocument>(
  {
    orgId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    provider: { type: String, required: true },
    entityType: { type: String, enum: ['lead', 'deal'], required: true },
    pipeline: { type: String, required: true },
    rawStage: { type: String, required: true },
    label: { type: String, required: true },
    displayOrder: { type: Number, required: true },
    isClosed: { type: Boolean, required: true, default: false },
    isWon: { type: Boolean, required: true, default: false }
  },
  { timestamps: true }
)

// A stage's label/order/closed-won flags can change if the client
// reconfigures their pipeline — upsert on this key rather than insert-once.
pipelineStageDefinitionSchema.index(
  { orgId: 1, provider: 1, entityType: 1, pipeline: 1, rawStage: 1 },
  { unique: true }
)

const modelCache = new WeakMap<Connection, Model<PipelineStageDefinitionDocument>>()

/** Returns the PipelineStageDefinition model bound to the given tenant connection, compiling it once per connection. */
export function getPipelineStageDefinitionModel(connection: Connection): Model<PipelineStageDefinitionDocument> {
  const cached = modelCache.get(connection)
  if (cached) return cached
  const model =
    (connection.models.PipelineStageDefinition as Model<PipelineStageDefinitionDocument>) ||
    connection.model<PipelineStageDefinitionDocument>('PipelineStageDefinition', pipelineStageDefinitionSchema)
  modelCache.set(connection, model)
  return model
}
