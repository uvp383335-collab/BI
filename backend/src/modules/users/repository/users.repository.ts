import { UserModel, UserDocument } from '../model/User.model'
import { Types } from 'mongoose'

export const usersRepository = {
  findByEmail(email: string) {
    return UserModel.findOne({ email: email.toLowerCase().trim() })
  },

  findById(id: string | Types.ObjectId) {
    return UserModel.findById(id)
  },

  create(data: { email: string; passwordHash: string; name: string; status?: UserDocument['status'] }) {
    return UserModel.create(data)
  },

  markEmailVerified(userId: string | Types.ObjectId) {
    return UserModel.findByIdAndUpdate(
      userId,
      { emailVerifiedAt: new Date(), status: 'active' },
      { new: true }
    )
  },

  updatePassword(userId: string | Types.ObjectId, passwordHash: string) {
    return UserModel.findByIdAndUpdate(userId, { passwordHash }, { new: true })
  }
}
