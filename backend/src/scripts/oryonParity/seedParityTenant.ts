/**
 * Seeds an isolated "Oryon Parity Test" organization + tenant database used to
 * check that the Node Oryon metrics (modules/metrics/oryon) produce the same
 * numbers as the Python reference app (mrr_app/).
 *
 * QuickBooks data: the Ridgeline dataset's raw QuickBooks API JSON
 * (ridgeline_dataset/quickbooks), mapped with the exact same code paths the
 * QuickBooks sync uses (same field mapping, parseProfitAndLoss,
 * extractSectionTotals, extractLeafAccountsByColumn), so the stored documents
 * have the shape a real sync produces. All months in the files are stored
 * (the sync itself only keeps a trailing 36 months).
 *
 * CRM data (HubSpot + Salesforce deals, contacts, Salesforce accounts, stage
 * definitions): copied from an existing local tenant (default: ABC logistics),
 * with orgId rewritten.
 *
 * Usage (from backend/):
 *   npx tsx src/scripts/oryonParity/seedParityTenant.ts [datasetDir] [sourceTenantDb]
 */
import 'dotenv/config'
import fs from 'node:fs'
import path from 'node:path'
import mongoose, { Types } from 'mongoose'
import { connectDatabase } from '../../database/connection'
import { getTenantConnectionByDbName, closeAllTenantConnections } from '../../database/tenantConnection'
import { OrganizationModel } from '../../modules/organizations/model/Organization.model'
import { quickBooksCustomerRepository } from '../../modules/sync/repository/quickBooksCustomer.repository'
import { invoiceRepository } from '../../modules/sync/repository/invoice.repository'
import { productRepository } from '../../modules/sync/repository/product.repository'
import { plMonthlySnapshotRepository } from '../../modules/sync/repository/plMonthlySnapshot.repository'
import { balanceSheetMonthlySnapshotRepository } from '../../modules/sync/repository/balanceSheetMonthlySnapshot.repository'
import { parseProfitAndLoss } from '../../modules/metrics/service/plParser'
import { extractSectionTotals, extractLeafAccountsByColumn } from '../../modules/metrics/service/reportParser'
import type { QuickBooksReport } from '../../modules/integrations/service/quickbooks.service'

export const PARITY_ORG_ID = '6b1a00000000000000000001'
export const PARITY_DB = 'tenant_oryon_parity'
const PROVIDER = 'quickbooks'
const MON: Record<string, string> = {
  Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06', Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12'
}

const datasetDir = path.resolve(process.argv[2] ?? path.join(process.cwd(), '..', '..', 'ridgeline_dataset', 'quickbooks'))
const sourceTenant = process.argv[3] ?? 'tenant_6afb4cfa4d073173337ae192'

const readJson = <T>(p: string): T => JSON.parse(fs.readFileSync(p, 'utf8')) as T
const entity = <T>(name: string): T[] =>
  (readJson<{ QueryResponse: Record<string, T[]> }>(path.join(datasetDir, 'entities', `${name}.json`)).QueryResponse[name] ?? [])

/** "Jan 2023" -> "2023-01" */
function columnMonth(title: string): string | null {
  const m = /^([A-Z][a-z]{2}) (\d{4})$/.exec(title.trim())
  return m ? `${m[2]}-${MON[m[1]]}` : null
}

function monthRange(month: string) {
  const [y, m] = month.split('-').map(Number)
  const end = new Date(Date.UTC(y, m, 0))
  return { startDate: `${month}-01`, endDate: `${month}-${String(end.getUTCDate()).padStart(2, '0')}` }
}

async function main() {
  await connectDatabase()
  const orgObjectId = new Types.ObjectId(PARITY_ORG_ID)

  // fresh tenant every run
  const tenant = await getTenantConnectionByDbName(PARITY_DB)
  await tenant.dropDatabase()
  await OrganizationModel.deleteOne({ _id: orgObjectId })
  await OrganizationModel.create({ _id: orgObjectId, name: 'Oryon Parity Test', slug: 'oryon-parity-test', dbName: PARITY_DB })

  // ---- QuickBooks customers / invoices / items (same mapping as sync.service.ts)
  type QbCustomer = { Id: string; DisplayName: string; ParentRef?: { value: string }; Active?: boolean }
  const customers = entity<QbCustomer>('Customer').map((c) => ({
    providerRecordId: c.Id, displayName: c.DisplayName, parentRecordId: c.ParentRef?.value, active: c.Active ?? true
  }))
  await quickBooksCustomerRepository.bulkUpsert(PARITY_ORG_ID, PROVIDER, customers)

  type QbAddr = { Line1?: string; Line2?: string; City?: string; CountrySubDivisionCode?: string; PostalCode?: string; Country?: string }
  type QbInvoice = {
    Id: string; CustomerRef: { value: string }; TxnDate: string; TotalAmt: number; BillAddr?: QbAddr
    Line?: Array<{ Amount?: number; SalesItemLineDetail?: { ItemRef?: { value: string }; ClassRef?: { value: string; name: string } } }>
  }
  const toAddr = (a?: QbAddr) => {
    if (!a) return undefined
    const { Line1, Line2, City, CountrySubDivisionCode, PostalCode, Country } = a
    if (!Line1 && !Line2 && !City && !CountrySubDivisionCode && !PostalCode && !Country) return undefined
    return { line1: Line1, line2: Line2, city: City, state: CountrySubDivisionCode, postalCode: PostalCode, country: Country }
  }
  const invoices = entity<QbInvoice>('Invoice').map((inv) => ({
    providerRecordId: inv.Id,
    customerRecordId: inv.CustomerRef.value,
    txnDate: new Date(inv.TxnDate),
    totalAmount: inv.TotalAmt,
    lines: (inv.Line ?? [])
      .filter((l) => l.SalesItemLineDetail?.ItemRef?.value)
      .map((l) => ({
        itemId: l.SalesItemLineDetail!.ItemRef!.value,
        amount: l.Amount ?? 0,
        classId: l.SalesItemLineDetail?.ClassRef?.value,
        className: l.SalesItemLineDetail?.ClassRef?.name
      })),
    billingAddress: toAddr(inv.BillAddr)
  }))
  for (let i = 0; i < invoices.length; i += 1000) {
    await invoiceRepository.bulkUpsert(PARITY_ORG_ID, PROVIDER, invoices.slice(i, i + 1000))
  }

  const SELLABLE = new Set(['Service', 'Inventory', 'NonInventory', 'Bundle', 'Group'])
  const items = entity<{ Id: string; Name?: string; Type?: string }>('Item')
    .filter((it) => it.Type && SELLABLE.has(it.Type))
    .map((it) => ({ providerRecordId: it.Id, name: it.Name || it.Id }))
  await productRepository.bulkUpsert(PARITY_ORG_ID, PROVIDER, items)

  // ---- monthly P&L and Balance Sheet snapshots (same slicing as the monthly syncs)
  const reportsDir = path.join(datasetDir, 'reports')
  const fetchedAt = new Date()
  const plSnaps = []
  const bsSnaps = []
  for (const f of fs.readdirSync(reportsDir).sort()) {
    if (/^ProfitAndLoss_Monthly_FY\d{4}\.json$/.test(f)) {
      const parsed = parseProfitAndLoss(readJson<QuickBooksReport>(path.join(reportsDir, f)))
      for (const column of parsed.columns.filter((c) => c !== 'Total')) {
        const month = columnMonth(column)
        if (!month) continue
        const slice = (rows: typeof parsed.income) => rows.map((r) => ({ account: r.account, accountId: r.accountId, amounts: { Total: r.amounts[column] ?? 0 } }))
        const sectionTotals: Record<string, Record<string, number>> = {}
        for (const [section, totals] of Object.entries(parsed.sectionTotals)) sectionTotals[section] = { Total: totals[column] ?? 0 }
        const { startDate, endDate } = monthRange(month)
        plSnaps.push({
          month, startDate, endDate, columns: ['Total'], income: slice(parsed.income), cogs: slice(parsed.cogs),
          expenses: slice(parsed.expenses), otherExpenses: slice(parsed.otherExpenses), sectionTotals, fetchedAt
        })
      }
    }
    if (/^BalanceSheet_Monthly_FY\d{4}\.json$/.test(f)) {
      const report = readJson<QuickBooksReport>(path.join(reportsDir, f))
      const columns = report.Columns.Column.slice(1).map((c) => c.ColTitle || 'Total').filter((c) => c !== 'Total')
      const sectionTotals = extractSectionTotals(report)
      const leaf = extractLeafAccountsByColumn(report)
      for (const column of columns) {
        const month = columnMonth(column)
        if (!month) continue
        const st: Record<string, Record<string, number>> = {}
        for (const [section, totals] of Object.entries(sectionTotals)) st[section] = { Total: totals[column] ?? 0 }
        const accounts = leaf.map((a) => ({ id: a.id, name: a.name, section: a.section, amount: a.amounts[column] ?? 0 }))
        bsSnaps.push({ month, asOfDate: monthRange(month).endDate, sectionTotals: st, accounts, fetchedAt })
      }
    }
  }
  await plMonthlySnapshotRepository.upsertMany(PARITY_ORG_ID, PROVIDER, plSnaps)
  await balanceSheetMonthlySnapshotRepository.upsertMany(PARITY_ORG_ID, PROVIDER, bsSnaps)

  // ---- CRM collections copied from an existing tenant
  const src = await getTenantConnectionByDbName(sourceTenant)
  const counts: Record<string, number> = {}
  for (const name of ['deals', 'contacts', 'salesforceaccounts', 'pipelinestagedefinitions', 'salesforcecampaigns']) {
    const docs = await src.db!.collection(name).find({}).toArray()
    const out = docs.map((d) => ({ ...d, _id: new Types.ObjectId(), orgId: orgObjectId }))
    for (let i = 0; i < out.length; i += 2000) await tenant.db!.collection(name).insertMany(out.slice(i, i + 2000))
    counts[name] = out.length
  }
  // the dashboard picks its CRM provider and cache version from the integrations list
  const now = new Date()
  await tenant.db!.collection('integrations').insertMany(
    ['quickbooks', 'salesforce', 'hubspot'].map((provider) => ({ orgId: orgObjectId, provider, status: 'connected', lastSyncedAt: now, createdAt: now, updatedAt: now }))
  )

  console.log(JSON.stringify({
    org: PARITY_ORG_ID, db: PARITY_DB, customers: customers.length, invoices: invoices.length, items: items.length,
    plMonths: plSnaps.length, bsMonths: bsSnaps.length, ...counts
  }))
  await closeAllTenantConnections()
  await mongoose.disconnect()
}

main().catch(async (err) => {
  console.error(err)
  await closeAllTenantConnections()
  await mongoose.disconnect()
  process.exit(1)
})
