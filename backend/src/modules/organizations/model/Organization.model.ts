import { Schema, model, Document, Types } from 'mongoose'

export type OrganizationStatus = 'active' | 'suspended'

export interface OrganizationDocument extends Document {
  _id: Types.ObjectId
  name: string
  slug: string
  status: OrganizationStatus
  /** Name of this org's dedicated tenant database (same cluster, isolated database per org). */
  dbName: string
  createdAt: Date
  updatedAt: Date
}

const organizationSchema = new Schema<OrganizationDocument>(
  {
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true, index: true },
    status: { type: String, enum: ['active', 'suspended'], default: 'active' },
    // Unique per org; assigned once at creation and never changed, so cached
    // tenant connections (keyed by orgId) always resolve to the same database.
    dbName: { type: String, required: true, unique: true }
  },
  { timestamps: true }
)

export const OrganizationModel = model<OrganizationDocument>('Organization', organizationSchema)
