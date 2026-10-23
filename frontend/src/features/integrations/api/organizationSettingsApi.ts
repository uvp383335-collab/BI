import { httpClient } from '../../../shared/api/httpClient'

interface ApiEnvelope<T> {
  success: boolean
  data: T
}

export type SalesforceCompetitorSource = 'field' | 'junction'

export interface SalesforceOpportunityExtraField {
  apiName: string
  label: string
}

export interface OrganizationSettings {
  salesforceCompetitorSource?: SalesforceCompetitorSource
  /** Only meaningful when salesforceCompetitorSource is 'field'. */
  salesforceCompetitorField?: string
  /** Org-configured custom Opportunity fields shown in the Opportunity detail view (Order Number, Current Generator(s), etc). */
  salesforceOpportunityExtraFields?: SalesforceOpportunityExtraField[]
  /** CB-07's manually-picked capital-expenditure accounts — never inferred automatically. */
  cb07ExpenditureAccountIds?: string[]
  /** CB-10's manually-picked A/R, A/P, and Inventory accounts. */
  cb10AccountsReceivableAccountId?: string
  cb10AccountsPayableAccountId?: string
  cb10InventoryAccountId?: string
  /** G&A % of Revenue's manually-picked G&A expense accounts — never inferred from account names. */
  gaExpenseAccountIds?: string[]
  /** Customer Acquisition Cost's manually-picked acquisition-spend accounts, plus the non-overlapping window size (in months) CAC is computed over. */
  cacExpenseAccountIds?: string[]
  cacDurationMonths?: number
  /** CM-07 Marketing ROI's manually-picked marketing-spend accounts — never inferred from account names. */
  marketingSpendAccountIds?: string[]
  /** On: HubSpot sync reads the `rl_*` imported history (CSV-loaded portals). Off/unset: HubSpot's native history. */
  hubspotUseImportedHistory?: boolean
  /** CM-04's new-business targets — each a total for an inclusive month range, spread evenly across its months. */
  cm04Targets?: Cm04Target[]
  /** CM-08's MQL plan — each a total MQL count for an inclusive month range, spread evenly across its months. */
  cm08MqlTargets?: Cm08MqlTarget[]
}

export interface Cm04Target {
  /** `YYYY-MM` */
  fromMonth: string
  /** `YYYY-MM`, inclusive */
  toMonth: string
  targetAmount: number
}

export interface Cm08MqlTarget {
  /** `YYYY-MM` */
  fromMonth: string
  /** `YYYY-MM`, inclusive */
  toMonth: string
  targetCount: number
}

export async function updateCm08MqlTargetsRequest(targets: Cm08MqlTarget[]): Promise<OrganizationSettings> {
  const res = await httpClient.patch<ApiEnvelope<OrganizationSettings>>('/organizations/settings/cm08-mql-targets', { targets })
  return res.data.data
}

export async function updateCm04TargetsRequest(targets: Cm04Target[]): Promise<OrganizationSettings> {
  const res = await httpClient.patch<ApiEnvelope<OrganizationSettings>>('/organizations/settings/cm04-targets', { targets })
  return res.data.data
}

/** One QuickBooks chart-of-accounts leaf row, as it appears on the Cash Flow or Balance Sheet report. */
export interface QuickBooksAccountOption {
  id: string
  name: string
  section: string | null
  amount: number
}

export interface CashMetricsAccountSettings {
  cb07ExpenditureAccountIds: string[]
  cb10AccountsReceivableAccountId: string | null
  cb10AccountsPayableAccountId: string | null
  cb10InventoryAccountId: string | null
}

export async function getCashMetricsAccountOptionsRequest(): Promise<QuickBooksAccountOption[]> {
  const res = await httpClient.get<ApiEnvelope<{ accounts: QuickBooksAccountOption[] }>>('/organizations/settings/quickbooks-accounts')
  return res.data.data.accounts
}

export async function updateCashMetricsAccountsRequest(settings: CashMetricsAccountSettings): Promise<OrganizationSettings> {
  const res = await httpClient.patch<ApiEnvelope<OrganizationSettings>>('/organizations/settings/cash-metrics-accounts', settings)
  return res.data.data
}

/** One QuickBooks P&L Expense/Other-Expense leaf account, as it appears on the G&A account picker. */
export interface GAndAAccountOption {
  id: string
  name: string
  section: string | null
  amount: number
}

export async function getGAndAAccountOptionsRequest(): Promise<GAndAAccountOption[]> {
  const res = await httpClient.get<ApiEnvelope<{ accounts: GAndAAccountOption[] }>>('/organizations/settings/ga-accounts')
  return res.data.data.accounts
}

export async function updateGAndAAccountsRequest(gaExpenseAccountIds: string[]): Promise<OrganizationSettings> {
  const res = await httpClient.patch<ApiEnvelope<OrganizationSettings>>('/organizations/settings/ga-accounts', { gaExpenseAccountIds })
  return res.data.data
}

/** Options come from the same G&A listing (`getGAndAAccountOptionsRequest`) — identical P&L expense-account universe. */
export async function updateMarketingSpendAccountsRequest(marketingSpendAccountIds: string[]): Promise<OrganizationSettings> {
  const res = await httpClient.patch<ApiEnvelope<OrganizationSettings>>('/organizations/settings/marketing-accounts', { marketingSpendAccountIds })
  return res.data.data
}

export interface CACSettingsInput {
  cacExpenseAccountIds: string[]
  cacDurationMonths: number
}

/** Same account universe as the G&A picker (P&L Expense/Other-Expense leaf accounts) — reuses `GAndAAccountOption`. */
export async function getCACAccountOptionsRequest(): Promise<GAndAAccountOption[]> {
  const res = await httpClient.get<ApiEnvelope<{ accounts: GAndAAccountOption[] }>>('/organizations/settings/cac-accounts')
  return res.data.data.accounts
}

export async function updateCACSettingsRequest(settings: CACSettingsInput): Promise<OrganizationSettings> {
  const res = await httpClient.patch<ApiEnvelope<OrganizationSettings>>('/organizations/settings/cac-accounts', settings)
  return res.data.data
}

export async function updateHubSpotHistorySourceRequest(hubspotUseImportedHistory: boolean): Promise<OrganizationSettings> {
  const res = await httpClient.patch<ApiEnvelope<OrganizationSettings>>('/organizations/settings/hubspot-history-source', {
    hubspotUseImportedHistory
  })
  return res.data.data
}

export async function getOrganizationSettingsRequest(): Promise<OrganizationSettings> {
  const res = await httpClient.get<ApiEnvelope<OrganizationSettings>>('/organizations/settings')
  return res.data.data
}

/** Pass `source: null` to clear competitor tracking entirely (un-configured). */
export async function updateOrganizationSettingsRequest(
  source: SalesforceCompetitorSource | null,
  field: string | null
): Promise<OrganizationSettings> {
  const res = await httpClient.patch<ApiEnvelope<OrganizationSettings>>('/organizations/settings', {
    salesforceCompetitorSource: source,
    salesforceCompetitorField: field
  })
  return res.data.data
}

export async function updateSalesforceOpportunityExtraFieldsRequest(
  fields: SalesforceOpportunityExtraField[]
): Promise<OrganizationSettings> {
  const res = await httpClient.patch<ApiEnvelope<OrganizationSettings>>('/organizations/settings/salesforce-opportunity-fields', { fields })
  return res.data.data
}
