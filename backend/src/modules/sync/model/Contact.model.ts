import { Schema, model, Document, Types } from 'mongoose'

/**
 * Minimal, org-scoped contact record. Only the fields needed for dashboard
 * stats are stored — no email-engagement/marketing data is synced.
 */
export interface ContactDocument extends Document {
  _id: Types.ObjectId
  orgId: Types.ObjectId
  provider: string
  hubspotId: string
  email?: string
  firstname?: string
  lastname?: string
  lifecycleStage?: string
  leadStatus?: string
  createdAt: Date
  updatedAt: Date
}

const contactSchema = new Schema<ContactDocument>(
  {
    orgId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    provider: { type: String, required: true },
    hubspotId: { type: String, required: true },
    email: { type: String },
    firstname: { type: String },
    lastname: { type: String },
    lifecycleStage: { type: String },
    leadStatus: { type: String }
  },
  { timestamps: true }
)

contactSchema.index({ orgId: 1, provider: 1, hubspotId: 1 }, { unique: true })

export const ContactModel = model<ContactDocument>('SyncContact', contactSchema)
