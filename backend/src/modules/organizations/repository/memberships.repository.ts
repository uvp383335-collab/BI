import { MembershipModel, MembershipRole } from '../model/Membership.model'
import { Types } from 'mongoose'

export const membershipsRepository = {
  create(data: {
    userId: string | Types.ObjectId
    orgId: string | Types.ObjectId
    role: MembershipRole
    status?: 'active' | 'invited'
    invitedBy?: string | Types.ObjectId | null
  }) {
    return MembershipModel.create(data)
  },

  findByUserAndOrg(userId: string | Types.ObjectId, orgId: string | Types.ObjectId) {
    return MembershipModel.findOne({ userId, orgId })
  },

  /** All active memberships for a user, with organization details populated. */
  findActiveByUser(userId: string | Types.ObjectId) {
    return MembershipModel.find({ userId, status: 'active' }).populate('orgId')
  },

  activate(id: string | Types.ObjectId) {
    return MembershipModel.findByIdAndUpdate(id, { status: 'active' }, { new: true })
  }
}
