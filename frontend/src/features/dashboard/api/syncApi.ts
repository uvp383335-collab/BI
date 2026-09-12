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

export async function startSyncRequest(provider: IntegrationProvider): Promise<{ jobId: string }> {
  const res = await httpClient.post<ApiEnvelope<{ jobId: string }>>(`/sync/${provider}/start`)
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
