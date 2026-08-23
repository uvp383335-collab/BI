import { Schema, model, Document, Types } from 'mongoose'

export interface SyncJobDocument extends Document {
  _id: Types.ObjectId
  orgId: Types.ObjectId
  provider: string
  status: 'pending' | 'running' | 'completed' | 'failed'
  progress: number
  currentStep: string
  entities: {
    contacts: { status: 'pending' | 'syncing' | 'completed' | 'failed'; total: number; synced: number }
    deals: { status: 'pending' | 'syncing' | 'completed' | 'failed'; total: number; synced: number }
    customers: { status: 'pending' | 'syncing' | 'completed' | 'failed'; total: number; synced: number }
    invoices: { status: 'pending' | 'syncing' | 'completed' | 'failed'; total: number; synced: number }
    plSnapshots: { status: 'pending' | 'syncing' | 'completed' | 'failed'; total: number; synced: number }
    cashBalance: { status: 'pending' | 'syncing' | 'completed' | 'failed'; total: number; synced: number }
    accounts: { status: 'pending' | 'syncing' | 'completed' | 'failed'; total: number; synced: number }
  }
  error?: string
  startedAt?: Date
  completedAt?: Date
  createdAt: Date
  updatedAt: Date
}

const entityProgressSchema = new Schema(
  {
    status: { type: String, enum: ['pending', 'syncing', 'completed', 'failed'], default: 'pending' },
    total: { type: Number, default: 0 },
    synced: { type: Number, default: 0 }
  },
  { _id: false }
)

/**
 * Tracks the background sync of CRM/finance data for a single
 * organization/provider pair. HubSpot/Salesforce populate `contacts`/`deals`;
 * QuickBooks populates `customers`/`invoices` — a job only ever touches the
 * pair relevant to its provider, the other stays at its zero default.
 */
const syncJobSchema = new Schema<SyncJobDocument>(
  {
    orgId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    provider: { type: String, required: true },
    status: { type: String, enum: ['pending', 'running', 'completed', 'failed'], default: 'pending' },
    progress: { type: Number, default: 0 },
    currentStep: { type: String, default: 'Queued' },
    entities: {
      contacts: { type: entityProgressSchema, default: () => ({ status: 'pending', total: 0, synced: 0 }) },
      deals: { type: entityProgressSchema, default: () => ({ status: 'pending', total: 0, synced: 0 }) },
      customers: { type: entityProgressSchema, default: () => ({ status: 'pending', total: 0, synced: 0 }) },
      invoices: { type: entityProgressSchema, default: () => ({ status: 'pending', total: 0, synced: 0 }) },
      plSnapshots: { type: entityProgressSchema, default: () => ({ status: 'pending', total: 0, synced: 0 }) },
      cashBalance: { type: entityProgressSchema, default: () => ({ status: 'pending', total: 0, synced: 0 }) },
      accounts: { type: entityProgressSchema, default: () => ({ status: 'pending', total: 0, synced: 0 }) }
    },
    error: { type: String },
    startedAt: { type: Date },
    completedAt: { type: Date }
  },
  { timestamps: true }
)

syncJobSchema.index({ orgId: 1, provider: 1, createdAt: -1 })

export const SyncJobModel = model<SyncJobDocument>('SyncJob', syncJobSchema)
