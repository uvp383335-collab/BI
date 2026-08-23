import React, { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { RefreshCw, ArrowUpRight } from 'lucide-react'
import { useAuthContext } from '../../../shared/context/AuthContext'
import { useIntegrationsStatus } from '../hooks/useIntegrations'
import { useOrganizationSettings, useUpdateOrganizationSettings } from '../hooks/useOrganizationSettings'
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

const SALESFORCE_FIELD_NAME_REGEX = /^[A-Za-z][A-Za-z0-9_]*$/
type CompetitorModeChoice = 'none' | 'field' | 'junction'

/**
 * CM-03's per-org config (metrics guide gap G-11/G-24): Salesforce has no
 * single standard way to record "which competitor was in the deal" — it's
 * either a custom Opportunity field (commonly `Competitor__c`, one
 * competitor per deal) or the standard `OpportunityCompetitor` object
 * (several competitors per deal). Only shown once Salesforce is connected;
 * only owners/admins can change it.
 */
const CompetitorFieldSettings: React.FC<{ canManage: boolean; onError: (message: string) => void }> = ({ canManage, onError }) => {
  const { data: settings, isLoading } = useOrganizationSettings()
  const updateSettings = useUpdateOrganizationSettings()
  const [mode, setMode] = useState<CompetitorModeChoice>('none')
  const [fieldName, setFieldName] = useState('')
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    setMode(settings?.salesforceCompetitorSource ?? 'none')
    setFieldName(settings?.salesforceCompetitorField ?? '')
  }, [settings?.salesforceCompetitorSource, settings?.salesforceCompetitorField])

  const trimmed = fieldName.trim()
  const isValid = mode !== 'field' || SALESFORCE_FIELD_NAME_REGEX.test(trimmed)

  const handleSave = async () => {
    if (!isValid) return
    setSaved(false)
    try {
      await updateSettings.mutateAsync({
        source: mode === 'none' ? null : mode,
        field: mode === 'field' && trimmed !== '' ? trimmed : null
      })
      setSaved(true)
    } catch (err: any) {
      onError(err?.response?.data?.error?.message || 'Could not save competitor tracking settings')
    }
  }

  return (
    <div className="card p-6">
      <h2 className="text-lg font-semibold text-ink">Competitor tracking (Salesforce)</h2>
      <p className="mt-1 text-sm text-ink-2">
        How your team records the named competitor on a deal — powers CM-03 (win rate vs. named competitors).
      </p>

      {isLoading ? (
        <p className="mt-4 text-sm text-ink-3">Loading…</p>
      ) : canManage ? (
        <div className="mt-4 flex flex-col gap-3">
          <select
            className="form-input-dark w-full sm:max-w-xs"
            value={mode}
            onChange={(e) => {
              setMode(e.target.value as CompetitorModeChoice)
              setSaved(false)
            }}
          >
            <option value="none">Not tracked</option>
            <option value="field">Custom Opportunity field (one competitor per deal)</option>
            <option value="junction">Standard "Competitors" related list (multiple per deal)</option>
          </select>

          {mode === 'field' && (
            <input
              type="text"
              className="form-input-dark w-full sm:max-w-xs"
              placeholder="Competitor__c"
              value={fieldName}
              onChange={(e) => {
                setFieldName(e.target.value)
                setSaved(false)
              }}
            />
          )}

          <div className="flex items-center gap-3">
            <button
              type="button"
              className="btn-primary w-auto px-4 py-2 text-sm"
              onClick={handleSave}
              disabled={!isValid || updateSettings.isPending}
            >
              {updateSettings.isPending ? 'Saving…' : 'Save'}
            </button>
            {saved && <span className="text-xs text-success">Saved — takes effect on the next Salesforce sync.</span>}
          </div>
        </div>
      ) : (
        <p className="mt-4 text-sm text-ink-3">
          {settings?.salesforceCompetitorSource === 'junction'
            ? 'Configured: standard Competitors related list'
            : settings?.salesforceCompetitorField
              ? `Configured: ${settings.salesforceCompetitorField}`
              : 'Not configured'}
        </p>
      )}
      {mode === 'field' && !isValid && (
        <p className="mt-2 text-xs text-danger">Must be a valid Salesforce field API name (letters, digits, underscores).</p>
      )}
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

      {status?.salesforce?.connected && <CompetitorFieldSettings canManage={canManage} onError={setError} />}
    </AppShell>
  )
}
