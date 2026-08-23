import { SyncJobModel, SyncJobDocument } from '../model/SyncJob.model'
import { Types } from 'mongoose'

export type EntityKey = 'contacts' | 'deals' | 'customers' | 'invoices' | 'plSnapshots' | 'cashBalance' | 'accounts'

export const syncJobRepository = {
  create(orgId: string | Types.ObjectId, provider: string) {
    return SyncJobModel.create({ orgId, provider, status: 'pending', progress: 0, currentStep: 'Queued' })
  },

  findById(jobId: string) {
    return SyncJobModel.findById(jobId)
  },

  findByIdForOrg(jobId: string, orgId: string | Types.ObjectId) {
    return SyncJobModel.findOne({ _id: jobId, orgId })
  },

  findLatestByOrgAndProvider(orgId: string | Types.ObjectId, provider: string) {
    return SyncJobModel.findOne({ orgId, provider }).sort({ createdAt: -1 })
  },

  findActiveByOrgAndProvider(orgId: string | Types.ObjectId, provider: string) {
    return SyncJobModel.findOne({ orgId, provider, status: { $in: ['pending', 'running'] } })
  },

  updateStatus(jobId: string, status: SyncJobDocument['status']) {
    const patch: Record<string, unknown> = { status }
    if (status === 'running') patch.startedAt = new Date()
    if (status === 'completed' || status === 'failed') patch.completedAt = new Date()
    return SyncJobModel.findByIdAndUpdate(jobId, patch, { new: true })
  },

  updateProgress(jobId: string, progress: number, currentStep: string) {
    return SyncJobModel.findByIdAndUpdate(jobId, { progress, currentStep }, { new: true })
  },

  updateEntityProgress(jobId: string, entity: EntityKey, patch: Partial<{ status: string; total: number; synced: number }>) {
    const set: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(patch)) {
      set[`entities.${entity}.${key}`] = value
    }
    return SyncJobModel.findByIdAndUpdate(jobId, { $set: set }, { new: true })
  },

  setError(jobId: string, error: string) {
    return SyncJobModel.findByIdAndUpdate(jobId, { error }, { new: true })
  }
}
