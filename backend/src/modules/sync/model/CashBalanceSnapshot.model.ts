import { Schema, Document, Types, Connection, Model } from 'mongoose'

/**
 * One row per day this org's QuickBooks connection was synced — CB-05's
 * "unrestricted cash" balance (sum of bank-type accounts on the Balance
 * Sheet, per the metrics guide's QuickBooks-fallback mode; the bank-feed/
 * Plaid primary source is out of MVP scope). Unlike `PLSnapshot` (one row
 * per quarter), this is keyed by calendar day, matching CB-05 being the one
 * metric in the framework checked daily.
 *
 * No scheduler exists yet, so in practice this only gets a new row whenever
 * someone syncs (OAuth-connect or a manual resync click) — sparse, not
 * truly daily, until a cron job syncs once a day. The runway/burn-rate
 * calculation in cbMetrics.service.ts is written to degrade gracefully
 * against whatever gap exists between data points rather than assuming
 * daily density.
 */
export interface CashBalanceSnapshotDocument extends Document {
  _id: Types.ObjectId
  orgId: Types.ObjectId
  provider: string
  /** "YYYY-MM-DD" */
  asOfDate: string
  unrestrictedCash: number
  fetchedAt: Date
  createdAt: Date
  updatedAt: Date
}

const cashBalanceSnapshotSchema = new Schema<CashBalanceSnapshotDocument>(
  {
    orgId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    provider: { type: String, required: true },
    asOfDate: { type: String, required: true },
    unrestrictedCash: { type: Number, required: true },
    fetchedAt: { type: Date, required: true }
  },
  { timestamps: true }
)

// One snapshot per calendar day — a same-day resync overwrites it in place.
cashBalanceSnapshotSchema.index({ orgId: 1, provider: 1, asOfDate: 1 }, { unique: true })

const modelCache = new WeakMap<Connection, Model<CashBalanceSnapshotDocument>>()

/** Returns the CashBalanceSnapshot model bound to the given tenant connection, compiling it once per connection. */
export function getCashBalanceSnapshotModel(connection: Connection): Model<CashBalanceSnapshotDocument> {
  const cached = modelCache.get(connection)
  if (cached) return cached
  const model =
    (connection.models.CashBalanceSnapshot as Model<CashBalanceSnapshotDocument>) ||
    connection.model<CashBalanceSnapshotDocument>('CashBalanceSnapshot', cashBalanceSnapshotSchema)
  modelCache.set(connection, model)
  return model
}
