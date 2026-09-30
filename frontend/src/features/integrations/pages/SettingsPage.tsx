import React, { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { RefreshCw, ArrowUpRight } from 'lucide-react'
import { useAuthContext } from '../../../shared/context/AuthContext'
import { useIntegrationsStatus } from '../hooks/useIntegrations'
import { useStartSync, useSyncStatus } from '../../dashboard/hooks/useSync'
import { IntegrationProvider, ProviderStatus } from '../api/integrationsApi'
import { AppShell } from '../../../widgets/AppShell'
import { Banner } from '../../../shared/components/Banner'
import { formatDateTime } from '../../../shared/utils/formatDate'

const PROVIDERS: IntegrationProvider[] = ['hubspot', 'salesforce', 'quickbooks']
const PROVIDER_LABELS: Record<IntegrationProvider, string> = {
  hubspot: 'HubSpot',
  salesforce: 'Salesforce',
  quickbooks: 'QuickBooks'
}

interface ProviderRowProps {
  provider: IntegrationProvider
  status?: ProviderStatus
  canManage: boolean
  onError: (message: string) => void
}

/**
 * One row per provider — every provider the app knows about, not just
 * connected ones, so this reads as a full inventory ("what can we connect,
 * what's already connected") the way Slack/Zapier/Notion's integration
 * management screens do, rather than only surfacing active connections.
 */
const ProviderRow: React.FC<ProviderRowProps> = ({ provider, status, canManage, onError }) => {
  const label = PROVIDER_LABELS[provider]
  const isConnected = !!status?.connected
  const comingSoon = !!status?.comingSoon

  const queryClient = useQueryClient()
  const startSync = useStartSync(provider)
  const { data: syncJob } = useSyncStatus(provider)
  const isSyncing = syncJob?.status === 'pending' || syncJob?.status === 'running'

  // lastSyncedAt comes from integrations status, a separate query from the sync
  // job — refetch it once the job actually finishes so "Last synced" updates
  // without a manual page refresh.
  useEffect(() => {
    if (syncJob?.status === 'completed') {
      queryClient.invalidateQueries({ queryKey: ['integrations', 'status'] })
    }
  }, [syncJob?.status, queryClient])

  const handleSyncNow = async () => {
    try {
      await startSync.mutateAsync()
    } catch (err: any) {
      onError(err?.response?.data?.error?.message || `Could not start ${label} sync`)
    }
  }

  return (
    <div className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-surface-3 text-sm font-semibold text-ink-2">
          {label[0]}
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-sm font-medium text-ink">{label}</p>
            {comingSoon ? (
              <span className="badge bg-surface-3 text-ink-3">Coming soon</span>
            ) : isConnected ? (
              <span className="badge bg-success/15 text-success">Connected</span>
            ) : (
              <span className="badge bg-surface-3 text-ink-3">Not connected</span>
            )}
          </div>
          <p className="mt-0.5 text-xs text-ink-3">
            {comingSoon
              ? `${label} integration is coming soon`
              : isConnected
                ? status?.lastSyncedAt
                  ? `Last synced ${formatDateTime(status.lastSyncedAt)}`
                  : 'Never synced yet'
                : `Not connected to this organization`}
          </p>
        </div>
      </div>

      <div className="shrink-0">
        {comingSoon ? null : isConnected ? (
          canManage ? (
            <button
              type="button"
              className="btn-outline-dark flex items-center gap-2 px-3 py-1.5 text-xs"
              onClick={handleSyncNow}
              disabled={isSyncing || startSync.isPending}
            >
              <RefreshCw className={`h-3.5 w-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
              {isSyncing ? 'Syncing…' : 'Sync now'}
            </button>
          ) : (
            <span className="text-xs text-ink-3">Owners/admins only</span>
          )
        ) : canManage ? (
          <Link to="/connect" className="btn-outline-dark inline-flex items-center gap-1.5 px-3 py-1.5 text-xs">
            Connect
            <ArrowUpRight className="h-3.5 w-3.5" />
          </Link>
        ) : (
          <span className="text-xs text-ink-3">Not connected</span>
        )}
      </div>
    </div>
  )
}

/**
 * Read-mostly integrations management screen: every provider at a glance with
 * its connection state, last-synced time, and a "Sync now" trigger. Connect/
 * disconnect stays on the Connect page — this is purely for keeping already-
 * connected data fresh without hunting through the dashboard.
 */
export const SettingsPage: React.FC = () => {
  const { organization } = useAuthContext()
  const { data: status, isLoading } = useIntegrationsStatus()
  const [error, setError] = useState<string | null>(null)

  const canManage = organization?.role === 'owner' || organization?.role === 'admin'

  return (
    <AppShell title="Settings" subtitle={`Manage ${organization?.name ?? 'your organization'}'s connected data sources`}>
      {error && <Banner variant="error" message={error} onDismiss={() => setError(null)} />}

      <div className="card p-6">
        <h2 className="text-lg font-semibold text-ink">Connections</h2>
        <p className="mt-1 text-sm text-ink-2">Trigger a manual sync any time — each sync only pulls what changed since the last one.</p>

        {isLoading ? (
          <p className="mt-6 text-sm text-ink-3">Loading…</p>
        ) : (
          <div className="mt-4 divide-y divide-line">
            {PROVIDERS.map((provider) => (
              <ProviderRow key={provider} provider={provider} status={status?.[provider]} canManage={canManage} onError={setError} />
            ))}
          </div>
        )}
      </div>
    </AppShell>
  )
}
