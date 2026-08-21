import React, { useEffect, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { useQueryClient } from '@tanstack/react-query'
import { Users, Briefcase } from 'lucide-react'
import { useAuthContext } from '../../../shared/context/AuthContext'
import { useIntegrationsStatus } from '../../integrations/hooks/useIntegrations'
import { IntegrationProvider } from '../../integrations/api/integrationsApi'
import { useEntityCounts, usePipelineProgression, usePipelines, useStartSync, useSyncStatus } from '../hooks/useSync'
import { SyncProgressBanner } from '../components/SyncProgressBanner'
import { StatsCard } from '../components/StatsCard'
import { PipelineProgressionChart } from '../components/PipelineProgressionChart'
import { SettingsMenu } from '../components/SettingsMenu'

const PROVIDER_LABELS: Record<IntegrationProvider, string> = {
  hubspot: 'HubSpot',
  salesforce: 'Salesforce',
  quickbooks: 'QuickBooks'
}

const VALID_PROVIDERS: IntegrationProvider[] = ['hubspot', 'salesforce', 'quickbooks']

export const CrmDashboardPage: React.FC = () => {
  const { provider: providerParam } = useParams<{ provider: string }>()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const queryClient = useQueryClient()
  const { organization, clearSession } = useAuthContext()
  const { data: integrationsStatus, isLoading: isStatusLoading } = useIntegrationsStatus()
  const [pipelineFilter, setPipelineFilter] = useState('')

  const provider = (VALID_PROVIDERS.includes(providerParam as IntegrationProvider) ? providerParam : undefined) as
    | IntegrationProvider
    | undefined

  const status = provider ? integrationsStatus?.[provider] : undefined
  const isConnected = !!status?.connected

  // Guard: an unknown provider, or one that isn't connected for this org, has no
  // dashboard to show — send the user back to the connect screen.
  useEffect(() => {
    if (isStatusLoading) return
    if (!provider || !isConnected) {
      navigate('/connect', { replace: true })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isStatusLoading, provider, isConnected])

  useEffect(() => {
    const oauthStatus = searchParams.get('status')
    if (oauthStatus === 'success') {
      toast.success(`${provider ? PROVIDER_LABELS[provider] : 'Provider'} connected. Syncing your data…`)
      searchParams.delete('status')
      setSearchParams(searchParams, { replace: true })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const { data: syncJob } = useSyncStatus(provider ?? 'hubspot')
  const isSyncSettled = !syncJob || syncJob.status === 'completed' || syncJob.status === 'failed'
  const { data: entityCounts } = useEntityCounts(provider ?? 'hubspot', !!provider && isSyncSettled)
  const { data: pipelines } = usePipelines(provider ?? 'hubspot', !!provider && isSyncSettled)
  const { data: pipelineData, isLoading: isPipelineLoading } = usePipelineProgression(
    provider ?? 'hubspot',
    { pipeline: pipelineFilter || undefined },
    !!provider && isSyncSettled
  )
  const startSync = useStartSync(provider ?? 'hubspot')

  useEffect(() => {
    if (syncJob?.status === 'completed') {
      queryClient.invalidateQueries({ queryKey: ['sync', 'counts', provider] })
      queryClient.invalidateQueries({ queryKey: ['analytics', 'pipeline-progression', provider] })
      queryClient.invalidateQueries({ queryKey: ['analytics', 'pipelines', provider] })
    }
  }, [syncJob?.status, provider, queryClient])

  const handleResync = async () => {
    if (isSyncing) return
    try {
      await startSync.mutateAsync()
      toast.success('Sync started.')
    } catch (err: any) {
      toast.error(err?.response?.data?.error?.message || 'Could not start sync')
    }
  }

  const handleLogout = async () => {
    await clearSession()
    navigate('/login')
  }

  if (!provider || !isConnected) {
    return null
  }

  const label = PROVIDER_LABELS[provider]
  const isSyncing = syncJob?.status === 'pending' || syncJob?.status === 'running'
  const hasNeverSynced = !syncJob

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900">
      <header className="border-b border-slate-200 bg-white px-6 py-6 shadow-sm shadow-slate-100/50">
        <div className="mx-auto flex max-w-6xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-semibold text-blue-600">{organization?.name ?? 'Dashboard'}</p>
            <h1 className="mt-2 text-3xl font-semibold text-slate-900">{label} Dashboard</h1>
          </div>
          <div className="flex items-center justify-end gap-3">
            <button type="button" className="btn-outline" onClick={() => navigate('/connect')}>
              Switch CRM
            </button>
            <SettingsMenu onSyncNow={handleResync} isSyncing={isSyncing} />
            <button type="button" className="btn-primary w-auto px-5 py-2" onClick={handleLogout}>
              Logout
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl space-y-8 px-6 py-8">
        {hasNeverSynced ? (
          <div className="flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-gray-300 p-12 text-center">
            <h3 className="text-lg font-semibold">No data synced yet</h3>
            <p className="mt-2 text-sm text-gray-600">Start your first sync to see contacts, deals, and pipeline insights.</p>
            <button type="button" className="btn-primary mt-6 w-auto px-6 py-2" onClick={handleResync} disabled={startSync.isPending}>
              Start Sync
            </button>
          </div>
        ) : (
          syncJob && <SyncProgressBanner job={syncJob} />
        )}

        {!hasNeverSynced && (
          <>
            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
              <StatsCard
                title="Contacts"
                value={entityCounts?.contacts ?? 0}
                description="Total contacts synced"
                icon={<Users className="h-5 w-5" />}
              />
              <StatsCard
                title="Deals"
                value={entityCounts?.deals ?? 0}
                description="Total deals synced"
                icon={<Briefcase className="h-5 w-5" />}
              />
            </div>

            <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
              <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h2 className="text-xl font-semibold text-gray-900">Pipeline Progression</h2>
                  <p className="text-sm text-gray-600">Deal flow across pipeline stages</p>
                </div>
                {pipelines && pipelines.length > 0 && (
                  <select
                    className="form-input w-auto"
                    value={pipelineFilter}
                    onChange={(e) => setPipelineFilter(e.target.value)}
                  >
                    <option value="">All pipelines</option>
                    {pipelines.map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </select>
                )}
              </div>

              {isPipelineLoading ? (
                <div className="flex h-80 items-center justify-center text-sm text-gray-500">Loading pipeline data…</div>
              ) : (
                <PipelineProgressionChart data={pipelineData ?? []} />
              )}
            </div>
          </>
        )}
      </main>
    </div>
  )
}
