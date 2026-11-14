import React from 'react'
import { SyncJob } from '../api/syncApi'

interface SyncProgressBannerProps {
  job: SyncJob
}

const STEP_LABELS: Record<'contacts' | 'deals', string> = {
  contacts: 'Contacts',
  deals: 'Deals'
}

export const SyncProgressBanner: React.FC<SyncProgressBannerProps> = ({ job }) => {
  const isRunning = job.status === 'pending' || job.status === 'running'
  const isFailed = job.status === 'failed'

  return (
    <div className={`card p-6 ${isFailed ? 'border-danger/30 bg-danger/5' : 'border-brand/30 bg-brand/5'}`}>
      <div className="flex items-center justify-between">
        <div>
          <p className={`text-sm font-semibold ${isFailed ? 'text-danger' : 'text-brand'}`}>
            {isFailed ? 'Sync failed' : isRunning ? 'Syncing your data…' : 'Sync complete'}
          </p>
          <p className="mt-1 text-sm text-ink-2">{job.currentStep}</p>
        </div>
        {isRunning && <span className="text-sm font-medium text-brand">{job.progress}%</span>}
      </div>

      {!isFailed && (
        <div className="mt-4 h-2 w-full overflow-hidden rounded-full bg-surface-3">
          <div
            className="h-full rounded-full bg-brand transition-all duration-500"
            style={{ width: `${job.progress}%` }}
          />
        </div>
      )}

      {isFailed && job.error && <p className="mt-2 text-xs text-danger">{job.error}</p>}

      <div className="mt-4 grid grid-cols-2 gap-4 text-sm">
        {(['contacts', 'deals'] as const).map((entity) => {
          const entityProgress = job.entities[entity]
          return (
            <div key={entity} className="flex items-center justify-between rounded-lg bg-surface-3 px-3 py-2">
              <span className="text-ink-2">{STEP_LABELS[entity]}</span>
              <span className="font-medium text-ink">
                {entityProgress.synced}
                {entityProgress.status === 'completed' ? '' : '…'}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
