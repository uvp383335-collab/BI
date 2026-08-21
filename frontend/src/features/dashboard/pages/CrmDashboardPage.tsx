import React, { useEffect, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { Users, Briefcase, TrendingDown, ArrowRightLeft, Trophy, ChevronDown } from 'lucide-react'
import { useIntegrationsStatus } from '../../integrations/hooks/useIntegrations'
import { IntegrationProvider } from '../../integrations/api/integrationsApi'
import { useEntityCounts, useFunnels, usePipelines, useStartSync, useSyncStatus } from '../hooks/useSync'
import { useAuthContext } from '../../../shared/context/AuthContext'
import { SyncProgressBanner } from '../components/SyncProgressBanner'
import { StatsCard } from '../components/StatsCard'
import { FunnelChart } from '../components/FunnelChart'
import { DateRangeFilter } from '../components/DateRangeFilter'
import { AppShell } from '../../../widgets/AppShell'
import { Banner } from '../../../shared/components/Banner'

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
  const { organization } = useAuthContext()
  const { data: integrationsStatus, isLoading: isStatusLoading } = useIntegrationsStatus()
  const [pipelineFilter, setPipelineFilter] = useState('')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [isFunnelsOpen, setIsFunnelsOpen] = useState(true)
  const [syncError, setSyncError] = useState<string | null>(null)

  const connectedProviders = VALID_PROVIDERS.filter((p) => integrationsStatus?.[p]?.connected)

  const provider = (VALID_PROVIDERS.includes(providerParam as IntegrationProvider) ? providerParam : undefined) as
    | IntegrationProvider
    | undefined

  const status = provider ? integrationsStatus?.[provider] : undefined
  const isConnected = !!status?.connected

  const { data: syncJob } = useSyncStatus(provider ?? 'hubspot')
  const isSyncSettled = !syncJob || syncJob.status === 'completed' || syncJob.status === 'failed'
  const { data: entityCounts, isLoading: isEntityCountsLoading } = useEntityCounts(
    provider ?? 'hubspot',
    !!provider && isSyncSettled
  )
  const hasAnyData = (entityCounts?.contacts ?? 0) > 0 || (entityCounts?.deals ?? 0) > 0

  // Guard: an unknown provider has no dashboard to show. A known provider with
  // no live connection still has one if it was synced before — disconnecting
  // only revokes the OAuth token, previously-synced Contact/Deal data stays in
  // the tenant DB — so only bounce to /connect once we know there's truly
  // nothing to show (never connected AND never synced).
  useEffect(() => {
    if (isStatusLoading || isEntityCountsLoading) return
    if (!provider || (!isConnected && !hasAnyData)) {
      navigate('/connect', { replace: true })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isStatusLoading, isEntityCountsLoading, provider, isConnected, hasAnyData])

  useEffect(() => {
    // No confirmation message needed on a successful OAuth redirect — the sync
    // banner/empty state below already shows what's happening.
    if (searchParams.get('status') === 'success') {
      searchParams.delete('status')
      setSearchParams(searchParams, { replace: true })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const { data: pipelines } = usePipelines(provider ?? 'hubspot', !!provider && isSyncSettled)
  const { data: funnels, isLoading: isFunnelsLoading } = useFunnels(
    organization?.id ?? '',
    provider ?? 'hubspot',
    { pipeline: pipelineFilter || undefined, from: fromDate || undefined, to: toDate || undefined },
    !!provider && !!organization && isSyncSettled
  )
  const startSync = useStartSync(provider ?? 'hubspot')

  // Funnel stage order needs one concrete pipeline — default to the first
  // once pipelines load, rather than leaving "all pipelines" selected.
  useEffect(() => {
    if (!pipelineFilter && pipelines && pipelines.length > 0) {
      setPipelineFilter(pipelines[0])
    }
  }, [pipelines, pipelineFilter])

  useEffect(() => {
    if (syncJob?.status === 'completed') {
      queryClient.invalidateQueries({ queryKey: ['sync', 'counts', provider] })
      queryClient.invalidateQueries({ queryKey: ['analytics', 'funnels', organization?.id, provider] })
      queryClient.invalidateQueries({ queryKey: ['analytics', 'pipelines', provider] })
    }
  }, [syncJob?.status, provider, organization?.id, queryClient])

  const handleResync = async () => {
    if (isSyncing) return
    setSyncError(null)
    try {
      // No success message needed — the sync banner below appears/updates immediately.
      await startSync.mutateAsync()
    } catch (err: any) {
      setSyncError(err?.response?.data?.error?.message || 'Could not start sync')
    }
  }

  if (!provider || (!isConnected && !hasAnyData)) {
    return null
  }

  const label = PROVIDER_LABELS[provider]
  const isSyncing = syncJob?.status === 'pending' || syncJob?.status === 'running'
  const hasNeverSynced = !syncJob && !hasAnyData

  const rate = (numerator?: number, denominator?: number) =>
    denominator && denominator > 0 ? Math.round(((numerator ?? 0) / denominator) * 100) : 0

  const leadConversionRate = rate(funnels?.leadStage.stages.at(-1)?.count, funnels?.leadStage.totalEntered)
  const leadToDealRate = rate(funnels?.leadToDeal.stages[1]?.count, funnels?.leadToDeal.totalEntered)
  const dealWinRate = rate(
    funnels?.dealStage.stages.find((s) => s.isWon)?.count,
    funnels?.dealStage.totalEntered
  )

  return (
    <AppShell title="Dashboard" subtitle="Contacts, deals, and pipeline insights">
      {syncError && <Banner variant="error" message={syncError} onDismiss={() => setSyncError(null)} />}

      {!isConnected && (
        <Banner
          variant="warning"
          message={`The connection to ${label} is no longer active — showing the last synced data. Reconnect to sync new changes.`}
          action={{ label: 'Reconnect', onClick: () => navigate('/connect') }}
        />
      )}

      {hasNeverSynced ? (
        <div className="card flex flex-col items-center justify-center border-dashed p-12 text-center">
          <h3 className="text-lg font-semibold text-ink">No data synced yet</h3>
          <p className="mt-2 text-sm text-ink-2">Start your first sync to see contacts, deals, and pipeline insights.</p>
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
              accent="brand"
            />
            <StatsCard
              title="Deals"
              value={entityCounts?.deals ?? 0}
              description="Total deals synced"
              icon={<Briefcase className="h-5 w-5" />}
              accent="violet"
            />
          </div>

          <div className="grid grid-cols-1 gap-6 sm:grid-cols-3">
            <StatsCard
              title="Lead Conversion"
              value={leadConversionRate}
              valueSuffix="%"
              description="Subscribers reaching final lead stage"
              icon={<TrendingDown className="h-5 w-5" />}
              accent="brand"
            />
            <StatsCard
              title="Lead to Deal"
              value={leadToDealRate}
              valueSuffix="%"
              description="Leads with an associated deal"
              icon={<ArrowRightLeft className="h-5 w-5" />}
              accent="teal"
            />
            <StatsCard
              title="Deal Win Rate"
              value={dealWinRate}
              valueSuffix="%"
              description="Deals reaching a won stage"
              icon={<Trophy className="h-5 w-5" />}
              accent="success"
            />
          </div>

          <div className="flex justify-end">
            <DateRangeFilter from={fromDate || undefined} to={toDate || undefined} onChange={({ from, to }) => {
              setFromDate(from ?? '')
              setToDate(to ?? '')
            }} />
          </div>

          <div className="card p-6">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <button
                type="button"
                onClick={() => setIsFunnelsOpen((open) => !open)}
                className="flex-1 rounded-lg text-left"
                aria-expanded={isFunnelsOpen}
              >
                <h2 className="text-xl font-semibold text-ink">Funnels</h2>
                <p className="text-sm text-ink-2">Lead and deal stage progression, and lead-to-deal conversion</p>
              </button>
              <div className="flex items-center gap-3">
                {connectedProviders.length > 1 && (
                  <select
                    className="form-input-dark w-auto"
                    value={provider}
                    onChange={(e) => navigate(`/dashboard/${e.target.value}`)}
                  >
                    {connectedProviders.map((p) => (
                      <option key={p} value={p}>
                        {PROVIDER_LABELS[p]}
                      </option>
                    ))}
                  </select>
                )}
                {pipelines && pipelines.length > 1 && (
                  <select
                    className="form-input-dark w-auto"
                    value={pipelineFilter}
                    onChange={(e) => setPipelineFilter(e.target.value)}
                  >
                    {pipelines.map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </select>
                )}
                <button
                  type="button"
                  onClick={() => setIsFunnelsOpen((open) => !open)}
                  aria-label={isFunnelsOpen ? 'Collapse funnels' : 'Expand funnels'}
                  aria-expanded={isFunnelsOpen}
                  className="rounded-full p-2 text-ink-2 transition-colors duration-150 hover:bg-surface-3 hover:text-ink"
                >
                  <ChevronDown
                    className={`h-6 w-6 transition-transform duration-300 ease-in-out ${isFunnelsOpen ? '' : '-rotate-90'}`}
                  />
                </button>
              </div>
            </div>

            <div
              className={`grid transition-[grid-template-rows] duration-300 ease-in-out ${isFunnelsOpen ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}
            >
              <div className="overflow-hidden">
                <div
                  className={`flex flex-col gap-6 pt-6 transition-opacity duration-300 ${isFunnelsOpen ? 'opacity-100 delay-100' : 'opacity-0'}`}
                >
                  {isFunnelsLoading ? (
                    <div className="flex h-64 items-center justify-center text-sm text-ink-3">
                      Loading funnel data…
                    </div>
                  ) : (
                    <>
                      <div className="card border-line-strong p-5">
                        <FunnelChart
                          title="Lead Stage Funnel"
                          description="Contacts by lifecycle stage"
                          data={funnels?.leadStage}
                        />
                      </div>
                      <div className="card border-line-strong p-5">
                        <FunnelChart
                          title="Lead → Deal Conversion"
                          description="Leads that became a deal"
                          data={funnels?.leadToDeal}
                        />
                      </div>
                      <div className="card border-line-strong p-5">
                        <FunnelChart
                          title="Deal Stage Funnel"
                          description="Deals by pipeline stage"
                          data={funnels?.dealStage}
                        />
                      </div>
                    </>
                  )}
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </AppShell>
  )
}
