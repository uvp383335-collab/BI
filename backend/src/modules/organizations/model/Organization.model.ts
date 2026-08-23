import { Schema, model, Document, Types } from 'mongoose'

export type OrganizationStatus = 'active' | 'suspended'

export interface OrganizationSettings {
  /**
   * Salesforce competitor-tracking mode (metrics guide gap G-11 / G-24) —
   * Salesforce has no single standard way to record "which competitor was
   * in this deal," so this is a genuine per-org choice between two real
   * setups:
   * - `'field'` — a custom Opportunity field (commonly `Competitor__c`,
   *   named in `salesforceCompetitorField`), one competitor per deal.
   * - `'junction'` — the standard `OpportunityCompetitor` object, which
   *   allows *multiple* competitors per deal.
   * `undefined` means competitor tracking isn't configured for this org;
   * CM-03 reports `computable: false` rather than guessing.
   */
  salesforceCompetitorSource?: 'field' | 'junction'
  /** Only meaningful when `salesforceCompetitorSource === 'field'`. */
  salesforceCompetitorField?: string
}

export interface OrganizationDocument extends Document {
  _id: Types.ObjectId
  name: string
  slug: string
  status: OrganizationStatus
  /** Name of this org's dedicated tenant database (same cluster, isolated database per org). */
  dbName: string
  settings: OrganizationSettings
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
    dbName: { type: String, required: true, unique: true },
    settings: {
      salesforceCompetitorSource: { type: String, enum: ['field', 'junction'] },
      salesforceCompetitorField: { type: String }
    }
  },
  { timestamps: true }
)

export const OrganizationModel = model<OrganizationDocument>('Organization', organizationSchema)
