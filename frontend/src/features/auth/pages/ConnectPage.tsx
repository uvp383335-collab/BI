import React, { useEffect } from 'react'
import { useNavigate, useSearchParams, Link } from 'react-router-dom'
import { toast } from 'sonner'
import { useQueryClient } from '@tanstack/react-query'
import { useAuthContext } from '../../../shared/context/AuthContext'
import { buttonClass } from '../components/formControls'
import { OrgSwitcher } from '../components/OrgSwitcher'
import { useIntegrationsStatus } from '../../integrations/hooks/useIntegrations'
import { ProviderCard } from '../../integrations/components/ProviderCard'
import { IntegrationProvider } from '../../integrations/api/integrationsApi'

const PROVIDERS: IntegrationProvider[] = ['hubspot', 'salesforce', 'quickbooks']

/**
 * The "3 options" CRM selection screen. Users land here when their organization
 * has no connected CRM yet, or when they choose to "Switch CRM" from the
 * dashboard. Providers that are already connected surface a "Go to Dashboard"
 * action instead of just connect/disconnect.
 */
export const ConnectPage: React.FC = () => {
  const navigate = useNavigate()
  const { organization, clearSession } = useAuthContext()
  const { data: status, isLoading } = useIntegrationsStatus()
  const [searchParams, setSearchParams] = useSearchParams()
  const queryClient = useQueryClient()

  const canManageIntegrations = organization?.role === 'owner' || organization?.role === 'admin'

  // The HubSpot OAuth flow now redirects successes straight to /dashboard/:provider,
  // so a status here means the connection attempt failed (or params were missing).
  useEffect(() => {
    const provider = searchParams.get('provider')
    const oauthStatus = searchParams.get('status')
    if (provider && oauthStatus) {
      if (oauthStatus === 'error') {
        toast.error(`Could not connect ${provider}. Please try again.`)
      }
      queryClient.invalidateQueries({ queryKey: ['integrations', 'status'] })
      searchParams.delete('provider')
      searchParams.delete('status')
      searchParams.delete('reason')
      setSearchParams(searchParams, { replace: true })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleLogout = async () => {
    await clearSession()
    navigate('/login')
  }

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900">
      <header className="border-b border-slate-200 bg-white px-6 py-6 shadow-sm shadow-slate-100/50">
        <div className="mx-auto flex max-w-6xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-semibold text-blue-600">Organization</p>
            <h1 className="mt-2 text-3xl font-semibold text-slate-900">{organization?.name ?? 'Dashboard'}</h1>
            <p className="mt-1 text-sm text-slate-600 capitalize">Your role: {organization?.role ?? 'member'}</p>
          </div>
          <div className="flex items-center justify-end gap-3">
            <div>
              {/* Organization switcher */}
              <OrgSwitcher />
            </div>
            {canManageIntegrations && (
              <Link to="/invitations" className="btn-outline">
                Invite team members
              </Link>
            )}
            <div>
              <button type="button" className={`${buttonClass} w-auto px-5 py-2`} onClick={handleLogout}>
                Logout
              </button>
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-8">
        <div className="mb-6">
          <p className="text-sm font-semibold text-blue-600">Connect a data source</p>
          <h2 className="mt-2 text-2xl font-semibold text-gray-900">Set up your integration</h2>
          <p className="mt-2 text-sm text-gray-600">
            Choose a provider to connect your organization's data. This connection is shared by the whole
            organization — the next time anyone signs in under {organization?.name ?? 'this organization'}, the
            existing connection is reused automatically.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {PROVIDERS.map((provider) => (
            <ProviderCard
              key={provider}
              provider={provider}
              status={status?.[provider]}
              isLoading={isLoading}
              canManage={canManageIntegrations}
            />
          ))}
        </div>
      </main>
    </div>
  )
}
