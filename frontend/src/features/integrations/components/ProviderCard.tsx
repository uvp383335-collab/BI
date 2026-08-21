import React, { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { RefreshCw } from 'lucide-react'
import { IntegrationProvider, ProviderStatus } from '../api/integrationsApi'
import { useConnectProvider, useDisconnectProvider } from '../hooks/useIntegrations'
import { useStartSync, useSyncStatus } from '../../dashboard/hooks/useSync'
import { Banner } from '../../../shared/components/Banner'
import { Modal } from '../../../shared/components/Modal'
import { formatDateTime } from '../../../shared/utils/formatDate'

const PROVIDER_LABELS: Record<IntegrationProvider, string> = {
  hubspot: 'HubSpot',
  salesforce: 'Salesforce',
  quickbooks: 'QuickBooks'
}

interface ProviderCardProps {
  provider: IntegrationProvider
  status?: ProviderStatus
  isLoading: boolean
  /** Only org owners/admins are allowed to connect/disconnect integrations. */
  canManage: boolean
}

export const ProviderCard: React.FC<ProviderCardProps> = ({ provider, status, isLoading, canManage }) => {
  const queryClient = useQueryClient()
  const connectProvider = useConnectProvider()
  const disconnectProvider = useDisconnectProvider()
  const startSync = useStartSync(provider)
  const { data: syncJob } = useSyncStatus(provider)
  const [error, setError] = useState<string | null>(null)
  const [showDisconnectConfirm, setShowDisconnectConfirm] = useState(false)

  const label = PROVIDER_LABELS[provider]
  const isConnected = !!status?.connected
  const comingSoon = !!status?.comingSoon
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
    setError(null)
    try {
      await startSync.mutateAsync()
    } catch (err: any) {
      setError(err?.response?.data?.error?.message || `Could not start ${label} sync`)
    }
  }

  const handleConnect = async () => {
    setError(null)
    try {
      const { authUrl } = await connectProvider.mutateAsync(provider)
      // Full-page redirect to the provider's OAuth consent screen.
      window.location.href = authUrl
    } catch (err: any) {
      setError(err?.response?.data?.error?.message || `Could not start ${label} connection`)
    }
  }

  const handleDisconnect = async () => {
    setError(null)
    setShowDisconnectConfirm(false)
    try {
      // No success message needed — the badge below flips to "Not connected"
      // immediately, which is the confirmation.
      await disconnectProvider.mutateAsync(provider)
    } catch (err: any) {
      setError(err?.response?.data?.error?.message || `Could not disconnect ${label}`)
    }
  }

  return (
    <div className="card flex flex-col justify-between p-6">
      <div>
        {error && <Banner variant="error" message={error} onDismiss={() => setError(null)} className="mb-4" />}
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold text-ink">{label}</h3>
          {comingSoon ? (
            <span className="badge bg-surface-3 text-ink-3">Coming soon</span>
          ) : isConnected ? (
            <span className="badge bg-success/15 text-success">Connected</span>
          ) : (
            <span className="badge bg-surface-3 text-ink-3">Not connected</span>
          )}
        </div>
        <p className="mt-2 text-sm text-ink-2">
          {comingSoon
            ? `${label} integration is coming soon.`
            : isConnected
              ? `Your organization's ${label} account${status?.accountDomain ? ` (${status.accountDomain})` : ''} is connected.`
              : `Connect ${label} to link your organization's CRM data.`}
        </p>
        {isConnected && (
          <p className="mt-1 text-xs text-ink-3">
            {status?.lastSyncedAt ? `Last synced ${formatDateTime(status.lastSyncedAt)}` : 'Never synced yet'}
          </p>
        )}
      </div>

      <div className="mt-6">
        {comingSoon ? (
          <button type="button" className="btn-outline-dark w-full cursor-not-allowed opacity-60" disabled>
            Coming soon
          </button>
        ) : isConnected ? (
          <div className="space-y-2">
            {canManage && (
              <button
                type="button"
                className="btn-outline-dark flex w-full items-center justify-center gap-2"
                onClick={handleSyncNow}
                disabled={isSyncing || startSync.isPending}
              >
                <RefreshCw className={`h-4 w-4 ${isSyncing ? 'animate-spin' : ''}`} />
                {isSyncing ? 'Syncing…' : 'Sync now'}
              </button>
            )}
            {canManage && (
              <button
                type="button"
                className="btn-outline-dark w-full"
                onClick={() => setShowDisconnectConfirm(true)}
                disabled={disconnectProvider.isPending}
              >
                {disconnectProvider.isPending ? 'Disconnecting…' : 'Disconnect'}
              </button>
            )}
          </div>
        ) : !canManage ? (
          <p className="text-xs text-ink-3">Only organization owners and admins can manage this connection.</p>
        ) : (
          <button
            type="button"
            className="btn-primary w-full"
            onClick={handleConnect}
            disabled={connectProvider.isPending || isLoading}
          >
            {connectProvider.isPending ? 'Redirecting…' : `Connect ${label}`}
          </button>
        )}
      </div>

      {showDisconnectConfirm && (
        <Modal title={`Disconnect ${label}?`} onClose={() => setShowDisconnectConfirm(false)}>
          <p className="text-sm text-ink-2">
            Your organization's {label} account
            {status?.accountDomain ? ` (${status.accountDomain})` : ''} will be disconnected. Contacts and deals
            already synced are kept, and your dashboard will keep showing them — you can reconnect at any time to
            resume syncing.
          </p>
          <div className="mt-6 flex justify-end gap-2">
            <button
              type="button"
              className="btn-outline-dark w-auto px-4 py-2"
              onClick={() => setShowDisconnectConfirm(false)}
            >
              Cancel
            </button>
            <button
              type="button"
              className="w-auto rounded-lg bg-danger px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors duration-150 hover:bg-danger/90"
              onClick={handleDisconnect}
            >
              Disconnect
            </button>
          </div>
        </Modal>
      )}
    </div>
  )
}
