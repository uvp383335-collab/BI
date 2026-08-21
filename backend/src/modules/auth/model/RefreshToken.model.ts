import { Schema, model, Document, Types } from 'mongoose'

export interface RefreshTokenDocument extends Document {
  _id: Types.ObjectId
  userId: Types.ObjectId
  orgId: Types.ObjectId
  jti: string
  expiresAt: Date
  revokedAt: Date | null
  createdAt: Date
  updatedAt: Date
}

const refreshTokenSchema = new Schema<RefreshTokenDocument>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    orgId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true },
    jti: { type: String, required: true, unique: true, index: true },
    expiresAt: { type: Date, required: true },
    revokedAt: { type: Date, default: null }
  },
  { timestamps: true }
)

// Auto-remove expired refresh tokens.
refreshTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 })

export const RefreshTokenModel = model<RefreshTokenDocument>('RefreshToken', refreshTokenSchema)
