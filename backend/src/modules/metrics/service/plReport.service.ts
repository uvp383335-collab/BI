import { getValidAccessToken } from '../../integrations/service/integrations.service'
import { integrationsRepository } from '../../integrations/repository/integrations.repository'
import { QuickBooksService } from '../../integrations/service/quickbooks.service'
import { plSnapshotRepository } from '../../sync/repository/plSnapshot.repository'
import { AppError } from '../../../shared/utils/AppError'
import { parseProfitAndLoss, ParsedProfitAndLoss } from './plParser'

async function getQuickBooksAuth(orgId: string): Promise<{ accessToken: string; realmId: string }> {
  const accessToken = await getValidAccessToken(orgId, 'quickbooks')
  const integration = await integrationsRepository.findByOrgAndProvider(orgId, 'quickbooks')
  if (!integration?.accountId) {
    throw AppError.badRequest('Missing QuickBooks company id for this connection', 'QUICKBOOKS_REALM_ID_MISSING')
  }
  return { accessToken, realmId: integration.accountId }
}

/**
 * Fetches and parses the Profit & Loss report for a date range, live from
 * QuickBooks. Used by the sync job (`syncQuickBooksProfitAndLoss`) to
 * refresh `PLSnapshot` — metric computation itself reads the stored
 * snapshot via `getStoredProfitAndLoss` below, not this function directly,
 * so a dashboard view never blocks on a live QuickBooks round-trip.
 */
export async function getParsedProfitAndLoss(
  orgId: string,
  startDate: string,
  endDate: string,
  summarizeColumnBy: 'Total' | 'Class' = 'Total'
): Promise<ParsedProfitAndLoss> {
  const { accessToken, realmId } = await getQuickBooksAuth(orgId)
  const report = await QuickBooksService.getProfitAndLossReport(accessToken, realmId, startDate, endDate, summarizeColumnBy)
  return parseProfitAndLoss(report)
}

/**
 * `PLSnapshot`'s P&L fields, plus the Phase 3 Balance-Sheet/Cash-Flow fields
 * (all optional — `undefined` when that report wasn't available for this
 * quarter, never a silent 0). CB-05/07/10 read the extra fields; VC-04
 * onward only ever destructure the `ParsedProfitAndLoss` fields, unaffected
 * by the wider shape.
 */
export interface StoredQuarterSnapshot extends ParsedProfitAndLoss {
  startDate: string
  endDate: string
  accountsReceivable?: number
  accountsPayable?: number
  inventoryValue?: number
  operatingCashFlow?: number
  capEx?: number
  netFixedAssets?: number
}

/**
 * Reads one quarter's financial snapshot back out of `PLSnapshot`
 * (populated by the sync job, not fetched live here) — `null` if that
 * quarter hasn't been synced yet (org just connected QuickBooks and hasn't
 * run a sync, or the quarter is outside the synced window). Every metric in
 * plMetrics.service.ts goes through this instead of calling QuickBooks
 * directly.
 */
export async function getStoredProfitAndLoss(orgId: string, provider: string, quarterStart: string): Promise<StoredQuarterSnapshot | null> {
  const snapshot = await plSnapshotRepository.findByQuarter(orgId, provider, quarterStart)
  if (!snapshot) return null
  return {
    columns: snapshot.columns,
    income: snapshot.income,
    cogs: snapshot.cogs,
    expenses: snapshot.expenses,
    otherExpenses: snapshot.otherExpenses,
    sectionTotals: snapshot.sectionTotals as Record<string, Record<string, number>>,
    startDate: snapshot.startDate,
    endDate: snapshot.endDate,
    accountsReceivable: snapshot.accountsReceivable,
    accountsPayable: snapshot.accountsPayable,
    inventoryValue: snapshot.inventoryValue,
    operatingCashFlow: snapshot.operatingCashFlow,
    capEx: snapshot.capEx,
    netFixedAssets: snapshot.netFixedAssets
  }
}
