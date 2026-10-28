import { SyncJobModel, SyncJobDocument } from '../model/SyncJob.model'
import { Types } from 'mongoose'

export type EntityKey =
  | 'contacts'
  | 'deals'
  | 'customers'
  | 'invoices'
  | 'plSnapshots'
  | 'cashBalance'
  | 'accounts'
  | 'items'
  | 'plItemSnapshots'
  | 'plMonthlySnapshots'

// Sync jobs run fire-and-forget in-process (executeSyncJob isn't backed by a
// durable queue/worker yet) — a dev-server restart or an unhandled crash
// mid-sync leaves nothing left to ever update the job document again, so it
// sits at status 'running'/'pending' forever. Every step updates progress at
// least once per page (PAGE_SIZE records), so a real in-flight sync's
// `updatedAt` should never go this long without moving; past this threshold
// the job is treated as orphaned rather than active.
const STALE_JOB_THRESHOLD_MS = 5 * 60 * 1000

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

  /**
   * Returns the in-progress job for this org/provider, if any. An active job
   * whose `updatedAt` is older than STALE_JOB_THRESHOLD_MS is first reaped —
   * marked 'failed' with an explanatory error — and treated as if there were
   * none, so an orphaned job (see constant doc comment above) doesn't block
   * every future sync for the org/provider indefinitely.
   */
  async findActiveByOrgAndProvider(orgId: string | Types.ObjectId, provider: string) {
    const active = await SyncJobModel.findOne({ orgId, provider, status: { $in: ['pending', 'running'] } })
    if (!active) return null

    const sinceLastUpdate = Date.now() - active.updatedAt.getTime()
    if (sinceLastUpdate < STALE_JOB_THRESHOLD_MS) return active

    await SyncJobModel.findByIdAndUpdate(active._id, {
      status: 'failed',
      completedAt: new Date(),
      error: 'Sync did not report progress in time and was presumed interrupted (e.g. a server restart)'
    })
    return null
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
