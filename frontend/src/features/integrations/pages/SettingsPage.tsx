import React, { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { RefreshCw, ArrowUpRight, Plus, Trash2 } from 'lucide-react'
import { useAuthContext } from '../../../shared/context/AuthContext'
import { useIntegrationsStatus } from '../hooks/useIntegrations'
import {
  useOrganizationSettings,
  useUpdateOrganizationSettings,
  useUpdateSalesforceOpportunityExtraFields,
  useCashMetricsAccountOptions,
  useUpdateCashMetricsAccounts,
  useGAndAAccountOptions,
  useUpdateGAndAAccounts,
  useCACAccountOptions,
  useUpdateCACSettings,
  useUpdateHubSpotHistorySource,
  useUpdateCm04Targets,
  useUpdateCm08MqlTargets,
  useUpdateMarketingSpendAccounts
} from '../hooks/useOrganizationSettings'
import { SalesforceOpportunityExtraField } from '../api/organizationSettingsApi'
import { useProductCategories, useUpdateProductCategories } from '../hooks/useProductCategories'
import { ProductCategory, ProductBillingFrequency } from '../api/productCategoriesApi'
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
      await startSync.mutateAsync(undefined)
    } catch (err: any) {
      onError(err?.response?.data?.error?.message || `Could not start ${label} sync`)
    }
  }

  // Incremental syncs only re-fetch what changed since last time, so a record untouched on the
  // CRM side since a new synced field shipped (e.g. invoice line items) never picks it up on its
  // own — this re-fetches everything unconditionally, once, to backfill it.
  const handleForceResync = async () => {
    try {
      await startSync.mutateAsync(true)
    } catch (err: any) {
      onError(err?.response?.data?.error?.message || `Could not start ${label} full resync`)
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
            <div className="flex flex-col items-end gap-1">
              <button
                type="button"
                className="btn-outline-dark flex items-center gap-2 px-3 py-1.5 text-xs"
                onClick={handleSyncNow}
                disabled={isSyncing || startSync.isPending}
              >
                <RefreshCw className={`h-3.5 w-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
                {isSyncing ? 'Syncing…' : 'Sync now'}
              </button>
              <button
                type="button"
                className="text-[11px] text-ink-3 underline decoration-dotted hover:text-brand disabled:cursor-not-allowed disabled:opacity-50"
                onClick={handleForceResync}
                disabled={isSyncing || startSync.isPending}
                title="Re-fetches everything from scratch, including records unchanged since the last sync — use this once after a new synced field ships, or if something looks out of date."
              >
                Force full resync
              </button>
            </div>
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

const MAX_EXTRA_FIELDS = 10

/**
 * Opportunity detail-view custom fields (e.g. Order Number, Current
 * Generator(s), Tracking Number, Delivery/Installation Status) — Salesforce
 * has no standard fields for these, so each org names its own custom
 * Opportunity fields here, same category of per-org gap as the competitor
 * field above. A forced full Opportunity resync backfills existing records
 * once saved (see organizations.service.ts).
 */
const OpportunityExtraFieldsSettings: React.FC<{ canManage: boolean; onError: (message: string) => void }> = ({ canManage, onError }) => {
  const { data: settings, isLoading } = useOrganizationSettings()
  const updateFields = useUpdateSalesforceOpportunityExtraFields()
  const [rows, setRows] = useState<SalesforceOpportunityExtraField[]>([])
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    setRows(settings?.salesforceOpportunityExtraFields ?? [])
  }, [settings?.salesforceOpportunityExtraFields])

  const nonEmptyRows = rows.filter((r) => r.apiName.trim() !== '' || r.label.trim() !== '')
  const isRowValid = (row: SalesforceOpportunityExtraField) => SALESFORCE_FIELD_NAME_REGEX.test(row.apiName.trim()) && row.label.trim() !== ''
  const isValid = nonEmptyRows.every(isRowValid)

  const updateRow = (index: number, patch: Partial<SalesforceOpportunityExtraField>) => {
    setRows((prev) => prev.map((r, i) => (i === index ? { ...r, ...patch } : r)))
    setSaved(false)
  }

  const handleSave = async () => {
    if (!isValid) return
    setSaved(false)
    try {
      await updateFields.mutateAsync(nonEmptyRows.map((r) => ({ apiName: r.apiName.trim(), label: r.label.trim() })))
      setSaved(true)
    } catch (err: any) {
      onError(err?.response?.data?.error?.message || 'Could not save opportunity field settings')
    }
  }

  return (
    <div className="card p-6">
      <h2 className="text-lg font-semibold text-ink">Opportunity detail fields (Salesforce)</h2>
      <p className="mt-1 text-sm text-ink-2">
        Custom Opportunity fields to show in the Opportunity detail view — e.g. Order Number, Current Generator(s), Tracking Number,
        Delivery/Installation Status.
      </p>

      {isLoading ? (
        <p className="mt-4 text-sm text-ink-3">Loading…</p>
      ) : canManage ? (
        <div className="mt-4 flex flex-col gap-3">
          {rows.map((row, index) => (
            <div key={index} className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <input
                type="text"
                className="form-input-dark w-full sm:max-w-[220px]"
                placeholder="Field API name (e.g. Order_Number__c)"
                value={row.apiName}
                onChange={(e) => updateRow(index, { apiName: e.target.value })}
              />
              <input
                type="text"
                className="form-input-dark w-full sm:max-w-[220px]"
                placeholder="Display label (e.g. Order Number)"
                value={row.label}
                onChange={(e) => updateRow(index, { label: e.target.value })}
              />
              <button
                type="button"
                aria-label="Remove field"
                className="shrink-0 self-start rounded-md p-2 text-ink-3 hover:bg-surface-3 hover:text-danger sm:self-auto"
                onClick={() => {
                  setRows((prev) => prev.filter((_, i) => i !== index))
                  setSaved(false)
                }}
              >
                <Trash2 className="h-4 w-4" />
              </button>
              {row.apiName.trim() !== '' && !SALESFORCE_FIELD_NAME_REGEX.test(row.apiName.trim()) && (
                <p className="text-xs text-danger sm:hidden">Invalid field API name</p>
              )}
            </div>
          ))}

          {rows.length < MAX_EXTRA_FIELDS && (
            <button
              type="button"
              className="btn-outline-dark inline-flex w-auto items-center gap-1.5 px-3 py-1.5 text-xs"
              onClick={() => setRows((prev) => [...prev, { apiName: '', label: '' }])}
            >
              <Plus className="h-3.5 w-3.5" />
              Add field
            </button>
          )}

          <div className="flex items-center gap-3">
            <button type="button" className="btn-primary w-auto px-4 py-2 text-sm" onClick={handleSave} disabled={!isValid || updateFields.isPending}>
              {updateFields.isPending ? 'Saving…' : 'Save'}
            </button>
            {saved && <span className="text-xs text-success">Saved — takes effect on the next Salesforce sync.</span>}
          </div>
          {!isValid && <p className="text-xs text-danger">Every field needs a valid API name (letters, digits, underscores) and a label.</p>}
        </div>
      ) : (
        <p className="mt-4 text-sm text-ink-3">
          {settings?.salesforceOpportunityExtraFields && settings.salesforceOpportunityExtraFields.length > 0
            ? settings.salesforceOpportunityExtraFields.map((f) => f.label).join(', ')
            : 'Not configured'}
        </p>
      )}
    </div>
  )
}

/**
 * CB-07's expenditure accounts and CB-10's A/R, A/P, and Inventory accounts
 * (Organization.model.ts) — neither is ever inferred automatically; an org
 * explicitly picks real QuickBooks accounts, read live off the Cash Flow
 * and Balance Sheet reports (never a separate Chart-of-Accounts call — see
 * `extractLeafAccounts` / `listCashMetricsAccountOptions`). Only shown once
 * QuickBooks is connected; only owners/admins can change it. docs/server.js
 * mirrors this same account-selection UI for its own CB-07/CB-10 sections.
 */
const CashMetricsAccountSettings: React.FC<{ canManage: boolean; onError: (message: string) => void }> = ({ canManage, onError }) => {
  const { data: settings, isLoading: settingsLoading } = useOrganizationSettings()
  const { data: accountOptions, isLoading: optionsLoading } = useCashMetricsAccountOptions(true)
  const updateAccounts = useUpdateCashMetricsAccounts()

  const [expenditureIds, setExpenditureIds] = useState<string[]>([])
  const [arId, setArId] = useState('')
  const [apId, setApId] = useState('')
  const [inventoryId, setInventoryId] = useState('')
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    setExpenditureIds(settings?.cb07ExpenditureAccountIds ?? [])
    setArId(settings?.cb10AccountsReceivableAccountId ?? '')
    setApId(settings?.cb10AccountsPayableAccountId ?? '')
    setInventoryId(settings?.cb10InventoryAccountId ?? '')
  }, [
    settings?.cb07ExpenditureAccountIds,
    settings?.cb10AccountsReceivableAccountId,
    settings?.cb10AccountsPayableAccountId,
    settings?.cb10InventoryAccountId
  ])

  const toggleExpenditureId = (id: string) => {
    setExpenditureIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
    setSaved(false)
  }

  const handleSave = async () => {
    setSaved(false)
    try {
      await updateAccounts.mutateAsync({
        cb07ExpenditureAccountIds: expenditureIds,
        cb10AccountsReceivableAccountId: arId || null,
        cb10AccountsPayableAccountId: apId || null,
        cb10InventoryAccountId: inventoryId || null
      })
      setSaved(true)
    } catch (err: any) {
      onError(err?.response?.data?.error?.message || 'Could not save cash metrics account settings')
    }
  }

  const isLoading = settingsLoading || optionsLoading
  const options = accountOptions ?? []
  const isConfigured = (settings?.cb07ExpenditureAccountIds?.length ?? 0) > 0 || !!settings?.cb10AccountsReceivableAccountId

  return (
    <div className="card p-6">
      <h2 className="text-lg font-semibold text-ink">Cash metrics accounts (QuickBooks)</h2>
      <p className="mt-1 text-sm text-ink-2">
        Which accounts count as capital expenditure (CB-07 Free Cash Flow Conversion) and which represent Accounts
        Receivable, Accounts Payable, and Inventory (CB-10 Cash Conversion Cycle) — never guessed automatically.
      </p>

      {isLoading ? (
        <p className="mt-4 text-sm text-ink-3">Loading…</p>
      ) : canManage ? (
        <div className="mt-4 flex flex-col gap-6">
          <div>
            <p className="text-sm font-medium text-ink">Expenditure accounts (CB-07 CapEx)</p>
            <p className="mt-1 text-xs text-ink-3">Select every account whose spend should count as capital expenditure.</p>
            {options.length === 0 ? (
              <p className="mt-2 text-xs text-ink-3">No QuickBooks accounts found yet — sync QuickBooks first.</p>
            ) : (
              <div className="mt-2 flex max-h-48 flex-col gap-1.5 overflow-y-auto rounded-md border border-line p-3">
                {options.map((account) => (
                  <label key={account.id} className="flex items-center gap-2 text-sm text-ink-2">
                    <input type="checkbox" checked={expenditureIds.includes(account.id)} onChange={() => toggleExpenditureId(account.id)} />
                    {account.name}
                    {account.section && <span className="text-xs text-ink-3">({account.section})</span>}
                  </label>
                ))}
              </div>
            )}
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <p className="text-sm font-medium text-ink">Accounts Receivable (CB-10)</p>
              <select
                className="form-input-dark mt-1 w-full"
                value={arId}
                onChange={(e) => {
                  setArId(e.target.value)
                  setSaved(false)
                }}
              >
                <option value="">Not configured</option>
                {options.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <p className="text-sm font-medium text-ink">Accounts Payable (CB-10)</p>
              <select
                className="form-input-dark mt-1 w-full"
                value={apId}
                onChange={(e) => {
                  setApId(e.target.value)
                  setSaved(false)
                }}
              >
                <option value="">Not configured</option>
                {options.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <p className="text-sm font-medium text-ink">Inventory (CB-10)</p>
              <select
                className="form-input-dark mt-1 w-full"
                value={inventoryId}
                onChange={(e) => {
                  setInventoryId(e.target.value)
                  setSaved(false)
                }}
              >
                <option value="">Not configured (no inventory)</option>
                {options.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button type="button" className="btn-primary w-auto px-4 py-2 text-sm" onClick={handleSave} disabled={updateAccounts.isPending}>
              {updateAccounts.isPending ? 'Saving…' : 'Save'}
            </button>
            {saved && <span className="text-xs text-success">Saved.</span>}
          </div>
        </div>
      ) : (
        <p className="mt-4 text-sm text-ink-3">{isConfigured ? 'Configured by an owner/admin' : 'Not configured'}</p>
      )}
    </div>
  )
}

/** Structurally mirrors CashMetricsAccountSettings above — a single checkbox multi-select for which QuickBooks P&L expense accounts count as G&A. */
/**
 * CM-07 (Marketing ROI)'s marketing-spend accounts (Organization.model.ts) —
 * which QuickBooks P&L expense accounts are marketing (programs, software,
 * media), never guessed from account names: a "Sales & Marketing" account
 * name can't tell sales spend from marketing spend. Same account universe as
 * G&A's picker (reuses its options query). Only shown once QuickBooks is
 * connected; only owners/admins can change it.
 */
const MarketingSpendAccountSettings: React.FC<{ canManage: boolean; onError: (message: string) => void }> = ({ canManage, onError }) => {
  const { data: settings, isLoading: settingsLoading } = useOrganizationSettings()
  const { data: accountOptions, isLoading: optionsLoading } = useGAndAAccountOptions(true)
  const updateAccounts = useUpdateMarketingSpendAccounts()

  const [marketingIds, setMarketingIds] = useState<string[]>([])
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    setMarketingIds(settings?.marketingSpendAccountIds ?? [])
  }, [settings?.marketingSpendAccountIds])

  const toggleMarketingId = (id: string) => {
    setMarketingIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
    setSaved(false)
  }

  const handleSave = async () => {
    setSaved(false)
    try {
      await updateAccounts.mutateAsync(marketingIds)
      setSaved(true)
    } catch (err: any) {
      onError(err?.response?.data?.error?.message || 'Could not save marketing spend accounts')
    }
  }

  const isLoading = settingsLoading || optionsLoading
  const options = accountOptions ?? []
  const isConfigured = (settings?.marketingSpendAccountIds?.length ?? 0) > 0

  return (
    <div className="card p-6">
      <h2 className="text-lg font-semibold text-ink">Marketing spend accounts (CM-07)</h2>
      <p className="mt-1 text-sm text-ink-2">
        Which expense accounts are marketing spend — programs, software and media — for Marketing ROI. Never guessed from account names, so
        sales spend booked under "Sales &amp; Marketing" stays out.
      </p>

      {isLoading ? (
        <p className="mt-4 text-sm text-ink-3">Loading…</p>
      ) : canManage ? (
        <div className="mt-4 flex flex-col gap-6">
          <div>
            <p className="text-sm font-medium text-ink">Marketing expense accounts</p>
            <p className="mt-1 text-xs text-ink-3">Select every expense account that should count as marketing spend.</p>
            {options.length === 0 ? (
              <p className="mt-2 text-xs text-ink-3">No QuickBooks expense accounts found yet — sync QuickBooks first.</p>
            ) : (
              <div className="mt-2 flex max-h-48 flex-col gap-1.5 overflow-y-auto rounded-md border border-line p-3">
                {options.map((account) => (
                  <label key={account.id} className="flex items-center gap-2 text-sm text-ink-2">
                    <input type="checkbox" checked={marketingIds.includes(account.id)} onChange={() => toggleMarketingId(account.id)} />
                    {account.name}
                    {account.section && <span className="text-xs text-ink-3">({account.section})</span>}
                  </label>
                ))}
              </div>
            )}
          </div>

          <div className="flex items-center gap-3">
            <button type="button" className="btn-primary w-auto px-4 py-2 text-sm" onClick={handleSave} disabled={updateAccounts.isPending}>
              {updateAccounts.isPending ? 'Saving…' : 'Save'}
            </button>
            {saved && <span className="text-xs text-success">Saved.</span>}
          </div>
        </div>
      ) : (
        <p className="mt-4 text-sm text-ink-3">{isConfigured ? 'Configured by an owner/admin' : 'Not configured'}</p>
      )}
    </div>
  )
}

const GAndAAccountSettings: React.FC<{ canManage: boolean; onError: (message: string) => void }> = ({ canManage, onError }) => {
  const { data: settings, isLoading: settingsLoading } = useOrganizationSettings()
  const { data: accountOptions, isLoading: optionsLoading } = useGAndAAccountOptions(true)
  const updateAccounts = useUpdateGAndAAccounts()

  const [gaExpenseIds, setGaExpenseIds] = useState<string[]>([])
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    setGaExpenseIds(settings?.gaExpenseAccountIds ?? [])
  }, [settings?.gaExpenseAccountIds])

  const toggleGaExpenseId = (id: string) => {
    setGaExpenseIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
    setSaved(false)
  }

  const handleSave = async () => {
    setSaved(false)
    try {
      await updateAccounts.mutateAsync(gaExpenseIds)
      setSaved(true)
    } catch (err: any) {
      onError(err?.response?.data?.error?.message || 'Could not save G&A account settings')
    }
  }

  const isLoading = settingsLoading || optionsLoading
  const options = accountOptions ?? []
  const isConfigured = (settings?.gaExpenseAccountIds?.length ?? 0) > 0

  return (
    <div className="card p-6">
      <h2 className="text-lg font-semibold text-ink">G&A % of Revenue accounts (QuickBooks)</h2>
      <p className="mt-1 text-sm text-ink-2">Which expense accounts count as General &amp; Administrative — never guessed automatically from account names.</p>

      {isLoading ? (
        <p className="mt-4 text-sm text-ink-3">Loading…</p>
      ) : canManage ? (
        <div className="mt-4 flex flex-col gap-6">
          <div>
            <p className="text-sm font-medium text-ink">G&A expense accounts</p>
            <p className="mt-1 text-xs text-ink-3">Select every expense account that should count toward G&A % of Revenue.</p>
            {options.length === 0 ? (
              <p className="mt-2 text-xs text-ink-3">No QuickBooks expense accounts found yet — sync QuickBooks first.</p>
            ) : (
              <div className="mt-2 flex max-h-48 flex-col gap-1.5 overflow-y-auto rounded-md border border-line p-3">
                {options.map((account) => (
                  <label key={account.id} className="flex items-center gap-2 text-sm text-ink-2">
                    <input type="checkbox" checked={gaExpenseIds.includes(account.id)} onChange={() => toggleGaExpenseId(account.id)} />
                    {account.name}
                    {account.section && <span className="text-xs text-ink-3">({account.section})</span>}
                  </label>
                ))}
              </div>
            )}
          </div>

          <div className="flex items-center gap-3">
            <button type="button" className="btn-primary w-auto px-4 py-2 text-sm" onClick={handleSave} disabled={updateAccounts.isPending}>
              {updateAccounts.isPending ? 'Saving…' : 'Save'}
            </button>
            {saved && <span className="text-xs text-success">Saved.</span>}
          </div>
        </div>
      ) : (
        <p className="mt-4 text-sm text-ink-3">{isConfigured ? 'Configured by an owner/admin' : 'Not configured'}</p>
      )}
    </div>
  )
}

const CAC_DURATION_OPTIONS = Array.from({ length: 12 }, (_, i) => i + 1)

/** Structurally mirrors GAndAAccountSettings above, plus a Duration select — the non-overlapping window size (in months) CAC is computed over. */
const CACAccountSettings: React.FC<{ canManage: boolean; onError: (message: string) => void }> = ({ canManage, onError }) => {
  const { data: settings, isLoading: settingsLoading } = useOrganizationSettings()
  const { data: accountOptions, isLoading: optionsLoading } = useCACAccountOptions(true)
  const updateSettings = useUpdateCACSettings()

  const [cacExpenseIds, setCacExpenseIds] = useState<string[]>([])
  const [durationMonths, setDurationMonths] = useState(1)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    setCacExpenseIds(settings?.cacExpenseAccountIds ?? [])
    setDurationMonths(settings?.cacDurationMonths ?? 1)
  }, [settings?.cacExpenseAccountIds, settings?.cacDurationMonths])

  const toggleCacExpenseId = (id: string) => {
    setCacExpenseIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
    setSaved(false)
  }

  const handleSave = async () => {
    setSaved(false)
    try {
      await updateSettings.mutateAsync({ cacExpenseAccountIds: cacExpenseIds, cacDurationMonths: durationMonths })
      setSaved(true)
    } catch (err: any) {
      onError(err?.response?.data?.error?.message || 'Could not save Customer Acquisition Cost settings')
    }
  }

  const isLoading = settingsLoading || optionsLoading
  const options = accountOptions ?? []
  const isConfigured = (settings?.cacExpenseAccountIds?.length ?? 0) > 0

  return (
    <div className="card p-6">
      <h2 className="text-lg font-semibold text-ink">Customer Acquisition Cost accounts (QuickBooks)</h2>
      <p className="mt-1 text-sm text-ink-2">
        Which expense accounts count as acquisition spend, and the non-overlapping window (in months) CAC is computed over — e.g. a
        2-month window buckets spend and new customers as Jan+Feb, then Mar+Apr, never a sliding average.
      </p>

      {isLoading ? (
        <p className="mt-4 text-sm text-ink-3">Loading…</p>
      ) : canManage ? (
        <div className="mt-4 flex flex-col gap-6">
          <div>
            <p className="text-sm font-medium text-ink">Acquisition expense accounts</p>
            <p className="mt-1 text-xs text-ink-3">Select every expense account that should count toward acquisition spend.</p>
            {options.length === 0 ? (
              <p className="mt-2 text-xs text-ink-3">No QuickBooks expense accounts found yet — sync QuickBooks first.</p>
            ) : (
              <div className="mt-2 flex max-h-48 flex-col gap-1.5 overflow-y-auto rounded-md border border-line p-3">
                {options.map((account) => (
                  <label key={account.id} className="flex items-center gap-2 text-sm text-ink-2">
                    <input type="checkbox" checked={cacExpenseIds.includes(account.id)} onChange={() => toggleCacExpenseId(account.id)} />
                    {account.name}
                    {account.section && <span className="text-xs text-ink-3">({account.section})</span>}
                  </label>
                ))}
              </div>
            )}
          </div>

          <div className="max-w-xs">
            <p className="text-sm font-medium text-ink">Duration</p>
            <select
              className="form-input-dark mt-1 w-full"
              value={durationMonths}
              onChange={(e) => {
                setDurationMonths(Number(e.target.value))
                setSaved(false)
              }}
            >
              {CAC_DURATION_OPTIONS.map((months) => (
                <option key={months} value={months}>
                  {months} {months === 1 ? 'month' : 'months'}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-3">
            <button type="button" className="btn-primary w-auto px-4 py-2 text-sm" onClick={handleSave} disabled={updateSettings.isPending}>
              {updateSettings.isPending ? 'Saving…' : 'Save'}
            </button>
            {saved && <span className="text-xs text-success">Saved.</span>}
          </div>
        </div>
      ) : (
        <p className="mt-4 text-sm text-ink-3">{isConfigured ? 'Configured by an owner/admin' : 'Not configured'}</p>
      )}
    </div>
  )
}

const CATEGORY_OPTIONS: { value: ProductCategory; label: string }[] = [
  { value: 'recurring', label: 'Recurring' },
  { value: 'non_recurring', label: 'Non-recurring' },
  { value: 'not_sure', label: 'Not sure' }
]

const FREQUENCY_OPTIONS: { value: ProductBillingFrequency; label: string }[] = [
  { value: 'monthly', label: 'Monthly' },
  { value: 'quarterly', label: 'Quarterly' },
  { value: 'yearly', label: 'Yearly' }
]

interface ProductDraft {
  category: ProductCategory
  billingFrequency?: ProductBillingFrequency
}

/**
 * Categorizes QuickBooks products as recurring/non-recurring/not-sure (and,
 * for recurring, how often they bill) — VC-01/VC-02 and VC-13, plus the
 * dashboard's recurring-revenue trend charts, read this instead of guessing
 * recurring revenue from account-name keywords.
 * Structurally mirrors CashMetricsAccountSettings above, but as a searchable
 * table instead of a fixed checkbox list since product catalogs can be large.
 */
const ProductCategorySettings: React.FC<{ canManage: boolean; onError: (message: string) => void }> = ({ canManage, onError }) => {
  const { data: products, isLoading } = useProductCategories('quickbooks', true)
  const updateCategories = useUpdateProductCategories('quickbooks')

  const [drafts, setDrafts] = useState<Record<string, ProductDraft>>({})
  const [search, setSearch] = useState('')
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    const next: Record<string, ProductDraft> = {}
    for (const product of products ?? []) {
      next[product.providerRecordId] = { category: product.category, billingFrequency: product.billingFrequency }
    }
    setDrafts(next)
  }, [products])

  const setDraft = (id: string, draft: ProductDraft) => {
    setDrafts((prev) => ({ ...prev, [id]: draft }))
    setSaved(false)
  }

  const handleSave = async () => {
    setSaved(false)
    const updates = (products ?? [])
      .filter((product) => {
        const draft = drafts[product.providerRecordId]
        return draft && (draft.category !== product.category || draft.billingFrequency !== product.billingFrequency)
      })
      .map((product) => {
        const draft = drafts[product.providerRecordId]
        return {
          providerRecordId: product.providerRecordId,
          category: draft.category,
          billingFrequency: draft.category === 'recurring' ? draft.billingFrequency : undefined
        }
      })

    if (updates.length === 0) {
      setSaved(true)
      return
    }

    try {
      await updateCategories.mutateAsync(updates)
      setSaved(true)
    } catch (err: any) {
      onError(err?.response?.data?.error?.message || 'Could not save product categories')
    }
  }

  const options = products ?? []
  const filtered = options.filter((product) => product.name.toLowerCase().includes(search.trim().toLowerCase()))

  return (
    <div className="card p-6">
      <h2 className="text-lg font-semibold text-ink">Product categories (QuickBooks)</h2>
      <p className="mt-1 text-sm text-ink-2">
        Mark which products generate recurring revenue, and how often they bill. VC-01/VC-02 (retention), VC-13, and the
        dashboard's recurring-revenue trend charts use this instead of guessing from account names — products left as
        "Not sure" are excluded from those metrics until categorized.
      </p>

      {isLoading ? (
        <p className="mt-4 text-sm text-ink-3">Loading…</p>
      ) : !canManage ? (
        <p className="mt-4 text-sm text-ink-3">Configured by an owner/admin</p>
      ) : options.length === 0 ? (
        <p className="mt-4 text-xs text-ink-3">No QuickBooks products found yet — sync QuickBooks first.</p>
      ) : (
        <div className="mt-4 flex flex-col gap-3">
          <input
            type="text"
            placeholder="Search products…"
            className="form-input-dark w-full max-w-sm"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />

          <div className="max-h-96 overflow-y-auto rounded-md border border-line">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-surface-2">
                <tr className="border-b border-line text-left text-xs font-medium uppercase tracking-wide text-ink-3">
                  <th className="px-3 py-2">Product</th>
                  <th className="px-3 py-2">Category</th>
                  <th className="px-3 py-2">Billing frequency</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {filtered.map((product) => {
                  const draft = drafts[product.providerRecordId] ?? { category: product.category, billingFrequency: product.billingFrequency }
                  return (
                    <tr key={product.providerRecordId}>
                      <td className="px-3 py-2 text-ink-2">{product.name}</td>
                      <td className="px-3 py-2">
                        <div className="flex gap-1">
                          {CATEGORY_OPTIONS.map((option) => (
                            <button
                              key={option.value}
                              type="button"
                              aria-pressed={draft.category === option.value}
                              className={`rounded-full border px-2.5 py-1 text-xs font-medium transition-colors duration-150 ${
                                draft.category === option.value
                                  ? 'border-brand bg-brand/10 text-brand'
                                  : 'border-line-strong text-ink-3 hover:bg-surface-3'
                              }`}
                              onClick={() =>
                                setDraft(product.providerRecordId, {
                                  category: option.value,
                                  billingFrequency: option.value === 'recurring' ? draft.billingFrequency : undefined
                                })
                              }
                            >
                              {option.label}
                            </button>
                          ))}
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        {draft.category === 'recurring' ? (
                          <select
                            aria-label={`Billing frequency for ${product.name}`}
                            className="form-input-dark"
                            value={draft.billingFrequency ?? ''}
                            onChange={(e) =>
                              setDraft(product.providerRecordId, {
                                category: 'recurring',
                                billingFrequency: (e.target.value || undefined) as ProductBillingFrequency | undefined
                              })
                            }
                          >
                            <option value="">Select frequency…</option>
                            {FREQUENCY_OPTIONS.map((option) => (
                              <option key={option.value} value={option.value}>
                                {option.label}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <span className="text-xs text-ink-3">—</span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          <div className="flex items-center gap-3">
            <button type="button" className="btn-primary w-auto px-4 py-2 text-sm" onClick={handleSave} disabled={updateCategories.isPending}>
              {updateCategories.isPending ? 'Saving…' : 'Save'}
            </button>
            {saved && <span className="text-xs text-success">Saved.</span>}
          </div>
        </div>
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
const MAX_MONTH_RANGE_TARGETS = 60

/** One month-range target row as edited (CM-04's amounts, CM-08's MQL counts). */
interface MonthRangeTarget {
  fromMonth: string
  toMonth: string
  value: number
}

interface MonthRangeTargetRow {
  fromMonth: string
  toMonth: string
  /** Kept as typed text so a half-typed number doesn't fight the input. */
  value: string
}

const formatMonth = (month: string) => {
  const [year, mo] = month.split('-').map(Number)
  return new Date(Date.UTC(year, mo - 1, 1)).toLocaleString(undefined, { month: 'short', year: 'numeric', timeZone: 'UTC' })
}

/** Row problems the server would reject too (organizations.validator.ts) — shown inline before saving. */
function monthRangeRowErrors(rows: MonthRangeTargetRow[]): (string | null)[] {
  return rows.map((row, index) => {
    if (!row.fromMonth || !row.toMonth) return 'Pick both months'
    if (row.fromMonth > row.toMonth) return 'From month must be on or before To month'
    const value = Number(row.value)
    if (!row.value.trim() || !Number.isFinite(value) || value <= 0) return 'Target must be greater than 0'
    const overlap = rows.find((other, i) => i !== index && other.fromMonth && other.toMonth && row.fromMonth <= other.toMonth && other.fromMonth <= row.toMonth)
    return overlap ? `Overlaps ${formatMonth(overlap.fromMonth)} – ${formatMonth(overlap.toMonth)}` : null
  })
}

interface MonthRangeTargetSettingsProps {
  canManage: boolean
  onError: (message: string) => void
  title: string
  description: string
  valueLabel: string
  placeholder: string
  /** How a saved value reads in the owner/admin-less read-only list. */
  formatValue: (value: number) => string
  targets: MonthRangeTarget[] | undefined
  isLoading: boolean
  isSaving: boolean
  save: (targets: MonthRangeTarget[]) => Promise<unknown>
  saveErrorMessage: string
  savedMessage: string
}

/**
 * Plan targets entered by month range — operating-plan data no CRM holds
 * (CM-04's new-business amounts, CM-08's MQL counts). Each row is one total
 * for a month range, spread evenly across its months (see
 * Organization.model.ts). Only owners/admins can change it; no resync needed.
 */
const MonthRangeTargetSettings: React.FC<MonthRangeTargetSettingsProps> = ({
  canManage,
  onError,
  title,
  description,
  valueLabel,
  placeholder,
  formatValue,
  targets,
  isLoading,
  isSaving,
  save,
  saveErrorMessage,
  savedMessage
}) => {
  const [rows, setRows] = useState<MonthRangeTargetRow[]>([])
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    setRows((targets ?? []).map((t) => ({ fromMonth: t.fromMonth, toMonth: t.toMonth, value: String(t.value) })))
  }, [targets])

  const errors = monthRangeRowErrors(rows)
  const isValid = errors.every((e) => e === null)

  const updateRow = (index: number, patch: Partial<MonthRangeTargetRow>) => {
    setRows((prev) => prev.map((r, i) => (i === index ? { ...r, ...patch } : r)))
    setSaved(false)
  }

  const handleSave = async () => {
    if (!isValid) return
    setSaved(false)
    try {
      await save(rows.map((r) => ({ fromMonth: r.fromMonth, toMonth: r.toMonth, value: Number(r.value) })))
      setSaved(true)
    } catch (err: any) {
      onError(err?.response?.data?.error?.message || saveErrorMessage)
    }
  }

  return (
    <div className="card p-6">
      <h2 className="text-lg font-semibold text-ink">{title}</h2>
      <p className="mt-1 text-sm text-ink-2">{description}</p>

      {isLoading ? (
        <p className="mt-4 text-sm text-ink-3">Loading…</p>
      ) : canManage ? (
        <div className="mt-4 flex flex-col gap-3">
          {rows.length === 0 && <p className="text-xs text-ink-3">No targets yet.</p>}
          {rows.map((row, index) => (
            <div key={index} className="flex flex-col gap-1">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <label className="flex items-center gap-2 text-xs text-ink-3">
                  From
                  <input type="month" className="form-input-dark w-full sm:w-40" value={row.fromMonth} onChange={(e) => updateRow(index, { fromMonth: e.target.value })} />
                </label>
                <label className="flex items-center gap-2 text-xs text-ink-3">
                  To
                  <input type="month" className="form-input-dark w-full sm:w-40" value={row.toMonth} onChange={(e) => updateRow(index, { toMonth: e.target.value })} />
                </label>
                <label className="flex items-center gap-2 text-xs text-ink-3">
                  {valueLabel}
                  <input
                    type="number"
                    min="0"
                    step="any"
                    inputMode="decimal"
                    className="form-input-dark w-full sm:w-44"
                    placeholder={placeholder}
                    value={row.value}
                    onChange={(e) => updateRow(index, { value: e.target.value })}
                  />
                </label>
                <button
                  type="button"
                  aria-label="Remove target"
                  className="shrink-0 self-start rounded-md p-2 text-ink-3 hover:bg-surface-3 hover:text-danger sm:self-auto"
                  onClick={() => {
                    setRows((prev) => prev.filter((_, i) => i !== index))
                    setSaved(false)
                  }}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
              {errors[index] && <p className="text-xs text-danger">{errors[index]}</p>}
            </div>
          ))}

          {rows.length < MAX_MONTH_RANGE_TARGETS && (
            <button
              type="button"
              className="btn-outline-dark inline-flex w-auto items-center gap-1.5 self-start px-3 py-1.5 text-xs"
              onClick={() => setRows((prev) => [...prev, { fromMonth: '', toMonth: '', value: '' }])}
            >
              <Plus className="h-3.5 w-3.5" />
              Add target
            </button>
          )}

          <div className="flex items-center gap-3">
            <button type="button" className="btn-primary w-auto px-4 py-2 text-sm" onClick={handleSave} disabled={!isValid || isSaving}>
              {isSaving ? 'Saving…' : 'Save'}
            </button>
            {saved && <span className="text-xs text-success">{savedMessage}</span>}
          </div>
        </div>
      ) : targets && targets.length > 0 ? (
        <ul className="mt-4 flex flex-col gap-1 text-sm text-ink-2">
          {targets.map((t) => (
            <li key={t.fromMonth}>
              {formatMonth(t.fromMonth)} – {formatMonth(t.toMonth)}: {formatValue(t.value)}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-4 text-sm text-ink-3">Not configured</p>
      )}
    </div>
  )
}

/** CM-04 (Pipeline Coverage)'s new-business targets. Shown once a CRM is connected. */
const Cm04TargetSettings: React.FC<{ canManage: boolean; onError: (message: string) => void }> = ({ canManage, onError }) => {
  const { data: settings, isLoading } = useOrganizationSettings()
  const updateTargets = useUpdateCm04Targets()
  const targets = useMemo(
    () => settings?.cm04Targets?.map((t) => ({ fromMonth: t.fromMonth, toMonth: t.toMonth, value: t.targetAmount })),
    [settings?.cm04Targets]
  )

  return (
    <MonthRangeTargetSettings
      canManage={canManage}
      onError={onError}
      title="Pipeline Coverage targets (CM-04)"
      description="CM-04 compares qualified new-business pipeline closing next quarter with that quarter's new-business target. Enter the target for a range of months — the amount is the total for the whole range and is spread evenly across its months, so one row per quarter, half or year all work. A quarter with any month left uncovered shows as not computable."
      valueLabel="Target ($)"
      placeholder="878000"
      formatValue={(value) => `$${value.toLocaleString()}`}
      targets={targets}
      isLoading={isLoading}
      isSaving={updateTargets.isPending}
      save={(rows) => updateTargets.mutateAsync(rows.map((r) => ({ fromMonth: r.fromMonth, toMonth: r.toMonth, targetAmount: r.value })))}
      saveErrorMessage="Could not save pipeline coverage targets"
      savedMessage="Saved — CM-04 uses the new targets right away."
    />
  )
}

/** CM-08 (Lead Volume vs. Plan)'s MQL plan. Shown once HubSpot is connected — MQLs come from HubSpot lifecycle stages. */
const Cm08MqlTargetSettings: React.FC<{ canManage: boolean; onError: (message: string) => void }> = ({ canManage, onError }) => {
  const { data: settings, isLoading } = useOrganizationSettings()
  const updateTargets = useUpdateCm08MqlTargets()
  const targets = useMemo(
    () => settings?.cm08MqlTargets?.map((t) => ({ fromMonth: t.fromMonth, toMonth: t.toMonth, value: t.targetCount })),
    [settings?.cm08MqlTargets]
  )

  return (
    <MonthRangeTargetSettings
      canManage={canManage}
      onError={onError}
      title="MQL plan (CM-08)"
      description="CM-08 compares the MQLs generated each month with the operating plan. Enter the planned MQLs for a range of months — the number is the total for the whole range and is spread evenly across its months. Months with no plan still show the MQL count and trend; only the plan comparison is skipped."
      valueLabel="Planned MQLs"
      placeholder="450"
      formatValue={(value) => `${value.toLocaleString()} MQLs`}
      targets={targets}
      isLoading={isLoading}
      isSaving={updateTargets.isPending}
      save={(rows) => updateTargets.mutateAsync(rows.map((r) => ({ fromMonth: r.fromMonth, toMonth: r.toMonth, targetCount: r.value })))}
      saveErrorMessage="Could not save the MQL plan"
      savedMessage="Saved — CM-08 uses the new plan right away."
    />
  )
}

/**
 * Where HubSpot stage history comes from. Off (default) uses HubSpot's own
 * native history; on uses the `rl_*` custom objects/properties, for portals
 * whose past data was imported from CSV — HubSpot stamps imported native
 * history with the import date, so the real dates only survive in `rl_*`.
 * Only shown once HubSpot is connected; only owners/admins can change it.
 */
const HubSpotHistorySourceSettings: React.FC<{ canManage: boolean; onError: (message: string) => void }> = ({ canManage, onError }) => {
  const { data: settings, isLoading } = useOrganizationSettings()
  const updateSource = useUpdateHubSpotHistorySource()
  const [useImported, setUseImported] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    setUseImported(settings?.hubspotUseImportedHistory ?? false)
  }, [settings?.hubspotUseImportedHistory])

  const handleSave = async () => {
    setSaved(false)
    try {
      await updateSource.mutateAsync(useImported)
      setSaved(true)
    } catch (err: any) {
      onError(err?.response?.data?.error?.message || 'Could not save HubSpot history source')
    }
  }

  return (
    <div className="card p-6">
      <h2 className="text-lg font-semibold text-ink">History source (HubSpot)</h2>
      <p className="mt-1 text-sm text-ink-2">
        Turn on only if this portal's past data was imported from CSV/Excel — stage history and original dates are then read from the
        imported <code>rl_*</code> fields instead of HubSpot's own history.
      </p>

      {isLoading ? (
        <p className="mt-4 text-sm text-ink-3">Loading…</p>
      ) : canManage ? (
        <div className="mt-4 flex flex-col gap-3">
          <label className="flex items-center gap-2 text-sm text-ink-2">
            <input
              type="checkbox"
              checked={useImported}
              onChange={(e) => {
                setUseImported(e.target.checked)
                setSaved(false)
              }}
            />
            Use imported history (<code>rl_*</code> fields)
          </label>

          <div className="flex items-center gap-3">
            <button
              type="button"
              className="btn-primary w-auto px-4 py-2 text-sm"
              onClick={handleSave}
              disabled={updateSource.isPending || useImported === (settings?.hubspotUseImportedHistory ?? false)}
            >
              {updateSource.isPending ? 'Saving…' : 'Save'}
            </button>
            {saved && <span className="text-xs text-success">Saved — a full HubSpot resync has started.</span>}
          </div>
        </div>
      ) : (
        <p className="mt-4 text-sm text-ink-3">
          {settings?.hubspotUseImportedHistory ? 'Using imported history (rl_* fields)' : "Using HubSpot's native history"}
        </p>
      )}
    </div>
  )
}

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

      {status?.hubspot?.connected && <HubSpotHistorySourceSettings canManage={canManage} onError={setError} />}
      {(status?.hubspot?.connected || status?.salesforce?.connected) && <Cm04TargetSettings canManage={canManage} onError={setError} />}
      {status?.hubspot?.connected && <Cm08MqlTargetSettings canManage={canManage} onError={setError} />}
      {status?.salesforce?.connected && <CompetitorFieldSettings canManage={canManage} onError={setError} />}
      {status?.salesforce?.connected && <OpportunityExtraFieldsSettings canManage={canManage} onError={setError} />}
      {status?.quickbooks?.connected && <CashMetricsAccountSettings canManage={canManage} onError={setError} />}
      {status?.quickbooks?.connected && <GAndAAccountSettings canManage={canManage} onError={setError} />}
      {status?.quickbooks?.connected && <CACAccountSettings canManage={canManage} onError={setError} />}
      {status?.quickbooks?.connected && <MarketingSpendAccountSettings canManage={canManage} onError={setError} />}
      {status?.quickbooks?.connected && <ProductCategorySettings canManage={canManage} onError={setError} />}
    </AppShell>
  )
}
