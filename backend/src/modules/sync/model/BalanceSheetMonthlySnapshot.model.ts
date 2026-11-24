import { Schema, Document, Types, Connection, Model } from 'mongoose'

/**
 * A stored copy of one calendar month's whole-company QuickBooks Balance
 * Sheet report — sibling to `PLMonthlySnapshot`, same "read from here, never
 * call QuickBooks live at metric-request time" rule, just for the Balance
 * Sheet instead of the P&L. Each month's `sectionTotals` is that month's
 * end-of-month balance (Balance Sheet is point-in-time, not incremental like
 * P&L), one QuickBooks report call for the whole trailing window via
 * `summarize_column_by=Month` — same single-call-per-sync shape as
 * `syncQuickBooksProfitAndLossMonthly`.
 *
 * Deliberately narrow, same reasoning as `PLMonthlySnapshot`: section totals
 * only (no per-account `accountAmounts`) — this exists to back month-grain
 * Balance Sheet trends, not to duplicate `PLSnapshot`'s per-quarter
 * `accountAmounts` at a finer grain.
 */
export interface BalanceSheetMonthlySnapshotDocument extends Document {
  _id: Types.ObjectId
  orgId: Types.ObjectId
  provider: string
  /** "YYYY-MM" of this calendar month. */
  month: string
  /** The month's last day — Balance Sheet rows are "as of" this date. */
  asOfDate: string
  sectionTotals: Record<string, Record<string, number>>
  /**
   * Every chart-of-accounts leaf row on this month's Balance Sheet with its
   * month-end balance (QuickBooks account id, name, section e.g. `BankAccounts`).
   * Lets CB-05 sum chosen unrestricted cash accounts instead of the whole
   * BankAccounts total (which includes restricted cash).
   */
  accounts?: Array<{ id: string; name: string; section: string | null; amount: number }>
  fetchedAt: Date
  createdAt: Date
  updatedAt: Date
}

const balanceSheetMonthlySnapshotSchema = new Schema<BalanceSheetMonthlySnapshotDocument>(
  {
    orgId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    provider: { type: String, required: true },
    month: { type: String, required: true },
    asOfDate: { type: String, required: true },
    sectionTotals: { type: Schema.Types.Mixed, default: {} },
    accounts: { type: [Schema.Types.Mixed], default: [] },
    fetchedAt: { type: Date, required: true }
  },
  { timestamps: true }
)

// One snapshot per (orgId, provider, month) — a resync overwrites it in place, same as PLMonthlySnapshot.
balanceSheetMonthlySnapshotSchema.index({ orgId: 1, provider: 1, month: 1 }, { unique: true })

const modelCache = new WeakMap<Connection, Model<BalanceSheetMonthlySnapshotDocument>>()

/** Returns the BalanceSheetMonthlySnapshot model bound to the given tenant connection, compiling it once per connection. */
export function getBalanceSheetMonthlySnapshotModel(connection: Connection): Model<BalanceSheetMonthlySnapshotDocument> {
  const cached = modelCache.get(connection)
  if (cached) return cached
  const model =
    (connection.models.BalanceSheetMonthlySnapshot as Model<BalanceSheetMonthlySnapshotDocument>) ||
    connection.model<BalanceSheetMonthlySnapshotDocument>('BalanceSheetMonthlySnapshot', balanceSheetMonthlySnapshotSchema)
  modelCache.set(connection, model)
  return model
}
