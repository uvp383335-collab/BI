import React, { useEffect, useState } from 'react'
import { useSearchParams, Link } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { useAuthContext } from '../../../shared/context/AuthContext'
import { useSwitchOrg } from '../hooks/useAuthMutations'
import { useIntegrationsStatus } from '../../integrations/hooks/useIntegrations'
import { ProviderCard } from '../../integrations/components/ProviderCard'
import { IntegrationProvider } from '../../integrations/api/integrationsApi'
import { AppShell } from '../../../widgets/AppShell'
import { Banner, BannerAction } from '../../../shared/components/Banner'

const PROVIDERS: IntegrationProvider[] = ['hubspot', 'salesforce', 'quickbooks']
const PROVIDER_LABELS: Record<string, string> = { hubspot: 'HubSpot', salesforce: 'Salesforce', quickbooks: 'QuickBooks' }

/**
 * The "3 options" CRM selection screen. Users land here when their organization
 * has no connected CRM yet, or when they choose to "Switch CRM" from the
 * dashboard. A connected provider surfaces "Sync now" / "Disconnect" here —
 * getting to the dashboard itself happens via the sidebar, not this page.
 */
export const ConnectPage: React.FC = () => {
  const { organization, setSession } = useAuthContext()
  const { data: status, isLoading } = useIntegrationsStatus()
  const [searchParams, setSearchParams] = useSearchParams()
  const queryClient = useQueryClient()
  const switchOrg = useSwitchOrg()
  const [banner, setBanner] = useState<{ title?: string; message: string; action?: BannerAction } | null>(null)

  const canManageIntegrations = organization?.role === 'owner' || organization?.role === 'admin'

  // The HubSpot OAuth flow now redirects successes straight to /dashboard/:provider,
  // so a status here means the connection attempt failed (or params were missing) —
  // including the two "this HubSpot account is already connected elsewhere" cases.
  useEffect(() => {
    const provider = searchParams.get('provider')
    const oauthStatus = searchParams.get('status')
    const reason = searchParams.get('reason')
    if (provider && oauthStatus) {
      if (oauthStatus === 'error') {
        const providerLabel = PROVIDER_LABELS[provider] ?? provider
        if (reason === 'already_connected_switch') {
          const orgName = searchParams.get('orgName') || 'another organization'
          const targetOrgId = searchParams.get('orgId')
          setBanner({
            title: 'Already connected elsewhere',
            message: `This ${providerLabel} account belongs to "${orgName}", which you're a member of.`,
            action: targetOrgId
              ? {
                  label: `Switch to ${orgName}`,
                  onClick: async () => {
                    try {
                      const res = await switchOrg.mutateAsync(targetOrgId)
                      setSession(res.accessToken, res.organization)
                    } catch {
                      setBanner({ message: 'Could not switch organization. Please try again.' })
                    }
                  }
                }
              : undefined
          })
        } else if (reason === 'already_connected_request_access') {
          setBanner({
            title: 'Already connected elsewhere',
            message: `This ${providerLabel} account belongs to another workspace. Ask that workspace's admin to invite you, or connect a different account.`
          })
        } else if (reason === 'org_locked_to_account') {
          setBanner({
            title: 'Account locked',
            message: `${organization?.name ?? 'This organization'} is already connected to a different ${providerLabel} account. Create a new organization to connect a different one.`
          })
        } else {
          setBanner({ title: 'Connection failed', message: `Could not connect ${providerLabel}. Please try again.` })
        }
      }
      queryClient.invalidateQueries({ queryKey: ['integrations', 'status'] })
      searchParams.delete('provider')
      searchParams.delete('status')
      searchParams.delete('reason')
      searchParams.delete('orgId')
      searchParams.delete('orgName')
      searchParams.delete('orgSlug')
      setSearchParams(searchParams, { replace: true })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <AppShell
      title="Connect a data source"
      subtitle={`Choose a provider to connect ${organization?.name ?? 'your organization'}'s data`}
      headerRight={
        canManageIntegrations ? (
          <Link to="/invitations" className="btn-outline-dark">
            Invite team members
          </Link>
        ) : undefined
      }
    >
      {banner && (
        <Banner variant="error" title={banner.title} message={banner.message} action={banner.action} onDismiss={() => setBanner(null)} />
      )}

      <p className="max-w-2xl text-sm text-ink-2">
        This connection is shared by the whole organization — the next time anyone signs in under{' '}
        {organization?.name ?? 'this organization'}, the existing connection is reused automatically.
      </p>

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
    </AppShell>
  )
}
