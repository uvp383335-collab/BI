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
}

export interface PipelineTransition {
  fromStage: string
  toStage: string
  count: number
}

export interface PipelineFilters {
  startDate?: string
  endDate?: string
  pipeline?: string
  hubspotOwnerId?: string
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

export async function getPipelineProgressionRequest(
  provider: IntegrationProvider,
  filters: PipelineFilters
): Promise<PipelineTransition[]> {
  const res = await httpClient.get<ApiEnvelope<PipelineTransition[]>>(`/analytics/${provider}/pipeline-progression`, {
    params: filters
  })
  return res.data.data
}

export async function getPipelinesRequest(provider: IntegrationProvider): Promise<string[]> {
  const res = await httpClient.get<ApiEnvelope<string[]>>(`/analytics/${provider}/pipelines`)
  return res.data.data
}
