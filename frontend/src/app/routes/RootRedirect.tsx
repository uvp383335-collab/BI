import React from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { Link2 } from 'lucide-react'
import { useIntegrationsStatus } from '../../features/integrations/hooks/useIntegrations'
import { IntegrationProvider } from '../../features/integrations/api/integrationsApi'
import { useEntityCounts } from '../../features/dashboard/hooks/useSync'
import { AppShell } from '../../widgets/AppShell'

const PROVIDERS: IntegrationProvider[] = ['hubspot', 'salesforce', 'quickbooks']

/**
 * Landing route after login. Sends the user straight to their CRM dashboard if
 * the organization already has a connected provider (e.g. returning users).
 * Otherwise this IS the dashboard — it stays put and shows an empty state
 * rather than redirecting to /connect, so clicking "Dashboard" in the sidebar
 * never yanks the user to an unrelated page.
 */
export const RootRedirect: React.FC = () => {
  const navigate = useNavigate()
  const { data: status, isLoading } = useIntegrationsStatus()

  const connectedProvider = PROVIDERS.find((provider) => status?.[provider]?.connected)

  // A provider can have historical Contact/Deal data even after its OAuth
  // connection was revoked (disconnect only deletes the token record, never
  // synced data) — check counts for every provider so a returning disconnected
  // org still lands on its dashboard instead of "no CRM connected".
  const shouldCheckData = !isLoading && !connectedProvider
  const hubspotCounts = useEntityCounts('hubspot', shouldCheckData)
  const salesforceCounts = useEntityCounts('salesforce', shouldCheckData)
  const quickbooksCounts = useEntityCounts('quickbooks', shouldCheckData)
  const countsQueries = [hubspotCounts, salesforceCounts, quickbooksCounts]

  if (isLoading) {
    return <div className="flex min-h-screen items-center justify-center bg-surface text-sm text-ink-3">Loading…</div>
  }

  if (connectedProvider) {
    return <Navigate to={`/dashboard/${connectedProvider}`} replace />
  }

  const isCheckingData = countsQueries.some((q) => q.isLoading)
  if (isCheckingData) {
    return <div className="flex min-h-screen items-center justify-center bg-surface text-sm text-ink-3">Loading…</div>
  }

  const providerWithData = PROVIDERS.find((provider, index) => {
    const counts = countsQueries[index].data
    return (counts?.contacts ?? 0) > 0 || (counts?.deals ?? 0) > 0
  })

  if (providerWithData) {
    return <Navigate to={`/dashboard/${providerWithData}`} replace />
  }

  return (
    <AppShell title="Dashboard" subtitle="Contacts, deals, and pipeline insights">
      <div className="card flex flex-col items-center justify-center border-dashed p-12 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-brand/15 text-brand">
          <Link2 className="h-6 w-6" />
        </div>
        <h3 className="mt-4 text-lg font-semibold text-ink">No CRM connected yet</h3>
        <p className="mt-2 max-w-sm text-sm text-ink-2">
          Connect HubSpot, Salesforce, or QuickBooks to start syncing your contacts, deals, and pipeline data.
        </p>
        <button type="button" className="btn-primary mt-6 w-auto px-6 py-2" onClick={() => navigate('/connect')}>
          Connect a data source
        </button>
      </div>
    </AppShell>
  )
}
