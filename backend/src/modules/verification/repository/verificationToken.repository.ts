import { VerificationTokenModel, VerificationTokenType } from '../model/VerificationToken.model'
import { Types } from 'mongoose'

export const verificationTokenRepository = {
  create(data: { userId: string | Types.ObjectId; tokenHash: string; type: VerificationTokenType; expiresAt: Date }) {
    return VerificationTokenModel.create(data)
  },

  findValidByHash(tokenHash: string, type: VerificationTokenType) {
    return VerificationTokenModel.findOne({
      tokenHash,
      type,
      usedAt: null,
      expiresAt: { $gt: new Date() }
    })
  },

  markUsed(id: string | Types.ObjectId) {
    return VerificationTokenModel.findByIdAndUpdate(id, { usedAt: new Date() }, { new: true })
  },

  /** Invalidate any previously issued, still-unused tokens of a type for a user before issuing a new one. */
  invalidateAllForUser(userId: string | Types.ObjectId, type: VerificationTokenType) {
    return VerificationTokenModel.updateMany(
      { userId, type, usedAt: null },
      { usedAt: new Date() }
    )
  }
}
