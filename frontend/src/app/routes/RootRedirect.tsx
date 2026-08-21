import React from 'react'
import { Navigate } from 'react-router-dom'
import { useIntegrationsStatus } from '../../features/integrations/hooks/useIntegrations'
import { IntegrationProvider } from '../../features/integrations/api/integrationsApi'

const PROVIDERS: IntegrationProvider[] = ['hubspot', 'salesforce', 'quickbooks']

/**
 * Landing route after login. Sends the user straight to their CRM dashboard if
 * the organization already has a connected provider (e.g. returning users),
 * otherwise to the 3-option connect screen.
 */
export const RootRedirect: React.FC = () => {
  const { data: status, isLoading } = useIntegrationsStatus()

  if (isLoading) {
    return <div className="flex min-h-screen items-center justify-center text-sm text-gray-500">Loading…</div>
  }

  const connectedProvider = PROVIDERS.find((provider) => status?.[provider]?.connected)

  if (connectedProvider) {
    return <Navigate to={`/dashboard/${connectedProvider}`} replace />
  }

  return <Navigate to="/connect" replace />
}
