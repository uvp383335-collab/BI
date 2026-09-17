import { Schema, Document, Types, Connection, Model } from 'mongoose'
import { PLLineItemDocument } from './PLSnapshot.model'

/**
 * A stored copy of one quarter's QuickBooks Profit & Loss report, filtered
 * to a single Item (Product/Service) via the report's `item` query param —
 * the per-product breakdown backing the filter on the VC-04/09/10/13 P&L
 * trend cards. Sibling to `PLSnapshot` (the unfiltered, Class-summarized
 * quarterly snapshot), refreshed by the same sync job, same
 * "read from here, never call QuickBooks live at metric-request time" rule
 * (see PLSnapshot.model.ts's doc comment and docs/sherpai-metrics-progress.md
 * gap G-15).
 *
 * Deliberately narrower than `PLSnapshot`: no Balance-Sheet/Cash-Flow fields
 * (AR/AP/inventory/operatingCashFlow/capEx/netFixedAssets) — those reports
 * aren't item-filterable in QuickBooks' Reports API and none of VC-04/09/10/13
 * need them; they only ever read income/cogs/expenses/otherExpenses/sectionTotals.
 */
export interface PLItemSnapshotDocument extends Document {
  _id: Types.ObjectId
  orgId: Types.ObjectId
  provider: string
  itemId: string
  /** "YYYY-MM" of the quarter's first month — same label PLSnapshot/plMetrics.service.ts use everywhere. */
  quarterStart: string
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
  { account: { type: String, required: true }, amounts: { type: Schema.Types.Mixed, required: true } },
  { _id: false }
)

const plItemSnapshotSchema = new Schema<PLItemSnapshotDocument>(
  {
    orgId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    provider: { type: String, required: true },
    itemId: { type: String, required: true },
    quarterStart: { type: String, required: true },
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

// One snapshot per (item, quarter) — a resync overwrites it in place, same as PLSnapshot.
plItemSnapshotSchema.index({ orgId: 1, provider: 1, quarterStart: 1, itemId: 1 }, { unique: true })

const modelCache = new WeakMap<Connection, Model<PLItemSnapshotDocument>>()

/** Returns the PLItemSnapshot model bound to the given tenant connection, compiling it once per connection. */
export function getPLItemSnapshotModel(connection: Connection): Model<PLItemSnapshotDocument> {
  const cached = modelCache.get(connection)
  if (cached) return cached
  const model =
    (connection.models.PLItemSnapshot as Model<PLItemSnapshotDocument>) ||
    connection.model<PLItemSnapshotDocument>('PLItemSnapshot', plItemSnapshotSchema)
  modelCache.set(connection, model)
  return model
}
