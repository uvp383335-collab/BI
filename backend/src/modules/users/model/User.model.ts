import { Schema, model, Document, Types } from 'mongoose'

export type UserStatus = 'pending_verification' | 'active' | 'disabled'

export interface UserDocument extends Document {
  _id: Types.ObjectId
  email: string
  passwordHash: string
  name: string
  status: UserStatus
  emailVerifiedAt: Date | null
  createdAt: Date
  updatedAt: Date
}

const userSchema = new Schema<UserDocument>(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true, index: true },
    passwordHash: { type: String, required: true },
    name: { type: String, required: true, trim: true },
    status: {
      type: String,
      enum: ['pending_verification', 'active', 'disabled'],
      default: 'pending_verification'
    },
    emailVerifiedAt: { type: Date, default: null }
  },
  { timestamps: true }
)

export const UserModel = model<UserDocument>('User', userSchema)
