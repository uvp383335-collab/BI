import { invoiceRepository } from '../../sync/repository/invoice.repository'
import { quickBooksCustomerRepository } from '../../sync/repository/quickBooksCustomer.repository'

const QUICKBOOKS_PROVIDER = 'quickbooks'
const round1 = (n: number): number => Math.round(n * 10) / 10

export interface CustomerRevenueConcentrationRow {
  customerId: string
  customerName: string
  revenue: number
  pctOfTotal: number
}

export interface CustomerRevenueConcentrationResult {
  rows: CustomerRevenueConcentrationRow[]
  top10Pct: number
  totalRevenue: number
}

/**
 * Dashboard chart below "Opportunities by Lead Source by Month": revenue
 * concentration among the org's top 10 QuickBooks customers — each of the
 * top 10's all-time invoiced revenue, plus what share of *all* invoiced
 * revenue those 10 customers account for. Same subsidiary roll-up as CM-02
 * (QuickBooks `Customer.ParentRef`, so a parent and its sub-accounts count
 * as one customer rather than diluting each other's rank) and the same
 * "Customer Concentration" concept, but all-time across every synced
 * invoice rather than CM-02's trailing-twelve-month window — this chart
 * answers "who are the top 10 and how much do they make up," not "is
 * concentration trending up year over year." QuickBooks-only: invoice data
 * isn't synced from HubSpot/Salesforce. Pass `itemId` to narrow to one
 * product's line-item revenue — "which customers make up this product's
 * revenue" — rather than every product blended together.
 */
export async function getCustomerRevenueConcentration(orgId: string, itemId?: string): Promise<CustomerRevenueConcentrationResult> {
  const [rows, customers] = await Promise.all([
    invoiceRepository.getTotalRevenueByCustomer(orgId, QUICKBOOKS_PROVIDER, itemId),
    quickBooksCustomerRepository.findAll(orgId, QUICKBOOKS_PROVIDER)
  ])

  const parentById = new Map(customers.map((c) => [c.providerRecordId, c.parentRecordId]))
  const nameById = new Map(customers.map((c) => [c.providerRecordId, c.displayName ?? c.providerRecordId]))

  function resolveRootId(customerId: string): string {
    const visited = new Set<string>()
    let current = customerId
    for (;;) {
      const parent = parentById.get(current)
      if (!parent || visited.has(current)) return current
      visited.add(current)
      current = parent
    }
  }

  const revenueByRoot = new Map<string, number>()
  for (const row of rows) {
    const rootId = resolveRootId(row.customerRecordId)
    revenueByRoot.set(rootId, (revenueByRoot.get(rootId) ?? 0) + row.revenue)
  }

  const totalRevenue = Array.from(revenueByRoot.values()).reduce((sum, revenue) => sum + revenue, 0)

  const sorted = Array.from(revenueByRoot.entries())
    .map(([customerId, revenue]) => ({ customerId, revenue }))
    .sort((a, b) => b.revenue - a.revenue)

  const top10 = sorted.slice(0, 10)
  const top10Revenue = top10.reduce((sum, c) => sum + c.revenue, 0)
  const top10Pct = totalRevenue > 0 ? (top10Revenue / totalRevenue) * 100 : 0

  const topRows = top10.map((c) => ({
    customerId: c.customerId,
    customerName: nameById.get(c.customerId) ?? c.customerId,
    revenue: round1(c.revenue),
    pctOfTotal: totalRevenue > 0 ? round1((c.revenue / totalRevenue) * 100) : 0
  }))

  return { rows: topRows, top10Pct: round1(top10Pct), totalRevenue: round1(totalRevenue) }
}

export interface CustomerRevenueConcentrationDetailLine {
  providerRecordId: string
  /** The actual billed customer — may be a subsidiary of rootCustomerId, not the root itself. */
  customerRecordId: string
  customerName: string
  rootCustomerId: string
  rootCustomerName: string
  /** "YYYY-MM-DD" */
  txnDate: string
  amount: number
}

export interface CustomerRevenueConcentrationDetailResult {
  rows: CustomerRevenueConcentrationRow[]
  top10Pct: number
  totalRevenue: number
  /** Every synced invoice (or invoice line, when filtered by product) billed to the top 10 customers above or any of their subsidiaries — sums to rows[].revenue exactly per root customer. */
  lines: CustomerRevenueConcentrationDetailLine[]
}

/**
 * Record-level backing data for "Customer Concentration" — every synced
 * invoice (or invoice line, when `itemId` is given) billed to one of the top
 * 10 customers above or any subsidiary that rolls up to it, for the chart's
 * "export to Excel" verification button. Recomputes the same top-10
 * ranking as getCustomerRevenueConcentration (not passed in from the
 * client) so the export always reflects the current data, then narrows the
 * line-level query to just those 10 roots' customer ids — pulling invoice
 * lines for every customer in the org would dwarf the chart this is meant
 * to verify.
 */
export async function getCustomerRevenueConcentrationDetail(orgId: string, itemId?: string): Promise<CustomerRevenueConcentrationDetailResult> {
  const [{ rows, top10Pct, totalRevenue }, customers] = await Promise.all([
    getCustomerRevenueConcentration(orgId, itemId),
    quickBooksCustomerRepository.findAll(orgId, QUICKBOOKS_PROVIDER)
  ])

  const parentById = new Map(customers.map((c) => [c.providerRecordId, c.parentRecordId]))
  const nameById = new Map(customers.map((c) => [c.providerRecordId, c.displayName ?? c.providerRecordId]))

  function resolveRootId(customerId: string): string {
    const visited = new Set<string>()
    let current = customerId
    for (;;) {
      const parent = parentById.get(current)
      if (!parent || visited.has(current)) return current
      visited.add(current)
      current = parent
    }
  }

  const topRootIds = new Set(rows.map((r) => r.customerId))
  const rootByCustomerId = new Map<string, string>()
  for (const customer of customers) {
    const root = resolveRootId(customer.providerRecordId)
    if (topRootIds.has(root)) rootByCustomerId.set(customer.providerRecordId, root)
  }
  // The root itself might not be in `customers` as a distinct row if it only ever appears as a parent reference — make sure every top-10 root maps to itself too.
  for (const rootId of topRootIds) rootByCustomerId.set(rootId, rootId)

  const customerIdsToQuery = Array.from(rootByCustomerId.keys())
  const invoiceLines = customerIdsToQuery.length > 0 ? await invoiceRepository.getInvoiceLinesForCustomers(orgId, QUICKBOOKS_PROVIDER, customerIdsToQuery, itemId) : []

  const rootNameById = new Map(rows.map((r) => [r.customerId, r.customerName]))

  const lines: CustomerRevenueConcentrationDetailLine[] = invoiceLines.map((line) => {
    const rootCustomerId = rootByCustomerId.get(line.customerRecordId) ?? line.customerRecordId
    return {
      providerRecordId: line.providerRecordId,
      customerRecordId: line.customerRecordId,
      customerName: nameById.get(line.customerRecordId) ?? line.customerRecordId,
      rootCustomerId,
      rootCustomerName: rootNameById.get(rootCustomerId) ?? rootCustomerId,
      txnDate: line.txnDate.toISOString().slice(0, 10),
      amount: line.amount
    }
  })

  lines.sort((a, b) => a.rootCustomerName.localeCompare(b.rootCustomerName) || a.txnDate.localeCompare(b.txnDate))

  return { rows, top10Pct, totalRevenue, lines }
}
