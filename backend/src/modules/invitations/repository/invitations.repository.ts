import { InvitationModel } from '../model/Invitation.model'
import { Types } from 'mongoose'
import { MembershipRole } from '../../organizations/model/Membership.model'

export const invitationsRepository = {
  create(data: {
    orgId: string | Types.ObjectId
    email: string
    role: MembershipRole
    tokenHash: string
    invitedBy: string | Types.ObjectId
    expiresAt: Date
  }) {
    return InvitationModel.create(data)
  },

  findValidByHash(tokenHash: string) {
    return InvitationModel.findOne({ tokenHash, status: 'pending', expiresAt: { $gt: new Date() } })
  },

  markAccepted(id: string | Types.ObjectId) {
    return InvitationModel.findByIdAndUpdate(id, { status: 'accepted', acceptedAt: new Date() }, { new: true })
  },

  
  findPendingByEmailAndOrg(email: string, orgId: string | Types.ObjectId) {
    return InvitationModel.findOne({ email: email.toLowerCase().trim(), orgId, status: 'pending' })
  },

  // Paginated listing for an organization with optional filters
  async findByOrg(orgId: string | Types.ObjectId, options: { page?: number; pageSize?: number; status?: string; role?: string; sort?: string }) {
    const page = Math.max(1, options.page ?? 1)
    const pageSize = Math.max(1, Math.min(100, options.pageSize ?? 20))

    const filter: any = { orgId }
    if (options.status) filter.status = options.status
    if (options.role) filter.role = options.role

    const sort: any = {}
    if (options.sort) {
      // simple sort parser: field:asc or field:desc
      const [field, dir] = options.sort.split(':')
      sort[field] = dir === 'desc' ? -1 : 1
    } else {
      sort.createdAt = -1
    }

    const [items, total] = await Promise.all([
      InvitationModel.find(filter)
        .populate('invitedBy', 'name email')
        .sort(sort)
        .skip((page - 1) * pageSize)
        .limit(pageSize)
        .lean(),
      InvitationModel.countDocuments(filter)
    ])

    return { items, total, page, pageSize }
  }
}