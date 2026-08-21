import { Schema, model, Document, Types } from 'mongoose'

export type OrganizationStatus = 'active' | 'suspended'

export interface OrganizationDocument extends Document {
  _id: Types.ObjectId
  name: string
  slug: string
  status: OrganizationStatus
  createdAt: Date
  updatedAt: Date
}

const organizationSchema = new Schema<OrganizationDocument>(
  {
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true, index: true },
    status: { type: String, enum: ['active', 'suspended'], default: 'active' }
  },
  { timestamps: true }
)

export const OrganizationModel = model<OrganizationDocument>('Organization', organizationSchema)
