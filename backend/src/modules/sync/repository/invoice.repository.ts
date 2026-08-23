import { Connection, Types } from 'mongoose'
import { getInvoiceModel } from '../model/Invoice.model'
import { getTenantConnection } from '../../../database/tenantConnection'

export interface InvoiceUpsertInput {
  providerRecordId: string
  customerRecordId: string
  txnDate: Date
  totalAmount: number
}

export interface CustomerMonthRevenue {
  customerRecordId: string
  /** "YYYY-MM" */
  month: string
  revenue: number
}

async function modelForOrg(orgId: string | Types.ObjectId) {
  const connection: Connection = await getTenantConnection(orgId.toString())
  return getInvoiceModel(connection)
}

export const invoiceRepository = {
  async count(orgId: string | Types.ObjectId, provider: string) {
    const Model = await modelForOrg(orgId)
    return Model.countDocuments({ orgId, provider })
  },

  async bulkUpsert(orgId: string | Types.ObjectId, provider: string, invoices: InvoiceUpsertInput[]) {
    if (invoices.length === 0) return
    const Model = await modelForOrg(orgId)
    const orgObjectId = new Types.ObjectId(orgId)
    const operations = invoices.map((invoice) => ({
      updateOne: {
        filter: { orgId: orgObjectId, provider, providerRecordId: invoice.providerRecordId },
        update: { $set: { orgId: orgObjectId, provider, ...invoice } },
        upsert: true
      }
    }))
    await Model.bulkWrite(operations, { ordered: false })
  },

  /**
   * The customer revenue roll-forward's raw input (Shared Building Blocks in
   * the metrics guide): every customer's total invoiced revenue per calendar
   * month, over `[from, to]`. Grouping happens in the aggregation, not in
   * application code, so it stays correct as invoice volume grows.
   */
  async getMonthlyRevenueByCustomer(
    orgId: string | Types.ObjectId,
    provider: string,
    from: Date,
    to: Date
  ): Promise<CustomerMonthRevenue[]> {
    const Model = await modelForOrg(orgId)
    const orgObjectId = new Types.ObjectId(orgId)
    const results = await Model.aggregate<{ _id: { customerRecordId: string; month: string }; revenue: number }>([
      { $match: { orgId: orgObjectId, provider, txnDate: { $gte: from, $lte: to } } },
      {
        $group: {
          _id: {
            customerRecordId: '$customerRecordId',
            month: { $dateToString: { format: '%Y-%m', date: '$txnDate' } }
          },
          revenue: { $sum: '$totalAmount' }
        }
      }
    ])
    return results.map((r) => ({ customerRecordId: r._id.customerRecordId, month: r._id.month, revenue: r.revenue }))
  },

  /**
   * Every distinct customer with at least one invoice strictly before
   * `before` — the revenue roll-forward's "is this a true new logo, or a
   * win-back" check (metrics guide gap G-20: a customer whose revenue was
   * $0 only within the comparison window, but who has invoices further
   * back, is a win-back, not a new customer). Looks at the customer's
   * *entire* invoice history, not just the window being compared.
   */
  async findCustomerIdsWithInvoiceBefore(orgId: string | Types.ObjectId, provider: string, before: Date): Promise<Set<string>> {
    const Model = await modelForOrg(orgId)
    const ids = await Model.distinct('customerRecordId', { orgId, provider, txnDate: { $lt: before } })
    return new Set(ids)
  }
}
