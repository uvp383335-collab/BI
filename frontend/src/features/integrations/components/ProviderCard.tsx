import React from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { IntegrationProvider, ProviderStatus } from '../api/integrationsApi'
import { useConnectProvider, useDisconnectProvider } from '../hooks/useIntegrations'

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
  const navigate = useNavigate()
  const connectProvider = useConnectProvider()
  const disconnectProvider = useDisconnectProvider()

  const label = PROVIDER_LABELS[provider]
  const isConnected = !!status?.connected
  const comingSoon = !!status?.comingSoon

  const handleConnect = async () => {
    try {
      const { authUrl } = await connectProvider.mutateAsync(provider)
      // Full-page redirect to the provider's OAuth consent screen.
      window.location.href = authUrl
    } catch (err: any) {
      toast.error(err?.response?.data?.error?.message || `Could not start ${label} connection`)
    }
  }

  const handleDisconnect = async () => {
    try {
      await disconnectProvider.mutateAsync(provider)
      toast.success(`${label} disconnected.`)
    } catch (err: any) {
      toast.error(err?.response?.data?.error?.message || `Could not disconnect ${label}`)
    }
  }

  return (
    <div className="flex flex-col justify-between rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
      <div>
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold text-gray-900">{label}</h3>
          {comingSoon ? (
            <span className="rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-600">Coming soon</span>
          ) : isConnected ? (
            <span className="rounded-full bg-green-100 px-3 py-1 text-xs font-medium text-green-700">Connected</span>
          ) : (
            <span className="rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-600">Not connected</span>
          )}
        </div>
        <p className="mt-2 text-sm text-gray-600">
          {comingSoon
            ? `${label} integration is coming soon.`
            : isConnected
              ? `Your organization's ${label} account${status?.accountDomain ? ` (${status.accountDomain})` : ''} is connected.`
              : `Connect ${label} to link your organization's CRM data.`}
        </p>
      </div>

      <div className="mt-6">
        {comingSoon ? (
          <button type="button" className="btn-outline w-full cursor-not-allowed opacity-60" disabled>
            Coming soon
          </button>
        ) : isConnected ? (
          <div className="space-y-2">
            <button type="button" className="btn-primary w-full" onClick={() => navigate(`/dashboard/${provider}`)}>
              Go to Dashboard
            </button>
            {canManage && (
              <button
                type="button"
                className="btn-outline w-full"
                onClick={handleDisconnect}
                disabled={disconnectProvider.isPending}
              >
                {disconnectProvider.isPending ? 'Disconnecting…' : 'Disconnect'}
              </button>
            )}
          </div>
        ) : !canManage ? (
          <p className="text-xs text-gray-500">Only organization owners and admins can manage this connection.</p>
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
    </div>
  )
}
