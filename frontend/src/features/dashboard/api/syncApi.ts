import { httpClient } from '../../../shared/api/httpClient'
import { IntegrationProvider } from '../../integrations/api/integrationsApi'

interface ApiEnvelope<T> {
  success: boolean
  data: T
}

export type EntitySyncStatus = 'pending' | 'syncing' | 'completed' | 'failed'

export interface EntityProgress {
  status: EntitySyncStatus
  total: number
  synced: number
}

export interface SyncJob {
  _id: string
  orgId: string
  provider: IntegrationProvider
  status: 'pending' | 'running' | 'completed' | 'failed'
  progress: number
  currentStep: string
  entities: {
    contacts: EntityProgress
    deals: EntityProgress
    customers: EntityProgress
    invoices: EntityProgress
  }
  error?: string
  startedAt?: string
  completedAt?: string
  createdAt: string
  updatedAt: string
}

export interface EntityCounts {
  contacts: number
  deals: number
  customers: number
  invoices: number
}

export interface FunnelStage {
  rawStage: string
  label: string
  /** Rank-based cumulative count: reached this stage or any later one. Drives the bar. */
  count: number
  /** Records with an explicit recorded event for this exact stage — no rank inference. */
  literalCount: number
  isClosed: boolean
  isWon: boolean
}

export interface FunnelChartData {
  pipeline: string
  totalEntered: number
  stages: FunnelStage[]
}

export interface FunnelsResponse {
  leadStage: FunnelChartData
  dealStage: FunnelChartData
  leadToDeal: FunnelChartData
}

export interface FunnelFilters {
  pipeline?: string
  /** ISO date strings (YYYY-MM-DD), inclusive. */
  from?: string
  to?: string
  productId?: string
}

export interface Product {
  id: string
  name: string
}

export interface Opportunity {
  _id: string
  dealname?: string
  amount?: number
  closedate?: string
  pipeline?: string
  dealstage?: string
  type?: string
  leadSource?: string
  campaignId?: string
  campaignName?: string
  accountId?: string
  accountName?: string
  ownerId?: string
  ownerName?: string
  dealCreatedAt?: string
  competitor?: string
  competitors?: string[]
  isPrivate?: boolean
  expectedRevenue?: number
  nextStep?: string
  probability?: number
  description?: string
  createdByName?: string
  lastModifiedByName?: string
  lastModifiedAt?: string
  /** Org-configured custom fields (Settings → Opportunity detail fields) — e.g. Order Number, Current Generator(s). */
  customFields?: { label: string; value: string | number | boolean | null }[]
}

export interface Campaign {
  _id: string
  providerRecordId: string
  name?: string
  type?: string
  status?: string
  startDate?: string
  endDate?: string
  active?: boolean
  ownerName?: string
  expectedRevenue?: number
  budgetedCost?: number
  actualCost?: number
  expectedResponsePct?: number
  numberSent?: number
  parentCampaignName?: string
  description?: string
  createdByName?: string
  lastModifiedByName?: string
  lastModifiedAt?: string
  numberOfLeads?: number
  numberOfConvertedLeads?: number
  numberOfContacts?: number
  numberOfResponses?: number
  numberOfOpportunities?: number
  numberOfWonOpportunities?: number
  amountAllOpportunities?: number
  amountWonOpportunities?: number
}

export interface PaginatedResult<T> {
  items: T[]
  total: number
  page: number
  pageSize: number
}

/** `force: true` ignores `lastSyncedAt` and re-fetches everything unconditionally — needed once to backfill a newly-synced field (e.g. invoice line items) onto records that haven't changed on the CRM side since. */
export async function startSyncRequest(provider: IntegrationProvider, force?: boolean): Promise<{ jobId: string }> {
  const res = await httpClient.post<ApiEnvelope<{ jobId: string }>>(`/sync/${provider}/start`, undefined, { params: { force } })
  return res.data.data
}

export async function getSyncStatusRequest(provider: IntegrationProvider): Promise<SyncJob | null> {
  const res = await httpClient.get<ApiEnvelope<SyncJob | null>>(`/sync/${provider}/status`)
  return res.data.data
}

export async function getEntityCountsRequest(provider: IntegrationProvider): Promise<EntityCounts> {
  const res = await httpClient.get<ApiEnvelope<EntityCounts>>(`/sync/${provider}/counts`)
  return res.data.data
}

export async function getFunnelsRequest(
  provider: IntegrationProvider,
  filters: FunnelFilters
): Promise<FunnelsResponse> {
  const res = await httpClient.get<ApiEnvelope<FunnelsResponse>>(`/analytics/${provider}/funnels`, {
    params: filters
  })
  return res.data.data
}

export async function getPipelinesRequest(provider: IntegrationProvider): Promise<string[]> {
  const res = await httpClient.get<ApiEnvelope<string[]>>(`/analytics/${provider}/pipelines`)
  return res.data.data
}

export async function getProductsRequest(provider: IntegrationProvider): Promise<Product[]> {
  const res = await httpClient.get<ApiEnvelope<Product[]>>(`/analytics/${provider}/products`)
  return res.data.data
}

export async function getOpportunitiesRequest(
  provider: IntegrationProvider,
  page: number,
  pageSize: number
): Promise<PaginatedResult<Opportunity>> {
  const res = await httpClient.get<ApiEnvelope<PaginatedResult<Opportunity>>>(`/analytics/${provider}/opportunities`, {
    params: { page, pageSize }
  })
  return res.data.data
}

export async function getCampaignsRequest(
  provider: IntegrationProvider,
  page: number,
  pageSize: number
): Promise<PaginatedResult<Campaign>> {
  const res = await httpClient.get<ApiEnvelope<PaginatedResult<Campaign>>>(`/analytics/${provider}/campaigns`, {
    params: { page, pageSize }
  })
  return res.data.data
}
