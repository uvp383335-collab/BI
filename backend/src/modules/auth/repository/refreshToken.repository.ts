import { RefreshTokenModel } from '../model/RefreshToken.model'
import { Types } from 'mongoose'

export const refreshTokenRepository = {
  create(data: { userId: string | Types.ObjectId; orgId: string | Types.ObjectId; jti: string; expiresAt: Date }) {
    return RefreshTokenModel.create(data)
  },

  findActiveByJti(jti: string) {
    return RefreshTokenModel.findOne({ jti, revokedAt: null, expiresAt: { $gt: new Date() } })
  },

  revoke(id: string | Types.ObjectId) {
    return RefreshTokenModel.findByIdAndUpdate(id, { revokedAt: new Date() }, { new: true })
  },

  revokeByJti(jti: string) {
    return RefreshTokenModel.findOneAndUpdate({ jti }, { revokedAt: new Date() }, { new: true })
  }
}
