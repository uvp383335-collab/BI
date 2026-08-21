import { Schema, model, Document, Types } from 'mongoose'

export type VerificationTokenType = 'email_verify' | 'password_reset'

export interface VerificationTokenDocument extends Document {
  _id: Types.ObjectId
  userId: Types.ObjectId
  tokenHash: string
  type: VerificationTokenType
  expiresAt: Date
  usedAt: Date | null
  createdAt: Date
  updatedAt: Date
}

const verificationTokenSchema = new Schema<VerificationTokenDocument>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    tokenHash: { type: String, required: true, unique: true, index: true },
    type: { type: String, enum: ['email_verify', 'password_reset'], required: true },
    expiresAt: { type: Date, required: true },
    usedAt: { type: Date, default: null }
  },
  { timestamps: true }
)

// Auto-remove expired tokens after they pass their expiry, keeping the collection lean.
verificationTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 })

export const VerificationTokenModel = model<VerificationTokenDocument>(
  'VerificationToken',
  verificationTokenSchema
)
