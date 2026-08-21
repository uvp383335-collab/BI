import { Schema, model, Document, Types } from 'mongoose'
import { MembershipRole } from '../../organizations/model/Membership.model'

export type InvitationStatus = 'pending' | 'accepted' | 'expired' | 'revoked'

export interface InvitationDocument extends Document {
  _id: Types.ObjectId
  orgId: Types.ObjectId
  email: string
  role: MembershipRole
  tokenHash: string
  invitedBy: Types.ObjectId
  status: InvitationStatus
  expiresAt: Date
  acceptedAt: Date | null
  createdAt: Date
  updatedAt: Date
}

const invitationSchema = new Schema<InvitationDocument>(
  {
    orgId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    email: { type: String, required: true, lowercase: true, trim: true, index: true },
    role: { type: String, enum: ['owner', 'admin', 'member'], required: true },
    tokenHash: { type: String, required: true, unique: true, index: true },
    invitedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    status: { type: String, enum: ['pending', 'accepted', 'expired', 'revoked'], default: 'pending' },
    expiresAt: { type: Date, required: true },
    acceptedAt: { type: Date, default: null }
  },
  { timestamps: true }
)

export const InvitationModel = model<InvitationDocument>('Invitation', invitationSchema)
