import { Schema, model, Document, Types } from 'mongoose'

export type MembershipRole = 'owner' | 'admin' | 'member'
export type MembershipStatus = 'active' | 'invited'

export interface MembershipDocument extends Document {
  _id: Types.ObjectId
  userId: Types.ObjectId
  orgId: Types.ObjectId
  role: MembershipRole
  status: MembershipStatus
  invitedBy?: Types.ObjectId | null
  createdAt: Date
  updatedAt: Date
}

const membershipSchema = new Schema<MembershipDocument>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    orgId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    role: { type: String, enum: ['owner', 'admin', 'member'], required: true },
    status: { type: String, enum: ['active', 'invited'], default: 'active' },
    invitedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null }
  },
  { timestamps: true }
)

// A user can only have one membership per organization.
membershipSchema.index({ userId: 1, orgId: 1 }, { unique: true })

export const MembershipModel = model<MembershipDocument>('Membership', membershipSchema)
