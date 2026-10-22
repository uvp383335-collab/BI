import { Schema, Document, Types, Connection, Model } from 'mongoose'
import { PLLineItemDocument } from './PLSnapshot.model'

/**
 * A stored copy of one calendar month's whole-company QuickBooks Profit &
 * Loss report — sibling to `PLSnapshot` (quarter-grain) and `PLItemSnapshot`
 * (per-product, quarter-grain), same "read from here, never call QuickBooks
 * live at metric-request time" rule. Exists specifically to back G&A % of
 * Revenue's Monthly and Yearly views: unlike Invoices (naturally month-grain
 * already), this app has never synced month-grain P&L data before, and
 * G&A's org-configured account sum needs per-account amounts at a finer
 * grain than the existing trailing-6-quarters `PLSnapshot` provides.
 *
 * Deliberately narrow, same reasoning as `PLItemSnapshot`: no Balance-Sheet/
 * Cash-Flow fields, no `accountAmounts` — only what G&A's account sum and
 * revenue total need (`income`/`expenses`/`otherExpenses`/`sectionTotals`),
 * plus `cogs` for shape-parity with its siblings.
 */
export interface PLMonthlySnapshotDocument extends Document {
  _id: Types.ObjectId
  orgId: Types.ObjectId
  provider: string
  /** "YYYY-MM" of this calendar month. */
  month: string
  startDate: string
  endDate: string
  columns: string[]
  income: PLLineItemDocument[]
  cogs: PLLineItemDocument[]
  expenses: PLLineItemDocument[]
  otherExpenses: PLLineItemDocument[]
  sectionTotals: Record<string, Record<string, number>>
  fetchedAt: Date
  createdAt: Date
  updatedAt: Date
}

const lineItemSchema = new Schema<PLLineItemDocument>(
  { account: { type: String, required: true }, accountId: { type: String }, amounts: { type: Schema.Types.Mixed, required: true } },
  { _id: false }
)

const plMonthlySnapshotSchema = new Schema<PLMonthlySnapshotDocument>(
  {
    orgId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    provider: { type: String, required: true },
    month: { type: String, required: true },
    startDate: { type: String, required: true },
    endDate: { type: String, required: true },
    columns: { type: [String], default: [] },
    income: { type: [lineItemSchema], default: [] },
    cogs: { type: [lineItemSchema], default: [] },
    expenses: { type: [lineItemSchema], default: [] },
    otherExpenses: { type: [lineItemSchema], default: [] },
    sectionTotals: { type: Schema.Types.Mixed, default: {} },
    fetchedAt: { type: Date, required: true }
  },
  { timestamps: true }
)

// One snapshot per (orgId, provider, month) — a resync overwrites it in place, same as PLSnapshot/PLItemSnapshot.
plMonthlySnapshotSchema.index({ orgId: 1, provider: 1, month: 1 }, { unique: true })

const modelCache = new WeakMap<Connection, Model<PLMonthlySnapshotDocument>>()

/** Returns the PLMonthlySnapshot model bound to the given tenant connection, compiling it once per connection. */
export function getPLMonthlySnapshotModel(connection: Connection): Model<PLMonthlySnapshotDocument> {
  const cached = modelCache.get(connection)
  if (cached) return cached
  const model =
    (connection.models.PLMonthlySnapshot as Model<PLMonthlySnapshotDocument>) ||
    connection.model<PLMonthlySnapshotDocument>('PLMonthlySnapshot', plMonthlySnapshotSchema)
  modelCache.set(connection, model)
  return model
}
