import { Schema, Document, Types, Connection, Model } from 'mongoose'

/**
 * Generic, per-tenant invoice record — QuickBooks' `Invoice` object. Lives in
 * the organization's own tenant database, same pattern as Contact/Deal.
 *
 * `lines` carries each invoiced line's Item reference and amount — added for
 * the frequency-aware recurring-revenue GRR/NRR roll-forward
 * (revenueRollForward.service.ts's `computeRecurring*RollForward`), which
 * needs to know which Item (Product) each dollar belongs to so it can look
 * up that product's category/billingFrequency. Only lines with a resolvable
 * ItemRef are kept (discount/subtotal/description lines have none and are
 * dropped) — every metric that reads `lines` already tolerates `[]`.
 */
export interface InvoiceLineDocument {
  itemId: string
  amount: number
}

export interface InvoiceDocument extends Document {
  _id: Types.ObjectId
  orgId: Types.ObjectId
  provider: string
  providerRecordId: string
  customerRecordId: string
  txnDate: Date
  totalAmount: number
  lines: InvoiceLineDocument[]
  createdAt: Date
  updatedAt: Date
}

const invoiceLineSchema = new Schema<InvoiceLineDocument>({ itemId: { type: String, required: true }, amount: { type: Number, required: true } }, { _id: false })

const invoiceSchema = new Schema<InvoiceDocument>(
  {
    orgId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    provider: { type: String, required: true },
    providerRecordId: { type: String, required: true },
    customerRecordId: { type: String, required: true },
    txnDate: { type: Date, required: true },
    totalAmount: { type: Number, required: true },
    lines: { type: [invoiceLineSchema], default: [] }
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
