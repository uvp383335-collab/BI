import { Connection, Types } from 'mongoose'
import { getInvoiceModel, InvoiceLineDocument } from '../model/Invoice.model'
import { getTenantConnection } from '../../../database/tenantConnection'
import { ProductBillingFrequency } from '../model/Product.model'

export interface InvoiceUpsertInput {
  providerRecordId: string
  customerRecordId: string
  txnDate: Date
  totalAmount: number
  lines: InvoiceLineDocument[]
}

export interface CustomerMonthRevenue {
  customerRecordId: string
  /** "YYYY-MM" */
  month: string
  revenue: number
}

export interface CustomerMonthRecurringRevenue {
  customerRecordId: string
  /** "YYYY-MM" of the calendar month the revenue was invoiced in — the recurring roll-forward rolls this up into whatever period its `billingFrequency` actually recurs on (month/quarter/year). */
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

  /**
   * True once at least one invoice has a populated `lines` array. `lines`
   * was added after invoices were already being synced — an org whose
   * invoices were last synced before that only has it on newly-created
   * invoices since (incremental syncs only re-fetch what changed), not on
   * their historical invoices, until a forced resync backfills it. Callers
   * that need `lines` (the recurring-revenue monthly trend, GRR/NRR) use
   * this to tell "no recurring revenue this window" apart from "this org's
   * invoice data hasn't been backfilled yet."
   */
  async hasAnyLineItems(orgId: string | Types.ObjectId, provider: string): Promise<boolean> {
    const Model = await modelForOrg(orgId)
    const match = await Model.exists({ orgId, provider, 'lines.0': { $exists: true } })
    return !!match
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
   * Every customer's total invoiced revenue per calendar month, over
   * `[from, to]`, restricted to line items billed against a product
   * categorized `recurring` with the given `billingFrequency` (joined
   * against the tenant DB's own `products` collection by `itemId`). The
   * recurring-revenue roll-forward (revenueRollForward.service.ts) rolls
   * these month-grain rows up into whatever period that frequency actually
   * recurs on — a month for 'monthly', a quarter for 'quarterly', a year for
   * 'yearly' — so it can compare each product's revenue the way it actually
   * bills instead of always month-over-month.
   */
  async getRecurringRevenueByCustomerAndMonth(
    orgId: string | Types.ObjectId,
    provider: string,
    from: Date,
    to: Date,
    billingFrequency: ProductBillingFrequency
  ): Promise<CustomerMonthRecurringRevenue[]> {
    const Model = await modelForOrg(orgId)
    const orgObjectId = new Types.ObjectId(orgId)
    const results = await Model.aggregate<{ _id: { customerRecordId: string; month: string }; revenue: number }>([
      { $match: { orgId: orgObjectId, provider, txnDate: { $gte: from, $lte: to }, 'lines.0': { $exists: true } } },
      { $unwind: '$lines' },
      {
        $lookup: {
          from: 'products',
          let: { itemId: '$lines.itemId' },
          pipeline: [
            { $match: { $expr: { $and: [{ $eq: ['$orgId', orgObjectId] }, { $eq: ['$provider', provider] }, { $eq: ['$providerRecordId', '$$itemId'] }] } } }
          ],
          as: 'product'
        }
      },
      { $unwind: '$product' },
      { $match: { 'product.category': 'recurring', 'product.billingFrequency': billingFrequency } },
      {
        $group: {
          _id: { customerRecordId: '$customerRecordId', month: { $dateToString: { format: '%Y-%m', date: '$txnDate' } } },
          revenue: { $sum: '$lines.amount' }
        }
      }
    ])
    return results.map((r) => ({ customerRecordId: r._id.customerRecordId, month: r._id.month, revenue: r.revenue }))
  },

  /**
   * Total invoiced revenue per calendar month, over `[from, to]`, bucketed
   * by each line's product category (`recurring`/`non_recurring`, joined
   * against the tenant DB's own `products` collection by `itemId`) —
   * `not_sure`/uncategorized products are excluded entirely. Backs the
   * dashboard's recurring-revenue trend chart's *monthly* view
   * (recurringRevenueTrend.service.ts): `PLItemSnapshot` only has quarterly
   * grain, so the monthly view reads invoice line items directly instead —
   * unlike the quarterly view, this can differ slightly from P&L income
   * (invoice-date timing vs. accrual recognition).
   */
  async getRevenueByCategoryAndMonth(
    orgId: string | Types.ObjectId,
    provider: string,
    from: Date,
    to: Date
  ): Promise<{ month: string; category: 'recurring' | 'non_recurring'; revenue: number }[]> {
    const Model = await modelForOrg(orgId)
    const orgObjectId = new Types.ObjectId(orgId)
    const results = await Model.aggregate<{ _id: { month: string; category: 'recurring' | 'non_recurring' }; revenue: number }>([
      { $match: { orgId: orgObjectId, provider, txnDate: { $gte: from, $lte: to }, 'lines.0': { $exists: true } } },
      { $unwind: '$lines' },
      {
        $lookup: {
          from: 'products',
          let: { itemId: '$lines.itemId' },
          pipeline: [
            { $match: { $expr: { $and: [{ $eq: ['$orgId', orgObjectId] }, { $eq: ['$provider', provider] }, { $eq: ['$providerRecordId', '$$itemId'] }] } } }
          ],
          as: 'product'
        }
      },
      { $unwind: '$product' },
      { $match: { 'product.category': { $in: ['recurring', 'non_recurring'] } } },
      {
        $group: {
          _id: { month: { $dateToString: { format: '%Y-%m', date: '$txnDate' } }, category: '$product.category' },
          revenue: { $sum: '$lines.amount' }
        }
      }
    ])
    return results.map((r) => ({ month: r._id.month, category: r._id.category, revenue: r.revenue }))
  },

  /**
   * Every customer's total invoiced revenue per calendar month, over
   * `[from, to]`, for ONE specific product's line items only (`itemId`) —
   * the dashboard's "customer upgrades" trend's raw input
   * (customerUpgradesTrend.service.ts): a customer whose revenue for this
   * one product went up from one period to the next is an upgrade.
   */
  async getCustomerRevenueByMonthForItem(
    orgId: string | Types.ObjectId,
    provider: string,
    from: Date,
    to: Date,
    itemId: string
  ): Promise<{ customerRecordId: string; month: string; revenue: number }[]> {
    const Model = await modelForOrg(orgId)
    const orgObjectId = new Types.ObjectId(orgId)
    const results = await Model.aggregate<{ _id: { customerRecordId: string; month: string }; revenue: number }>([
      { $match: { orgId: orgObjectId, provider, txnDate: { $gte: from, $lte: to }, 'lines.itemId': itemId } },
      { $unwind: '$lines' },
      { $match: { 'lines.itemId': itemId } },
      {
        $group: {
          _id: { customerRecordId: '$customerRecordId', month: { $dateToString: { format: '%Y-%m', date: '$txnDate' } } },
          revenue: { $sum: '$lines.amount' }
        }
      }
    ])
    return results.map((r) => ({ customerRecordId: r._id.customerRecordId, month: r._id.month, revenue: r.revenue }))
  },

  /**
   * How many customers' very first invoice ever (across the customer's
   * entire history, not just `[from, to]`) falls within `[from, to]`,
   * bucketed by that first-invoice month — "how many new customers did we
   * get" read directly off invoices rather than VC-03's revenue-weighted
   * roll-forward (which tracks new-logo *revenue*, not a customer headcount,
   * and compares two specific snapshot months rather than every month in a
   * range). A customer's first invoice ever being inside the window is what
   * makes them new; one more invoice from them next month doesn't make them
   * new again. `amount` is the revenue from that same first invoice (or, for
   * `itemId`, that first invoice's matching line items only) — the "amount
   * wise" view alongside the "customer wise" headcount.
   *
   * When `itemId` is given, "new" narrows to that product specifically: a
   * customer counts in the month of their first invoice *containing that
   * product's line item* — which can be well after they became a customer
   * at all (an existing customer trying a product for the first time), not
   * only a brand-new customer's very first invoice.
   */
  async getNewCustomerCountsByMonth(
    orgId: string | Types.ObjectId,
    provider: string,
    from: Date,
    to: Date,
    itemId?: string
  ): Promise<{ month: string; count: number; amount: number }[]> {
    const Model = await modelForOrg(orgId)
    const orgObjectId = new Types.ObjectId(orgId)
    const results = await Model.aggregate<{ _id: string; count: number; amount: number }>([
      { $match: { orgId: orgObjectId, provider, ...(itemId ? { 'lines.itemId': itemId } : {}) } },
      ...(itemId ? [{ $unwind: '$lines' }, { $match: { 'lines.itemId': itemId } }] : []),
      // Same-day documents/lines are summed together first, so a customer with two same-day
      // invoices (or two matching lines on one invoice) contributes one combined "first amount."
      {
        $group: {
          _id: { customerRecordId: '$customerRecordId', txnDate: '$txnDate' },
          amount: { $sum: itemId ? '$lines.amount' : '$totalAmount' }
        }
      },
      { $sort: { '_id.customerRecordId': 1, '_id.txnDate': 1 } },
      { $group: { _id: '$_id.customerRecordId', firstInvoiceDate: { $first: '$_id.txnDate' }, firstAmount: { $first: '$amount' } } },
      { $match: { firstInvoiceDate: { $gte: from, $lte: to } } },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m', date: '$firstInvoiceDate' } },
          count: { $sum: 1 },
          amount: { $sum: '$firstAmount' }
        }
      }
    ])
    return results.map((r) => ({ month: r._id, count: r.count, amount: r.amount }))
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
