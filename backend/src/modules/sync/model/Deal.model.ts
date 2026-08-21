import { Schema, model, Document, Types } from 'mongoose'

export interface DealStageHistoryEntry {
  value: string
  timestamp: Date
}

/**
 * Minimal, org-scoped deal record. Includes `dealStageHistory`, the raw
 * timeline of `dealstage` property changes — this is the only "history" data
 * synced, and it exists solely to power the pipeline-progression graph.
 */
export interface DealDocument extends Document {
  _id: Types.ObjectId
  orgId: Types.ObjectId
  provider: string
  hubspotId: string
  dealname?: string
  amount?: number
  closedate?: Date
  pipeline?: string
  dealstage?: string
  hubspotOwnerId?: string
  dealStageHistory: DealStageHistoryEntry[]
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
    hubspotId: { type: String, required: true },
    dealname: { type: String },
    amount: { type: Number },
    closedate: { type: Date },
    pipeline: { type: String, index: true },
    dealstage: { type: String },
    hubspotOwnerId: { type: String, index: true },
    dealStageHistory: { type: [stageHistorySchema], default: [] }
  },
  { timestamps: true }
)

dealSchema.index({ orgId: 1, provider: 1, hubspotId: 1 }, { unique: true })

export const DealModel = model<DealDocument>('SyncDeal', dealSchema)
