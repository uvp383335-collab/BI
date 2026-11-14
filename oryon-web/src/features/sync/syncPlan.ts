import type { SyncJob, EntitySyncStatus } from '../dashboard/api/syncApi'
import type { IntegrationProvider } from '../integrations/api/integrationsApi'

/**
 * What the first-sync loader shows, derived from the sync jobs. Kept free of React so the
 * phase rules can be tested on their own.
 */

export const PROVIDER_NAMES: Record<IntegrationProvider, string> = {
  hubspot: 'HubSpot',
  salesforce: 'Salesforce',
  quickbooks: 'QuickBooks'
}

/** The records each source copies, in the order the sync runs them, named as the user knows them. */
const ENTITIES: Record<IntegrationProvider, Array<[key: string, label: string]>> = {
  hubspot: [
    ['contacts', 'Contacts'],
    ['deals', 'Deals']
  ],
  salesforce: [
    ['accounts', 'Accounts'],
    ['contacts', 'Leads'],
    ['deals', 'Opportunities']
  ],
  quickbooks: [
    ['customers', 'Customers'],
    ['invoices', 'Invoices'],
    ['items', 'Products & services'],
    ['plItemSnapshots', 'Profit & loss by product'],
    ['plSnapshots', 'Profit & loss'],
    ['cashBalance', 'Cash balance']
  ]
}

export type SourceState = 'waiting' | 'syncing' | 'done' | 'failed'
export type Phase = 'syncing' | 'preparing' | 'ready' | 'failed'

export interface EntityRow {
  key: string
  label: string
  status: EntitySyncStatus
  synced: number
  total: number
}

export interface SourceRow {
  provider: IntegrationProvider
  name: string
  state: SourceState
  progress: number
  step: string | null
  error: string | null
  entities: EntityRow[]
}

const ACTIVE = ['pending', 'running']

/**
 * State of one source's first sync. `since` is when the user came back from connecting it:
 * a job that finished before then belongs to an earlier connection and doesn't count.
 * A source with no job yet is 'waiting' (the backend starts the sync just after the redirect).
 */
export function sourceRow(provider: IntegrationProvider, job: SyncJob | null | undefined, since: number): SourceRow {
  const ts = (d?: string) => (d ? new Date(d).getTime() : 0)
  const fresh = !!job && Math.max(ts(job.updatedAt), ts(job.completedAt), ts(job.createdAt)) >= since
  let state: SourceState = 'waiting'
  if (job && ACTIVE.includes(job.status)) state = 'syncing'
  else if (job && fresh && job.status === 'completed') state = 'done'
  else if (job && fresh && job.status === 'failed') state = 'failed'

  const entities = (job?.entities ?? {}) as unknown as Record<string, { status: EntitySyncStatus; synced: number; total: number } | undefined>
  const rows = ENTITIES[provider]
    .map(([key, label]) => ({ key, label, status: entities[key]?.status ?? 'pending', synced: entities[key]?.synced ?? 0, total: entities[key]?.total ?? 0 }))
    // once a source is finished, records it never touched (pending) aren't part of its sync
    .filter((r) => state !== 'done' || r.status !== 'pending')

  return {
    provider,
    name: PROVIDER_NAMES[provider],
    state,
    // a failed sync keeps the progress it reached, so the screen shows how far it got
    progress: state === 'done' ? 100 : state === 'syncing' || state === 'failed' ? Math.min(99, Math.max(2, job?.progress ?? 0)) : 0,
    step: state === 'syncing' ? job?.currentStep ?? null : null,
    error: state === 'failed' ? job?.error ?? null : null,
    entities: rows
  }
}

/** Overall phase across sources. Waiting sources only hold the loader for `waitLimitMs`, so a sync that never starts can't trap the user. */
export function phaseOf(rows: SourceRow[], waitedMs: number, waitLimitMs = 30_000): Phase {
  if (rows.some((r) => r.state === 'failed')) return 'failed'
  if (rows.some((r) => r.state === 'syncing')) return 'syncing'
  if (rows.some((r) => r.state === 'waiting') && waitedMs < waitLimitMs) return 'syncing'
  return 'preparing'
}

/** Single 0–100 figure for the progress line: copying data is the first 85%, building the dashboard the rest. */
export function overallProgress(rows: SourceRow[], phase: Phase, preparingPct = 0): number {
  if (phase === 'ready') return 100
  if (phase === 'preparing') return 85 + Math.min(14, preparingPct)
  if (!rows.length) return 0
  return Math.round((rows.reduce((t, r) => t + r.progress, 0) / rows.length) * 0.85)
}

export function formatElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}
