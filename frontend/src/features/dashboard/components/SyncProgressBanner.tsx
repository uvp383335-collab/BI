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
    <div
      className={`rounded-2xl border p-6 shadow-sm ${
        isFailed ? 'border-red-200 bg-red-50' : 'border-blue-200 bg-blue-50'
      }`}
    >
      <div className="flex items-center justify-between">
        <div>
          <p className={`text-sm font-semibold ${isFailed ? 'text-red-700' : 'text-blue-700'}`}>
            {isFailed ? 'Sync failed' : isRunning ? 'Syncing your data…' : 'Sync complete'}
          </p>
          <p className="mt-1 text-sm text-gray-600">{job.currentStep}</p>
        </div>
        {isRunning && <span className="text-sm font-medium text-blue-700">{job.progress}%</span>}
      </div>

      {!isFailed && (
        <div className="mt-4 h-2 w-full overflow-hidden rounded-full bg-white">
          <div
            className="h-full rounded-full bg-blue-600 transition-all duration-500"
            style={{ width: `${job.progress}%` }}
          />
        </div>
      )}

      {isFailed && job.error && <p className="mt-2 text-xs text-red-600">{job.error}</p>}

      <div className="mt-4 grid grid-cols-2 gap-4 text-sm">
        {(['contacts', 'deals'] as const).map((entity) => {
          const entityProgress = job.entities[entity]
          return (
            <div key={entity} className="flex items-center justify-between rounded-lg bg-white px-3 py-2">
              <span className="text-gray-600">{STEP_LABELS[entity]}</span>
              <span className="font-medium text-gray-900">
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
