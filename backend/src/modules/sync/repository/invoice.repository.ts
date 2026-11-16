import { Connection, Types, PipelineStage } from 'mongoose'
import { getInvoiceModel, InvoiceLineDocument, InvoiceBillingAddressDocument } from '../model/Invoice.model'
import { getTenantConnection } from '../../../database/tenantConnection'
import { ProductBillingFrequency } from '../model/Product.model'

export interface InvoiceUpsertInput {
  providerRecordId: string
  customerRecordId: string
  txnDate: Date
  totalAmount: number
  lines: InvoiceLineDocument[]
  billingAddress?: InvoiceBillingAddressDocument
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
   * Same window/filter as `getRevenueByCategoryAndMonth`, but grouped down to
   * the individual product too — the per-product rows behind the "recurring
   * vs. non-recurring revenue" chart's Excel export (recurringRevenueTrend
   * .service.ts), so the monthly totals shown on screen can be verified
   * against which products actually rolled into each bucket.
   */
  async getRevenueByProductCategoryAndMonth(
    orgId: string | Types.ObjectId,
    provider: string,
    from: Date,
    to: Date
  ): Promise<{ month: string; category: 'recurring' | 'non_recurring'; productName: string; revenue: number }[]> {
    const Model = await modelForOrg(orgId)
    const orgObjectId = new Types.ObjectId(orgId)
    const results = await Model.aggregate<{ _id: { month: string; category: 'recurring' | 'non_recurring'; productName: string }; revenue: number }>([
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
          _id: { month: { $dateToString: { format: '%Y-%m', date: '$txnDate' } }, category: '$product.category', productName: '$product.name' },
          revenue: { $sum: '$lines.amount' }
        }
      }
    ])
    return results.map((r) => ({ month: r._id.month, category: r._id.category, productName: r._id.productName, revenue: r.revenue }))
  },

  /**
   * The literal QuickBooks invoice lines behind `getRevenueByProductCategoryAndMonth`/
   * `getRevenueByCategoryAndMonth` — same match/lookup/filter, but one row per invoice
   * line instead of summed away, so the "recurring vs. non-recurring revenue" chart's
   * Excel export can show exactly which invoices (not just which products) were imported
   * from QuickBooks and rolled into each period's total.
   */
  async getRevenueByProductCategoryInvoiceLines(
    orgId: string | Types.ObjectId,
    provider: string,
    from: Date,
    to: Date
  ): Promise<
    { providerRecordId: string; txnDate: Date; customerName: string | null; productName: string; category: 'recurring' | 'non_recurring'; lineAmount: number; invoiceTotalAmount: number }[]
  > {
    const Model = await modelForOrg(orgId)
    const orgObjectId = new Types.ObjectId(orgId)
    const results = await Model.aggregate<{
      providerRecordId: string
      txnDate: Date
      customerName: string | null
      productName: string
      category: 'recurring' | 'non_recurring'
      lineAmount: number
      invoiceTotalAmount: number
    }>([
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
        $lookup: {
          from: 'quickbookscustomers',
          let: { customerId: '$customerRecordId' },
          pipeline: [
            { $match: { $expr: { $and: [{ $eq: ['$orgId', orgObjectId] }, { $eq: ['$provider', provider] }, { $eq: ['$providerRecordId', '$$customerId'] }] } } }
          ],
          as: 'customer'
        }
      },
      { $unwind: { path: '$customer', preserveNullAndEmptyArrays: true } },
      { $sort: { txnDate: 1 } },
      {
        $project: {
          _id: 0,
          providerRecordId: 1,
          txnDate: 1,
          customerName: { $ifNull: ['$customer.displayName', null] },
          productName: '$product.name',
          category: '$product.category',
          lineAmount: '$lines.amount',
          invoiceTotalAmount: '$totalAmount'
        }
      }
    ])
    return results
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
   * Every individual invoice line billed against one product (`itemId`),
   * over `[from, to]`, with its customer's display name joined in — the
   * "Revenue growth by product" chart's nearest local, invoice-level
   * backing data for its "export to Excel" verification button. Unlike
   * getCustomerRevenueByMonthForItem above, this is deliberately ungrouped
   * (one row per invoice line, not summed per customer/month): the point is
   * to let someone open one specific invoice in QuickBooks and check it
   * against a row here, not to re-derive the same monthly total a different
   * way. See productRevenueGrowth.service.ts's getProductRevenueGrowthDetail
   * for why this won't tie out exactly to the chart's own number (that's
   * read live off QuickBooks' accrual P&L report, not summed from synced
   * invoices).
   */
  async getInvoiceLinesForItem(
    orgId: string | Types.ObjectId,
    provider: string,
    from: Date,
    to: Date,
    itemId: string
  ): Promise<{ providerRecordId: string; customerRecordId: string; customerName: string | null; txnDate: Date; lineAmount: number; invoiceTotalAmount: number }[]> {
    const Model = await modelForOrg(orgId)
    const orgObjectId = new Types.ObjectId(orgId)
    const results = await Model.aggregate<{
      providerRecordId: string
      customerRecordId: string
      customerName: string | null
      txnDate: Date
      lineAmount: number
      invoiceTotalAmount: number
    }>([
      { $match: { orgId: orgObjectId, provider, txnDate: { $gte: from, $lte: to }, 'lines.itemId': itemId } },
      { $unwind: '$lines' },
      { $match: { 'lines.itemId': itemId } },
      {
        $lookup: {
          from: 'quickbookscustomers',
          let: { customerId: '$customerRecordId' },
          pipeline: [
            { $match: { $expr: { $and: [{ $eq: ['$orgId', orgObjectId] }, { $eq: ['$provider', provider] }, { $eq: ['$providerRecordId', '$$customerId'] }] } } }
          ],
          as: 'customer'
        }
      },
      { $unwind: { path: '$customer', preserveNullAndEmptyArrays: true } },
      { $sort: { txnDate: 1 } },
      {
        $project: {
          _id: 0,
          providerRecordId: 1,
          customerRecordId: 1,
          customerName: { $ifNull: ['$customer.displayName', null] },
          txnDate: 1,
          lineAmount: '$lines.amount',
          invoiceTotalAmount: '$totalAmount'
        }
      }
    ])
    return results
  },

  /**
   * Total invoiced revenue per calendar month, over `[from, to]`, grouped by
   * line item (`itemId`) — every product's monthly revenue in one query,
   * read entirely from this org's own synced `Invoice` line items. Backs the
   * dashboard's invoice-data version of "Revenue growth by product"
   * (productRevenueGrowth.service.ts's getInvoiceRevenueGrowthByProduct):
   * unlike getProductRevenueGrowth's live per-product QuickBooks Profit &
   * Loss report (one request per product), this never calls QuickBooks and
   * covers every product at once.
   */
  async getRevenueByItemAndMonth(
    orgId: string | Types.ObjectId,
    provider: string,
    from: Date,
    to: Date
  ): Promise<{ itemId: string; month: string; revenue: number }[]> {
    const Model = await modelForOrg(orgId)
    const orgObjectId = new Types.ObjectId(orgId)
    const results = await Model.aggregate<{ _id: { itemId: string; month: string }; revenue: number }>([
      { $match: { orgId: orgObjectId, provider, txnDate: { $gte: from, $lte: to }, 'lines.0': { $exists: true } } },
      { $unwind: '$lines' },
      {
        $group: {
          _id: { itemId: '$lines.itemId', month: { $dateToString: { format: '%Y-%m', date: '$txnDate' } } },
          revenue: { $sum: '$lines.amount' }
        }
      }
    ])
    return results.map((r) => ({ itemId: r._id.itemId, month: r._id.month, revenue: r.revenue }))
  },

  /**
   * Total invoiced revenue per calendar month, over `[from, to]`, grouped by
   * the invoice's own billing-address state (`billingAddress.state`, synced
   * from QuickBooks' `Invoice.BillAddr.CountrySubDivisionCode`) — every
   * state's monthly revenue in one query, read entirely from this org's own
   * synced `Invoice` documents. Backs "Revenue growth by location"
   * (productRevenueGrowth.service.ts's getInvoiceRevenueGrowthByState).
   * Invoices synced before billing addresses were added (or that QuickBooks
   * never attached a billing address to) have no `billingAddress.state` and
   * are excluded here rather than bucketed under a fake "Unknown" state —
   * a forced resync (Settings > QuickBooks > "Force full resync") backfills
   * them.
   *
   * Pass `itemId` to narrow to one product's revenue by state instead of
   * every product combined — "how is <product> doing in <state>." Mirrors
   * getRevenueByItemAndMonth's line-level sum when filtering (only that
   * product's line amount counts per invoice) rather than the whole
   * invoice total, so a multi-product invoice doesn't over-attribute its
   * other products' revenue to the filtered one.
   */
  async getRevenueByStateAndMonth(
    orgId: string | Types.ObjectId,
    provider: string,
    from: Date,
    to: Date,
    itemId?: string
  ): Promise<{ state: string; month: string; revenue: number }[]> {
    const Model = await modelForOrg(orgId)
    const orgObjectId = new Types.ObjectId(orgId)
    const match: Record<string, unknown> = {
      orgId: orgObjectId,
      provider,
      txnDate: { $gte: from, $lte: to },
      'billingAddress.state': { $exists: true, $ne: null }
    }
    const pipeline = itemId
      ? [
          { $match: { ...match, 'lines.itemId': itemId } },
          { $unwind: '$lines' },
          { $match: { 'lines.itemId': itemId } },
          {
            $group: {
              _id: { state: '$billingAddress.state', month: { $dateToString: { format: '%Y-%m', date: '$txnDate' } } },
              revenue: { $sum: '$lines.amount' }
            }
          }
        ]
      : [
          { $match: match },
          {
            $group: {
              _id: { state: '$billingAddress.state', month: { $dateToString: { format: '%Y-%m', date: '$txnDate' } } },
              revenue: { $sum: '$totalAmount' }
            }
          }
        ]
    const results = await Model.aggregate<{ _id: { state: string; month: string }; revenue: number }>(pipeline)
    return results.map((r) => ({ state: r._id.state, month: r._id.month, revenue: r.revenue }))
  },

  /**
   * Every individual invoice (or, when `itemId` is given, every invoice
   * line for that product) billed to one billing-address state, over
   * `[from, to]`, with customer display names joined in — the "Revenue
   * growth by location" card's nearest record-level backing data, for its
   * "export to Excel" verification button. Same dual-mode split as
   * getRevenueByStateAndMonth above: whole-invoice `totalAmount` when no
   * product filter, that product's own `lines.amount` when filtered — so
   * the totals here always match whichever one that method computed.
   */
  async getInvoiceDetailByState(
    orgId: string | Types.ObjectId,
    provider: string,
    from: Date,
    to: Date,
    state: string,
    itemId?: string
  ): Promise<{ providerRecordId: string; customerRecordId: string; customerName: string | null; txnDate: Date; amount: number; invoiceTotalAmount: number }[]> {
    const Model = await modelForOrg(orgId)
    const orgObjectId = new Types.ObjectId(orgId)
    const match: Record<string, unknown> = { orgId: orgObjectId, provider, txnDate: { $gte: from, $lte: to }, 'billingAddress.state': state }
    const customerLookup: PipelineStage[] = [
      {
        $lookup: {
          from: 'quickbookscustomers',
          let: { customerId: '$customerRecordId' },
          pipeline: [
            { $match: { $expr: { $and: [{ $eq: ['$orgId', orgObjectId] }, { $eq: ['$provider', provider] }, { $eq: ['$providerRecordId', '$$customerId'] }] } } }
          ],
          as: 'customer'
        }
      },
      { $unwind: { path: '$customer', preserveNullAndEmptyArrays: true } },
      { $sort: { txnDate: 1 } }
    ]
    const pipeline: PipelineStage[] = itemId
      ? [
          { $match: { ...match, 'lines.itemId': itemId } },
          { $unwind: '$lines' },
          { $match: { 'lines.itemId': itemId } },
          ...customerLookup,
          {
            $project: {
              _id: 0,
              providerRecordId: 1,
              customerRecordId: 1,
              customerName: { $ifNull: ['$customer.displayName', null] },
              txnDate: 1,
              amount: '$lines.amount',
              invoiceTotalAmount: '$totalAmount'
            }
          }
        ]
      : [
          { $match: match },
          ...customerLookup,
          {
            $project: {
              _id: 0,
              providerRecordId: 1,
              customerRecordId: 1,
              customerName: { $ifNull: ['$customer.displayName', null] },
              txnDate: 1,
              amount: '$totalAmount',
              invoiceTotalAmount: '$totalAmount'
            }
          }
        ]
    const results = await Model.aggregate<{
      providerRecordId: string
      customerRecordId: string
      customerName: string | null
      txnDate: Date
      amount: number
      invoiceTotalAmount: number
    }>(pipeline)
    return results
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
   * Same per-customer "first invoice" computation as getNewCustomerCountsByMonth
   * above, stopping one stage earlier — one row per new customer instead of
   * collapsed to a monthly count/amount. The dashboard's "New customers"
   * card's "export to Excel" verification button: shows exactly which
   * customer each month's count/amount is made of, not just the total.
   */
  async getNewCustomerDetailRows(
    orgId: string | Types.ObjectId,
    provider: string,
    from: Date,
    to: Date,
    itemId?: string
  ): Promise<{ customerRecordId: string; firstInvoiceDate: Date; firstAmount: number }[]> {
    const Model = await modelForOrg(orgId)
    const orgObjectId = new Types.ObjectId(orgId)
    const results = await Model.aggregate<{ _id: string; firstInvoiceDate: Date; firstAmount: number }>([
      { $match: { orgId: orgObjectId, provider, ...(itemId ? { 'lines.itemId': itemId } : {}) } },
      ...(itemId ? [{ $unwind: '$lines' }, { $match: { 'lines.itemId': itemId } }] : []),
      {
        $group: {
          _id: { customerRecordId: '$customerRecordId', txnDate: '$txnDate' },
          amount: { $sum: itemId ? '$lines.amount' : '$totalAmount' }
        }
      },
      { $sort: { '_id.customerRecordId': 1, '_id.txnDate': 1 } },
      { $group: { _id: '$_id.customerRecordId', firstInvoiceDate: { $first: '$_id.txnDate' }, firstAmount: { $first: '$amount' } } },
      { $match: { firstInvoiceDate: { $gte: from, $lte: to } } }
    ])
    return results.map((r) => ({ customerRecordId: r._id, firstInvoiceDate: r.firstInvoiceDate, firstAmount: r.firstAmount }))
  },

  /**
   * Every customer's total invoiced revenue, across every synced invoice —
   * unlike getMonthlyRevenueByCustomer, this isn't windowed to a date
   * range, it's a straight all-time sum. The "Customer Concentration"
   * chart's raw input: how much of all-time revenue the top 10 customers
   * (after rolling subsidiaries up to their parent, same as CM-02) account
   * for. Pass `itemId` to narrow to one product's line-item revenue instead
   * of each invoice's whole `totalAmount` — "which customers make up this
   * product's revenue," same line-level narrowing as
   * getCustomerRevenueByMonthForItem.
   */
  async getTotalRevenueByCustomer(orgId: string | Types.ObjectId, provider: string, itemId?: string): Promise<{ customerRecordId: string; revenue: number }[]> {
    const Model = await modelForOrg(orgId)
    const orgObjectId = new Types.ObjectId(orgId)
    const pipeline: PipelineStage[] = itemId
      ? [
          { $match: { orgId: orgObjectId, provider, 'lines.itemId': itemId } },
          { $unwind: '$lines' },
          { $match: { 'lines.itemId': itemId } },
          { $group: { _id: '$customerRecordId', revenue: { $sum: '$lines.amount' } } }
        ]
      : [
          { $match: { orgId: orgObjectId, provider } },
          { $group: { _id: '$customerRecordId', revenue: { $sum: '$totalAmount' } } }
        ]
    const results = await Model.aggregate<{ _id: string; revenue: number }>(pipeline)
    return results.map((r) => ({ customerRecordId: r._id, revenue: r.revenue }))
  },

  /**
   * Every customer's total invoiced revenue per calendar month, across
   * every synced invoice — unlike getMonthlyRevenueByCustomer, this isn't
   * windowed to a date range, it covers the org's entire invoice history.
   * The "Customer Concentration" trend chart's raw input: how top-10
   * concentration moves from month to month. Pass `itemId` to narrow to one
   * product's line-item revenue, same convention as getTotalRevenueByCustomer.
   */
  async getAllMonthlyRevenueByCustomer(orgId: string | Types.ObjectId, provider: string, itemId?: string): Promise<CustomerMonthRevenue[]> {
    const Model = await modelForOrg(orgId)
    const orgObjectId = new Types.ObjectId(orgId)
    const pipeline: PipelineStage[] = itemId
      ? [
          { $match: { orgId: orgObjectId, provider, 'lines.itemId': itemId } },
          { $unwind: '$lines' },
          { $match: { 'lines.itemId': itemId } },
          {
            $group: {
              _id: { customerRecordId: '$customerRecordId', month: { $dateToString: { format: '%Y-%m', date: '$txnDate' } } },
              revenue: { $sum: '$lines.amount' }
            }
          }
        ]
      : [
          { $match: { orgId: orgObjectId, provider } },
          {
            $group: {
              _id: { customerRecordId: '$customerRecordId', month: { $dateToString: { format: '%Y-%m', date: '$txnDate' } } },
              revenue: { $sum: '$totalAmount' }
            }
          }
        ]
    const results = await Model.aggregate<{ _id: { customerRecordId: string; month: string }; revenue: number }>(pipeline)
    return results.map((r) => ({ customerRecordId: r._id.customerRecordId, month: r._id.month, revenue: r.revenue }))
  },

  /**
   * Every individual invoice (or, when `itemId` is given, every invoice line
   * for that product) billed to any customer in `customerRecordIds`, across
   * the org's entire invoice history (no date window — mirrors
   * getTotalRevenueByCustomer's all-time scope) — the "Customer
   * Concentration" chart's record-level backing data, for its "export to
   * Excel" verification button. Callers pass every subsidiary id that rolls
   * up to a top-10 root customer (CM-02's `Customer.ParentRef` roll-up), not
   * just the root's own id, so a parent's invoices and its subsidiaries'
   * invoices both show up under that one root. Same dual-mode split as
   * getInvoiceDetailByState: whole-invoice `totalAmount` when no product
   * filter, that product's own `lines.amount` when filtered.
   */
  async getInvoiceLinesForCustomers(
    orgId: string | Types.ObjectId,
    provider: string,
    customerRecordIds: string[],
    itemId?: string,
    /** Narrows to `[from, to]` instead of all-time — the "Customer Concentration by Month" trend's detail export, which only needs lines inside its trailing window, not every invoice ever. Omit both for the all-time chart's export. */
    from?: Date,
    to?: Date
  ): Promise<{ providerRecordId: string; customerRecordId: string; txnDate: Date; amount: number }[]> {
    const Model = await modelForOrg(orgId)
    const orgObjectId = new Types.ObjectId(orgId)
    const match: Record<string, unknown> = {
      orgId: orgObjectId,
      provider,
      customerRecordId: { $in: customerRecordIds },
      ...(from && to ? { txnDate: { $gte: from, $lte: to } } : {})
    }
    const pipeline: PipelineStage[] = itemId
      ? [
          { $match: { ...match, 'lines.itemId': itemId } },
          { $unwind: '$lines' },
          { $match: { 'lines.itemId': itemId } },
          { $sort: { txnDate: 1 } },
          { $project: { _id: 0, providerRecordId: 1, customerRecordId: 1, txnDate: 1, amount: '$lines.amount' } }
        ]
      : [
          { $match: match },
          { $sort: { txnDate: 1 } },
          { $project: { _id: 0, providerRecordId: 1, customerRecordId: 1, txnDate: 1, amount: '$totalAmount' } }
        ]
    const results = await Model.aggregate<{ providerRecordId: string; customerRecordId: string; txnDate: Date; amount: number }>(pipeline)
    return results
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
