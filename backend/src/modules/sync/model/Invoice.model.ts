import { Schema, Document, Types, Connection, Model } from 'mongoose'

/**
 * Generic, per-tenant invoice record — QuickBooks' `Invoice` object. Lives in
 * the organization's own tenant database, same pattern as Contact/Deal.
 * Deliberately narrow (per-invoice total, not per-line-item detail): the only
 * MVP metrics that read this today (VC-01/VC-02) need nothing finer than a
 * customer's total revenue per month. Line-item/Class/Item detail is a later
 * addition (VC-04/VC-12/VC-13's chart-of-accounts and recurring-revenue
 * tagging) — don't widen this ahead of that need.
 */
export interface InvoiceDocument extends Document {
  _id: Types.ObjectId
  orgId: Types.ObjectId
  provider: string
  providerRecordId: string
  customerRecordId: string
  txnDate: Date
  totalAmount: number
  createdAt: Date
  updatedAt: Date
}

const invoiceSchema = new Schema<InvoiceDocument>(
  {
    orgId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    provider: { type: String, required: true },
    providerRecordId: { type: String, required: true },
    customerRecordId: { type: String, required: true },
    txnDate: { type: Date, required: true },
    totalAmount: { type: Number, required: true }
  },
  { timestamps: true }
)

invoiceSchema.index({ orgId: 1, provider: 1, providerRecordId: 1 }, { unique: true })
// Backs the revenue roll-forward's per-customer-per-month aggregation (Shared Building Blocks).
invoiceSchema.index({ orgId: 1, provider: 1, customerRecordId: 1, txnDate: 1 })

const modelCache = new WeakMap<Connection, Model<InvoiceDocument>>()

/** Returns the Invoice model bound to the given tenant connection, compiling it once per connection. */
export function getInvoiceModel(connection: Connection): Model<InvoiceDocument> {
  const cached = modelCache.get(connection)
  if (cached) return cached
  const model =
    (connection.models.Invoice as Model<InvoiceDocument>) ||
    connection.model<InvoiceDocument>('Invoice', invoiceSchema)
  modelCache.set(connection, model)
  return model
}
