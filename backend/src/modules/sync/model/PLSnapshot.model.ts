import { Schema, Document, Types, Connection, Model } from 'mongoose'

/**
 * A stored copy of one quarter's QuickBooks Profit & Loss report
 * (Class-summarized — the "Total" column plus one column per product Class),
 * refreshed by the sync job rather than fetched live on every metrics
 * request. See docs/sherpai-metrics-progress.md gap G-15: this replaces the
 * "call QuickBooks live on every dashboard view" approach with "call it once
 * per sync, read from here the rest of the time." No scheduler exists yet —
 * today this only refreshes on OAuth-connect or a manual resync click, same
 * as Contact/Deal/Customer/Invoice; a future cron job just calls the same
 * sync path more often.
 *
 * Kept as the same flat shape `plParser.parseProfitAndLoss` already
 * produces (not re-normalized into a different schema) so the metric
 * formulas in plMetrics.service.ts don't need to know whether the data came
 * from a live call or storage.
 *
 * Phase 3 widened this beyond pure P&L: `accountsReceivable`/`accountsPayable`/
 * `inventoryValue` (Balance-Sheet-adjacent, as of the quarter's end date) and
 * `operatingCashFlow`/`capEx` (from the Cash Flow report, over the quarter)
 * back CB-10 and CB-07 respectively. Kept on this same per-quarter row rather
 * than a separate model — same natural key (`orgId`, `provider`,
 * `quarterStart`), fetched in the same sync pass. The name "PLSnapshot"
 * undersells that a bit now; not renamed to avoid disruptive churn on an
 * already-shipped model for a cosmetic reason.
 */
export interface PLLineItemDocument {
  account: string
  amounts: Record<string, number>
}

export interface PLSnapshotDocument extends Document {
  _id: Types.ObjectId
  orgId: Types.ObjectId
  provider: string
  /** "YYYY-MM" of the quarter's first month — the same label plMetrics.service.ts uses everywhere else. */
  quarterStart: string
  startDate: string
  endDate: string
  columns: string[]
  income: PLLineItemDocument[]
  cogs: PLLineItemDocument[]
  expenses: PLLineItemDocument[]
  otherExpenses: PLLineItemDocument[]
  sectionTotals: Record<string, Record<string, number>>
  /** As-of the quarter's end date. `undefined` when that report couldn't be fetched/parsed for this quarter — not a 0. */
  accountsReceivable?: number
  accountsPayable?: number
  inventoryValue?: number
  /** Over the quarter (Cash Flow report). */
  operatingCashFlow?: number
  capEx?: number
  /** As-of the quarter's end date (Balance Sheet report, `FixedAssets` section) — CB-07's Balance-Sheet-derived CapEx fallback when the Cash Flow report isn't available. */
  netFixedAssets?: number
  fetchedAt: Date
  createdAt: Date
  updatedAt: Date
}

const lineItemSchema = new Schema<PLLineItemDocument>(
  { account: { type: String, required: true }, amounts: { type: Schema.Types.Mixed, required: true } },
  { _id: false }
)

const plSnapshotSchema = new Schema<PLSnapshotDocument>(
  {
    orgId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    provider: { type: String, required: true },
    quarterStart: { type: String, required: true },
    startDate: { type: String, required: true },
    endDate: { type: String, required: true },
    columns: { type: [String], default: [] },
    income: { type: [lineItemSchema], default: [] },
    cogs: { type: [lineItemSchema], default: [] },
    expenses: { type: [lineItemSchema], default: [] },
    otherExpenses: { type: [lineItemSchema], default: [] },
    sectionTotals: { type: Schema.Types.Mixed, default: {} },
    accountsReceivable: { type: Number },
    accountsPayable: { type: Number },
    inventoryValue: { type: Number },
    operatingCashFlow: { type: Number },
    capEx: { type: Number },
    netFixedAssets: { type: Number },
    fetchedAt: { type: Date, required: true }
  },
  { timestamps: true }
)

// One snapshot per quarter — a resync overwrites it in place. Not
// version-history-tracked yet (see gap G-13's versioning note); QuickBooks
// itself stays the source of truth, this is a read-optimized mirror of it.
plSnapshotSchema.index({ orgId: 1, provider: 1, quarterStart: 1 }, { unique: true })

const modelCache = new WeakMap<Connection, Model<PLSnapshotDocument>>()

/** Returns the PLSnapshot model bound to the given tenant connection, compiling it once per connection. */
export function getPLSnapshotModel(connection: Connection): Model<PLSnapshotDocument> {
  const cached = modelCache.get(connection)
  if (cached) return cached
  const model =
    (connection.models.PLSnapshot as Model<PLSnapshotDocument>) ||
    connection.model<PLSnapshotDocument>('PLSnapshot', plSnapshotSchema)
  modelCache.set(connection, model)
  return model
}
