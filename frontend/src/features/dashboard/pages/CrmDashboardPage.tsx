import React, { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import {
  Link2,
  Users,
  Briefcase,
  FileText,
  RefreshCcw,
  TrendingDown,
  Rocket,
  PieChart,
  Wallet,
  BarChart3,
  Target,
  Gauge,
  Repeat,
  LineChart,
  Banknote,
  Droplets,
  RefreshCw,
  Building2,
  Swords,
  ChevronDown
} from 'lucide-react'
import { useIntegrationsStatus } from '../../integrations/hooks/useIntegrations'
import { IntegrationProvider } from '../../integrations/api/integrationsApi'
import { useEntityCounts, useFunnels, usePipelines, useProducts, useStartSync, useSyncStatus } from '../hooks/useSync'
import { FunnelsResponse, Product } from '../api/syncApi'
import { useMetric, useMetricTrend } from '../hooks/useMetrics'
import { useAuthContext } from '../../../shared/context/AuthContext'
import { StatsCard } from '../components/StatsCard'
import { MetricCard } from '../components/MetricCard'
import { SyncProgressBanner } from '../components/SyncProgressBanner'
import { FunnelChart } from '../components/FunnelChart'
import { MetricTrendChart } from '../components/MetricTrendChart'
import { ProductRevenueGrowthChart } from '../components/ProductRevenueGrowthChart'
import { useQuickBooksDepartments, useQuickBooksCustomerStates, useProductRevenueGrowth } from '../hooks/useProductRevenueGrowth'
import { DateRangeFilter } from '../components/DateRangeFilter'
import { Banner } from '../../../shared/components/Banner'
import { AppShell } from '../../../widgets/AppShell'

const PROVIDER_LABELS: Record<IntegrationProvider, string> = {
  hubspot: 'HubSpot',
  salesforce: 'Salesforce',
  quickbooks: 'QuickBooks'
}

/** One provider's pipeline/date filters + its three funnel charts — the body of whichever tab is active. */
const FunnelsBody: React.FC<{
  pipelines?: string[]
  pipelineFilter: string
  onPipelineFilterChange: (value: string) => void
  products?: Product[]
  productFilter: string
  onProductFilterChange: (value: string) => void
  funnels?: FunnelsResponse
  isLoading: boolean
  fromDate: string
  toDate: string
  onDateChange: (range: { from?: string; to?: string }) => void
}> = ({
  pipelines,
  pipelineFilter,
  onPipelineFilterChange,
  products,
  productFilter,
  onProductFilterChange,
  funnels,
  isLoading,
  fromDate,
  toDate,
  onDateChange
}) => (
  <div className="flex flex-col gap-6">
    <div className="flex justify-end gap-3">
      {pipelines && pipelines.length > 1 && (
        <select className="form-input-dark w-auto" value={pipelineFilter} onChange={(e) => onPipelineFilterChange(e.target.value)}>
          {pipelines.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
      )}
      {products && products.length > 0 && (
        <select className="form-input-dark w-auto" value={productFilter} onChange={(e) => onProductFilterChange(e.target.value)}>
          <option value="">All products</option>
          {products.map((product) => (
            <option key={product.id} value={product.id}>
              {product.name}
            </option>
          ))}
        </select>
      )}
      <DateRangeFilter from={fromDate || undefined} to={toDate || undefined} onChange={onDateChange} />
    </div>

    {isLoading ? (
      <div className="flex h-64 items-center justify-center text-sm text-ink-3">Loading funnel data…</div>
    ) : (
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="card border-line-strong p-4">
          <FunnelChart title="Lead Stage Funnel" description="Contacts by lifecycle stage" data={funnels?.leadStage} />
        </div>
        <div className="card border-line-strong p-4">
          <FunnelChart title="Lead → Deal Conversion" description="Leads that became a deal" data={funnels?.leadToDeal} />
        </div>
        <div className="card border-line-strong p-4">
          <FunnelChart title="Deal Stage Funnel" description="Deals by pipeline stage" data={funnels?.dealStage} />
        </div>
      </div>
    )}
  </div>
)

/**
 * One dashboard per tenant — generic, not split by CRM. Every connected data
 * source (QuickBooks, HubSpot, Salesforce) contributes to one combined entity
 * count, one combined sync control, and one flat metric grid. Some metrics
 * are still computed per-provider under the hood (CM-03/04/05/06/07/08 —
 * pipeline/funnel data genuinely differs per CRM, stage names can't be
 * blended, see crm-integrations skill), so those show as separate cards when
 * more than one CRM is connected, disambiguated in the title only — there's
 * no section/heading grouping them by provider.
 */
export const CrmDashboardPage: React.FC = () => {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const { organization } = useAuthContext()
  const { data: integrationsStatus, isLoading: isStatusLoading } = useIntegrationsStatus()
  const [syncError, setSyncError] = useState<string | null>(null)
  const [isFunnelsOpen, setIsFunnelsOpen] = useState(true)
  const [activeFunnelsProvider, setActiveFunnelsProvider] = useState<'hubspot' | 'salesforce'>('hubspot')
  const [hubspotPipelineFilter, setHubspotPipelineFilter] = useState('')
  const [salesforcePipelineFilter, setSalesforcePipelineFilter] = useState('')
  const [hubspotProductFilter, setHubspotProductFilter] = useState('')
  const [salesforceProductFilter, setSalesforceProductFilter] = useState('')
  const [quickbooksProductFilter, setQuickbooksProductFilter] = useState('')
  const [quickbooksFromYear, setQuickbooksFromYear] = useState('2018')
  const [quickbooksLocationFilter, setQuickbooksLocationFilter] = useState('')
  const [quickbooksStateFilter, setQuickbooksStateFilter] = useState('')
  const [quickbooksRevenueViewMode, setQuickbooksRevenueViewMode] = useState<'percentage' | 'absolute'>('percentage')
  const [quickbooksRevenueProductFilter, setQuickbooksRevenueProductFilter] = useState('')
  const [hubspotFromDate, setHubspotFromDate] = useState('')
  const [hubspotToDate, setHubspotToDate] = useState('')
  const [salesforceFromDate, setSalesforceFromDate] = useState('')
  const [salesforceToDate, setSalesforceToDate] = useState('')

  useEffect(() => {
    if (searchParams.get('status') === 'success') {
      searchParams.delete('status')
      setSearchParams(searchParams, { replace: true })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const hubspotSync = useSyncStatus('hubspot')
  const salesforceSync = useSyncStatus('salesforce')
  const quickbooksSync = useSyncStatus('quickbooks')

  const isHubspotSettled = !hubspotSync.data || hubspotSync.data.status === 'completed' || hubspotSync.data.status === 'failed'
  const isSalesforceSettled = !salesforceSync.data || salesforceSync.data.status === 'completed' || salesforceSync.data.status === 'failed'
  const isQuickbooksSettled = !quickbooksSync.data || quickbooksSync.data.status === 'completed' || quickbooksSync.data.status === 'failed'

  const hubspotCounts = useEntityCounts('hubspot', !isStatusLoading && isHubspotSettled)
  const salesforceCounts = useEntityCounts('salesforce', !isStatusLoading && isSalesforceSettled)
  const quickbooksCounts = useEntityCounts('quickbooks', !isStatusLoading && isQuickbooksSettled)

  const hubspotStartSync = useStartSync('hubspot')
  const salesforceStartSync = useStartSync('salesforce')
  const quickbooksStartSync = useStartSync('quickbooks')

  const isHubspotConnected = !!integrationsStatus?.hubspot?.connected
  const isSalesforceConnected = !!integrationsStatus?.salesforce?.connected
  const isQuickbooksConnected = !!integrationsStatus?.quickbooks?.connected

  const hubspotHasData = (hubspotCounts.data?.contacts ?? 0) > 0 || (hubspotCounts.data?.deals ?? 0) > 0
  const salesforceHasData = (salesforceCounts.data?.contacts ?? 0) > 0 || (salesforceCounts.data?.deals ?? 0) > 0
  const quickbooksHasData = (quickbooksCounts.data?.customers ?? 0) > 0 || (quickbooksCounts.data?.invoices ?? 0) > 0

  const isHubspotVisible = isHubspotConnected || hubspotHasData
  const isSalesforceVisible = isSalesforceConnected || salesforceHasData
  const isQuickbooksVisible = isQuickbooksConnected || quickbooksHasData
  const bothCrmsVisible = isHubspotVisible && isSalesforceVisible

  // Keep the active funnels tab pointed at a CRM that's actually connected —
  // relevant if only Salesforce is connected, or HubSpot gets disconnected later.
  useEffect(() => {
    if (activeFunnelsProvider === 'hubspot' && !isHubspotVisible && isSalesforceVisible) {
      setActiveFunnelsProvider('salesforce')
    } else if (activeFunnelsProvider === 'salesforce' && !isSalesforceVisible && isHubspotVisible) {
      setActiveFunnelsProvider('hubspot')
    }
  }, [activeFunnelsProvider, isHubspotVisible, isSalesforceVisible])

  const isDeterminingVisibility =
    isStatusLoading || hubspotCounts.isLoading || salesforceCounts.isLoading || quickbooksCounts.isLoading
  const nothingConnectedYet = !isDeterminingVisibility && !isHubspotVisible && !isSalesforceVisible && !isQuickbooksVisible
  const hasNeverSynced = !isDeterminingVisibility && !nothingConnectedYet && !hubspotSync.data && !salesforceSync.data && !quickbooksSync.data

  const anyDisconnectedWithData =
    (!isHubspotConnected && hubspotHasData) || (!isSalesforceConnected && salesforceHasData) || (!isQuickbooksConnected && quickbooksHasData)

  const activeSyncJobs = [hubspotSync.data, salesforceSync.data, quickbooksSync.data].filter(
    (job): job is NonNullable<typeof job> => !!job && (job.status === 'pending' || job.status === 'running' || job.status === 'failed')
  )
  const handleSyncAll = async () => {
    setSyncError(null)
    try {
      await Promise.all([
        isHubspotConnected ? hubspotStartSync.mutateAsync() : null,
        isSalesforceConnected ? salesforceStartSync.mutateAsync() : null,
        isQuickbooksConnected ? quickbooksStartSync.mutateAsync() : null
      ])
    } catch (err: any) {
      setSyncError(err?.response?.data?.error?.message || 'Could not start sync')
    }
  }

  const combinedContacts = (hubspotCounts.data?.contacts ?? 0) + (salesforceCounts.data?.contacts ?? 0)
  const combinedDeals = (hubspotCounts.data?.deals ?? 0) + (salesforceCounts.data?.deals ?? 0)

  const quickbooksMetricsEnabled = isQuickbooksVisible && isQuickbooksSettled
  const { data: quickbooksProducts } = useProducts('quickbooks', quickbooksMetricsEnabled)
  const quickbooksItemFilter = quickbooksProductFilter || undefined
  // Guards against sending a partial/invalid year while the user is still typing —
  // the backend rejects anything that isn't exactly 4 digits (metrics.validator.ts).
  const quickbooksFromYearParam = /^\d{4}$/.test(quickbooksFromYear) ? quickbooksFromYear : undefined
  const quickbooksProductName = quickbooksProducts?.find((p) => p.id === quickbooksProductFilter)?.name
  const quickbooksTitleSuffix = quickbooksProductName ? ` — ${quickbooksProductName}` : ''
  const { data: quickbooksDepartments } = useQuickBooksDepartments(quickbooksMetricsEnabled)
  const { data: quickbooksCustomerStates } = useQuickBooksCustomerStates(quickbooksMetricsEnabled)
  const productRevenueGrowth = useProductRevenueGrowth()
  const handleLoadProductRevenueGrowth = () => {
    productRevenueGrowth.mutate(
      { fromYear: quickbooksFromYearParam, department: quickbooksLocationFilter || undefined, state: quickbooksStateFilter || undefined },
      { onSuccess: () => setQuickbooksRevenueProductFilter('') }
    )
  }

  // "Revenue growth by product" (docs/server.js §5) — lives inside VC-13's own card
  // (below its YoY trend), not a separate card, per-product/location/billing-state
  // filters plus the percentage/absolute view toggle.
  const productRevenueGrowthSection = (
    <div className="mt-4 border-t border-line pt-3">
      <p className="text-xs font-semibold text-ink">Revenue growth by product</p>
      <p className="mt-0.5 text-xs text-ink-3">Month-over-month, one product at a time or all together — uses the "From year" setting above.</p>

      <div className="mt-2 flex flex-col gap-2">
        <button
          type="button"
          className="btn-primary w-auto self-start px-3 py-1.5 text-xs"
          onClick={handleLoadProductRevenueGrowth}
          disabled={productRevenueGrowth.isPending}
        >
          {productRevenueGrowth.isPending ? 'Loading…' : 'Load Product Revenue Growth'}
        </button>

        <div className="flex flex-wrap gap-2">
          <select
            className="form-input-dark w-auto text-xs"
            value={quickbooksRevenueProductFilter}
            onChange={(e) => setQuickbooksRevenueProductFilter(e.target.value)}
            disabled={!productRevenueGrowth.data?.products.length}
            aria-label="Product"
          >
            <option value="">All products</option>
            {(productRevenueGrowth.data?.products ?? []).map((product) => (
              <option key={product.id} value={product.id}>
                {product.name}
              </option>
            ))}
          </select>

          {quickbooksDepartments && quickbooksDepartments.length > 0 && (
            <select className="form-input-dark w-auto text-xs" value={quickbooksLocationFilter} onChange={(e) => setQuickbooksLocationFilter(e.target.value)} aria-label="Location">
              <option value="">All locations</option>
              {quickbooksDepartments.map((department) => (
                <option key={department.id} value={department.id}>
                  {department.name}
                </option>
              ))}
            </select>
          )}

          {quickbooksCustomerStates && quickbooksCustomerStates.length > 0 && (
            <select className="form-input-dark w-auto text-xs" value={quickbooksStateFilter} onChange={(e) => setQuickbooksStateFilter(e.target.value)} aria-label="Billing state">
              <option value="">All states</option>
              {quickbooksCustomerStates.map((state) => (
                <option key={state} value={state}>
                  {state}
                </option>
              ))}
            </select>
          )}
        </div>

        <div className="flex items-center gap-3 text-xs text-ink-2">
          <label className="flex items-center gap-1.5">
            <input type="radio" name="quickbooksRevenueViewMode" checked={quickbooksRevenueViewMode === 'percentage'} onChange={() => setQuickbooksRevenueViewMode('percentage')} />
            Percentage
          </label>
          <label className="flex items-center gap-1.5">
            <input type="radio" name="quickbooksRevenueViewMode" checked={quickbooksRevenueViewMode === 'absolute'} onChange={() => setQuickbooksRevenueViewMode('absolute')} />
            Absolute revenue
          </label>
        </div>
      </div>

      <p className="mt-2 text-xs text-ink-3">
        {productRevenueGrowth.isPending
          ? 'Loading revenue growth per product... this runs one report per product and can take a while.'
          : productRevenueGrowth.isError
            ? 'Could not load product revenue growth.'
            : productRevenueGrowth.data
              ? productRevenueGrowth.data.message ??
                `${productRevenueGrowth.data.products.length} product(s) loaded.${
                  productRevenueGrowth.data.failedProducts.length
                    ? ` ${productRevenueGrowth.data.failedProducts.length} product(s) skipped: ${productRevenueGrowth.data.failedProducts
                        .map((p) => `${p.name} (${p.message})`)
                        .join('; ')}`
                    : ''
                }`
              : ''}
      </p>

      {productRevenueGrowth.data && productRevenueGrowth.data.products.length > 0 && (
        <div className="mt-2">
          <ProductRevenueGrowthChart
            products={productRevenueGrowth.data.products}
            selectedProductId={quickbooksRevenueProductFilter}
            viewMode={quickbooksRevenueViewMode}
          />
        </div>
      )}
    </div>
  )
  const { data: vc01, isLoading: isVc01Loading } = useMetric('vc-01', quickbooksMetricsEnabled)
  const { data: vc02, isLoading: isVc02Loading } = useMetric('vc-02', quickbooksMetricsEnabled)
  const { data: vc03, isLoading: isVc03Loading } = useMetric('vc-03', quickbooksMetricsEnabled)
  const { data: vc04, isLoading: isVc04Loading } = useMetric('vc-04', quickbooksMetricsEnabled, undefined, quickbooksItemFilter)
  const { data: vc06, isLoading: isVc06Loading } = useMetric('vc-06', quickbooksMetricsEnabled)
  const { data: vc07, isLoading: isVc07Loading } = useMetric('vc-07', quickbooksMetricsEnabled)
  const { data: vc09, isLoading: isVc09Loading } = useMetric('vc-09', quickbooksMetricsEnabled, undefined, quickbooksItemFilter)
  const { data: vc10, isLoading: isVc10Loading } = useMetric('vc-10', quickbooksMetricsEnabled, undefined, quickbooksItemFilter)
  const { data: vc04Trend, isLoading: isVc04TrendLoading } = useMetricTrend('vc-04', quickbooksMetricsEnabled, quickbooksItemFilter, quickbooksFromYearParam)
  const { data: vc09Trend, isLoading: isVc09TrendLoading } = useMetricTrend('vc-09', quickbooksMetricsEnabled, quickbooksItemFilter, quickbooksFromYearParam)
  const { data: vc10Trend, isLoading: isVc10TrendLoading } = useMetricTrend('vc-10', quickbooksMetricsEnabled, quickbooksItemFilter, quickbooksFromYearParam)
  const { data: vc12, isLoading: isVc12Loading } = useMetric('vc-12', quickbooksMetricsEnabled)
  const { data: vc13, isLoading: isVc13Loading } = useMetric('vc-13', quickbooksMetricsEnabled, undefined, quickbooksItemFilter)
  const { data: vc13Trend, isLoading: isVc13TrendLoading } = useMetricTrend('vc-13', quickbooksMetricsEnabled, quickbooksItemFilter, quickbooksFromYearParam)
  const { data: vc14, isLoading: isVc14Loading } = useMetric('vc-14', quickbooksMetricsEnabled)
  const { data: cb05, isLoading: isCb05Loading } = useMetric('cb-05', quickbooksMetricsEnabled)
  const { data: cb07, isLoading: isCb07Loading } = useMetric('cb-07', quickbooksMetricsEnabled)
  const { data: cb10, isLoading: isCb10Loading } = useMetric('cb-10', quickbooksMetricsEnabled)
  const { data: cm02, isLoading: isCm02Loading } = useMetric('cm-02', quickbooksMetricsEnabled)

  const hubspotMetricsEnabled = isHubspotVisible && isHubspotSettled
  const salesforceMetricsEnabled = isSalesforceVisible && isSalesforceSettled
  const { data: cm04Hubspot, isLoading: isCm04HubspotLoading } = useMetric('cm-04', hubspotMetricsEnabled, 'hubspot')
  const { data: cm06Hubspot, isLoading: isCm06HubspotLoading } = useMetric('cm-06', hubspotMetricsEnabled, 'hubspot')
  const { data: cm08Hubspot, isLoading: isCm08HubspotLoading } = useMetric('cm-08', hubspotMetricsEnabled, 'hubspot')
  const { data: cm05, isLoading: isCm05Loading } = useMetric('cm-05', hubspotMetricsEnabled)
  const { data: cm07, isLoading: isCm07Loading } = useMetric('cm-07', hubspotMetricsEnabled)

  const { data: cm04Salesforce, isLoading: isCm04SalesforceLoading } = useMetric('cm-04', salesforceMetricsEnabled, 'salesforce')
  const { data: cm06Salesforce, isLoading: isCm06SalesforceLoading } = useMetric('cm-06', salesforceMetricsEnabled, 'salesforce')
  const { data: cm08Salesforce, isLoading: isCm08SalesforceLoading } = useMetric('cm-08', salesforceMetricsEnabled, 'salesforce')
  const { data: cm03, isLoading: isCm03Loading } = useMetric('cm-03', salesforceMetricsEnabled)

  const { data: hubspotPipelines } = usePipelines('hubspot', hubspotMetricsEnabled)
  const { data: salesforcePipelines } = usePipelines('salesforce', salesforceMetricsEnabled)
  const { data: hubspotProducts } = useProducts('hubspot', hubspotMetricsEnabled)
  const { data: salesforceProducts } = useProducts('salesforce', salesforceMetricsEnabled)

  // Funnel stage order needs one concrete pipeline — default to the first
  // once pipelines load, rather than leaving "all pipelines" selected.
  useEffect(() => {
    if (!hubspotPipelineFilter && hubspotPipelines && hubspotPipelines.length > 0) {
      setHubspotPipelineFilter(hubspotPipelines[0])
    }
  }, [hubspotPipelines, hubspotPipelineFilter])
  useEffect(() => {
    if (!salesforcePipelineFilter && salesforcePipelines && salesforcePipelines.length > 0) {
      setSalesforcePipelineFilter(salesforcePipelines[0])
    }
  }, [salesforcePipelines, salesforcePipelineFilter])

  const { data: hubspotFunnels, isLoading: isHubspotFunnelsLoading } = useFunnels(
    organization?.id ?? '',
    'hubspot',
    {
      pipeline: hubspotPipelineFilter || undefined,
      from: hubspotFromDate || undefined,
      to: hubspotToDate || undefined,
      productId: hubspotProductFilter || undefined
    },
    hubspotMetricsEnabled && !!organization
  )
  const { data: salesforceFunnels, isLoading: isSalesforceFunnelsLoading } = useFunnels(
    organization?.id ?? '',
    'salesforce',
    {
      pipeline: salesforcePipelineFilter || undefined,
      from: salesforceFromDate || undefined,
      to: salesforceToDate || undefined,
      productId: salesforceProductFilter || undefined
    },
    salesforceMetricsEnabled && !!organization
  )

  const suffix = (label: string) => (bothCrmsVisible ? ` (${label})` : '')

  if (isDeterminingVisibility) {
    return (
      <AppShell title="Dashboard" subtitle="Contacts, deals, and financial insights across your connected data sources">
        <p className="text-sm text-ink-3">Loading…</p>
      </AppShell>
    )
  }

  if (nothingConnectedYet) {
    return (
      <AppShell title="Dashboard" subtitle="Contacts, deals, and financial insights across your connected data sources">
        <div className="card flex flex-col items-center justify-center border-dashed p-12 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-brand/15 text-brand">
            <Link2 className="h-6 w-6" />
          </div>
          <h3 className="mt-4 text-lg font-semibold text-ink">No data source connected yet</h3>
          <p className="mt-2 max-w-sm text-sm text-ink-2">
            Connect HubSpot, Salesforce, or QuickBooks to start syncing your contacts, deals, and financial data.
          </p>
          <button type="button" className="btn-primary mt-6 w-auto px-6 py-2" onClick={() => navigate('/connect')}>
            Connect a data source
          </button>
        </div>
      </AppShell>
    )
  }

  return (
    <AppShell title="Dashboard" subtitle="Contacts, deals, and financial insights across your connected data sources">
      {syncError && <Banner variant="error" message={syncError} onDismiss={() => setSyncError(null)} />}

      {anyDisconnectedWithData && (
        <Banner
          variant="warning"
          message="One of your connections is no longer active — showing the last synced data. Reconnect to resume syncing."
          action={{ label: 'Reconnect', onClick: () => navigate('/connect') }}
        />
      )}

      <h2 className="text-lg font-semibold text-ink">Overview</h2>

      {hasNeverSynced ? (
        <div className="card flex flex-col items-center justify-center border-dashed p-12 text-center">
          <h3 className="text-lg font-semibold text-ink">No data synced yet</h3>
          <p className="mt-2 text-sm text-ink-2">Start your first sync to see contacts, deals, and financial metrics.</p>
          <button type="button" className="btn-primary mt-6 w-auto px-6 py-2" onClick={handleSyncAll}>
            Start Sync
          </button>
        </div>
      ) : (
        <>
          {activeSyncJobs.map((job, i) => (
            <SyncProgressBanner key={i} job={job} />
          ))}

          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {(isHubspotVisible || isSalesforceVisible) && (
              <>
                <StatsCard title="Contacts" value={combinedContacts} description="Total contacts synced" icon={<Users className="h-5 w-5" />} accent="brand" />
                <StatsCard title="Deals" value={combinedDeals} description="Total deals synced" icon={<Briefcase className="h-5 w-5" />} accent="violet" />
              </>
            )}
            {isQuickbooksVisible && (
              <>
                <StatsCard
                  title="Customers"
                  value={quickbooksCounts.data?.customers ?? 0}
                  description="Total billing customers synced"
                  icon={<Users className="h-5 w-5" />}
                  accent="teal"
                />
                <StatsCard
                  title="Invoices"
                  value={quickbooksCounts.data?.invoices ?? 0}
                  description="Total invoices synced"
                  icon={<FileText className="h-5 w-5" />}
                  accent="success"
                />
              </>
            )}
          </div>

          {(isHubspotVisible || isSalesforceVisible) && (
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
                  {bothCrmsVisible && (
                    <div className="flex rounded-lg bg-surface-3 p-1">
                      {(['hubspot', 'salesforce'] as const).map((p) => (
                        <button
                          key={p}
                          type="button"
                          onClick={() => setActiveFunnelsProvider(p)}
                          className={`rounded-md px-3 py-1 text-sm font-medium transition-colors ${
                            activeFunnelsProvider === p ? 'bg-surface-1 text-ink shadow-sm' : 'text-ink-2 hover:text-ink'
                          }`}
                        >
                          {PROVIDER_LABELS[p]}
                        </button>
                      ))}
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={() => setIsFunnelsOpen((open) => !open)}
                    aria-label={isFunnelsOpen ? 'Collapse funnels' : 'Expand funnels'}
                    aria-expanded={isFunnelsOpen}
                    className="rounded-full p-2 text-ink-2 transition-colors duration-150 hover:bg-surface-3 hover:text-ink"
                  >
                    <ChevronDown className={`h-6 w-6 transition-transform duration-300 ease-in-out ${isFunnelsOpen ? '' : '-rotate-90'}`} />
                  </button>
                </div>
              </div>

              <div className={`grid transition-[grid-template-rows] duration-300 ease-in-out ${isFunnelsOpen ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}>
                <div className="overflow-hidden">
                  <div className={`pt-6 transition-opacity duration-300 ${isFunnelsOpen ? 'opacity-100 delay-100' : 'opacity-0'}`}>
                    {activeFunnelsProvider === 'hubspot' ? (
                      <FunnelsBody
                        pipelines={hubspotPipelines}
                        pipelineFilter={hubspotPipelineFilter}
                        onPipelineFilterChange={setHubspotPipelineFilter}
                        products={hubspotProducts}
                        productFilter={hubspotProductFilter}
                        onProductFilterChange={setHubspotProductFilter}
                        funnels={hubspotFunnels}
                        isLoading={isHubspotFunnelsLoading}
                        fromDate={hubspotFromDate}
                        toDate={hubspotToDate}
                        onDateChange={({ from, to }) => {
                          setHubspotFromDate(from ?? '')
                          setHubspotToDate(to ?? '')
                        }}
                      />
                    ) : (
                      <FunnelsBody
                        pipelines={salesforcePipelines}
                        pipelineFilter={salesforcePipelineFilter}
                        onPipelineFilterChange={setSalesforcePipelineFilter}
                        products={salesforceProducts}
                        productFilter={salesforceProductFilter}
                        onProductFilterChange={setSalesforceProductFilter}
                        funnels={salesforceFunnels}
                        isLoading={isSalesforceFunnelsLoading}
                        fromDate={salesforceFromDate}
                        toDate={salesforceToDate}
                        onDateChange={({ from, to }) => {
                          setSalesforceFromDate(from ?? '')
                          setSalesforceToDate(to ?? '')
                        }}
                      />
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {isQuickbooksVisible && (
            <div className="flex flex-wrap items-center justify-end gap-3">
              <label className="flex items-center gap-2 text-sm text-ink-2">
                From year
                <input
                  type="number"
                  min={2000}
                  max={2100}
                  step={1}
                  className="form-input-dark w-24"
                  value={quickbooksFromYear}
                  onChange={(e) => setQuickbooksFromYear(e.target.value)}
                  aria-label="Trend charts start year"
                />
              </label>
              {quickbooksProducts && quickbooksProducts.length > 0 && (
                <select
                  className="form-input-dark w-auto"
                  value={quickbooksProductFilter}
                  onChange={(e) => setQuickbooksProductFilter(e.target.value)}
                  aria-label="Filter COGS %, G&A %, EBITDA margin %, and Revenue growth % by product"
                >
                  <option value="">All products</option>
                  {quickbooksProducts.map((product) => (
                    <option key={product.id} value={product.id}>
                      {product.name}
                    </option>
                  ))}
                </select>
              )}
            </div>
          )}

          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {isQuickbooksVisible && (
              <>
                <MetricCard id="VC-01" title="Gross Revenue Retention" description="Of the recurring revenue you started the period with, how much you kept" icon={<RefreshCcw className="h-5 w-5" />} metric={vc01} isLoading={isVc01Loading} />
                <MetricCard id="VC-02" title="Net Revenue Retention" description="Same as GRR, but upsells count — can exceed 100%" icon={<TrendingDown className="h-5 w-5" />} metric={vc02} isLoading={isVc02Loading} />
                <MetricCard id="VC-03" title="New-Logo Revenue Growth" description="Growth of revenue from brand-new customers" icon={<Rocket className="h-5 w-5" />} metric={vc03} isLoading={isVc03Loading} />
                <MetricCard
                  id="VC-04"
                  title={`COGS %${quickbooksTitleSuffix}`}
                  description="Direct delivery cost as a share of revenue"
                  icon={<PieChart className="h-5 w-5" />}
                  metric={vc04}
                  isLoading={isVc04Loading}
                  trend={<MetricTrendChart embedded title="COGS %" description="" color="var(--color-brand)" points={vc04Trend?.points ?? []} isLoading={isVc04TrendLoading} />}
                  trendPoints={vc04Trend?.points}
                />
                <MetricCard
                  id="VC-09"
                  title={`G&A % of Revenue${quickbooksTitleSuffix}`}
                  description="Back-office cost as a share of revenue"
                  icon={<Wallet className="h-5 w-5" />}
                  metric={vc09}
                  isLoading={isVc09Loading}
                  trend={<MetricTrendChart embedded title="G&A %" description="" color="var(--color-violet)" points={vc09Trend?.points ?? []} isLoading={isVc09TrendLoading} />}
                  trendPoints={vc09Trend?.points}
                />
                <MetricCard
                  id="VC-10"
                  title={`EBITDA Margin${quickbooksTitleSuffix}`}
                  description="EBITDA as a share of revenue"
                  icon={<BarChart3 className="h-5 w-5" />}
                  metric={vc10}
                  isLoading={isVc10Loading}
                  trend={<MetricTrendChart embedded title="EBITDA Margin %" description="" color="var(--color-teal)" points={vc10Trend?.points ?? []} isLoading={isVc10TrendLoading} />}
                  trendPoints={vc10Trend?.points}
                />
                <MetricCard
                  id="VC-06"
                  title="CAC Payback"
                  description="Months to earn back the cost of winning a new customer"
                  icon={<Target className="h-5 w-5" />}
                  metric={vc06}
                  isLoading={isVc06Loading}
                  extras={
                    vc06
                      ? [
                          ...(vc06.data.cac != null ? [{ label: 'CAC', value: `$${Number(vc06.data.cac).toLocaleString()}` }] : []),
                          ...(vc06.data.ltvCacRatio != null ? [{ label: 'LTV:CAC', value: `${Number(vc06.data.ltvCacRatio).toFixed(2)}x` }] : [])
                        ]
                      : undefined
                  }
                />
                <MetricCard id="VC-07" title="LTV:CAC (New)" description="Lifetime value vs. acquisition cost, new customers" icon={<Gauge className="h-5 w-5" />} metric={vc07} isLoading={isVc07Loading} />
                <MetricCard id="VC-14" title="LTV:CAC (Whole Base)" description="Lifetime value vs. acquisition cost, entire active base" icon={<Gauge className="h-5 w-5" />} metric={vc14} isLoading={isVc14Loading} />
                <MetricCard id="VC-12" title="Recurring Revenue %" description="Share of revenue that's contractually recurring" icon={<Repeat className="h-5 w-5" />} metric={vc12} isLoading={isVc12Loading} />
                <MetricCard
                  id="VC-13"
                  title={`Revenue Growth (YoY)${quickbooksTitleSuffix}`}
                  description="Total revenue growth, recurring vs. non-recurring"
                  icon={<LineChart className="h-5 w-5" />}
                  metric={vc13}
                  isLoading={isVc13Loading}
                  trend={
                    <>
                      <MetricTrendChart embedded title="Revenue Growth %" description="" color="var(--color-success)" points={vc13Trend?.points ?? []} isLoading={isVc13TrendLoading} />
                      {productRevenueGrowthSection}
                    </>
                  }
                  trendPoints={vc13Trend?.points}
                />
                <MetricCard id="CB-05" title="Cash & Runway" description="Unrestricted cash on hand and months of runway" icon={<Banknote className="h-5 w-5" />} metric={cb05} isLoading={isCb05Loading} />
                <MetricCard id="CB-07" title="FCF Conversion" description="Share of EBITDA that converts to free cash flow" icon={<Droplets className="h-5 w-5" />} metric={cb07} isLoading={isCb07Loading} />
                <MetricCard id="CB-10" title="Cash Conversion Cycle" description="Days cash is tied up in the operating cycle" icon={<RefreshCw className="h-5 w-5" />} metric={cb10} isLoading={isCb10Loading} />
                <MetricCard id="CM-02" title="Customer Concentration" description="Share of trailing-12-month revenue from the top 10 customers" icon={<Building2 className="h-5 w-5" />} metric={cm02} isLoading={isCm02Loading} />
              </>
            )}

            {isHubspotVisible && (
              <>
                <MetricCard id="CM-04" title={`Pipeline Coverage${suffix('HubSpot')}`} description="Qualified pipeline closing next quarter vs. target" icon={<Target className="h-5 w-5" />} metric={cm04Hubspot} isLoading={isCm04HubspotLoading} />
                <MetricCard id="CM-06" title={`Funnel Conversion (MQL -> SQL)${suffix('HubSpot')}`} description="Cohort-based stage-to-stage advancement" icon={<Users className="h-5 w-5" />} metric={cm06Hubspot} isLoading={isCm06HubspotLoading} />
                <MetricCard id="CM-08" title={`MQL Volume${suffix('HubSpot')}`} description="Marketing-qualified leads generated this period" icon={<LineChart className="h-5 w-5" />} metric={cm08Hubspot} isLoading={isCm08HubspotLoading} />
                <MetricCard id="CM-05" title="Marketing-Sourced Pipeline & Revenue" description="Share of qualified pipeline and closed revenue attributed to marketing" icon={<PieChart className="h-5 w-5" />} metric={cm05} isLoading={isCm05Loading} />
                <MetricCard id="CM-07" title="Marketing ROI" description="Blended pipeline and profit return per dollar of marketing spend" icon={<Gauge className="h-5 w-5" />} metric={cm07} isLoading={isCm07Loading} />
              </>
            )}

            {isSalesforceVisible && (
              <>
                <MetricCard id="CM-04" title={`Pipeline Coverage${suffix('Salesforce')}`} description="Qualified pipeline closing next quarter vs. target" icon={<Target className="h-5 w-5" />} metric={cm04Salesforce} isLoading={isCm04SalesforceLoading} />
                <MetricCard id="CM-06" title={`Funnel Conversion (MQL -> SQL)${suffix('Salesforce')}`} description="Cohort-based stage-to-stage advancement" icon={<Users className="h-5 w-5" />} metric={cm06Salesforce} isLoading={isCm06SalesforceLoading} />
                <MetricCard id="CM-08" title={`MQL Volume${suffix('Salesforce')}`} description="Marketing-qualified leads generated this period" icon={<LineChart className="h-5 w-5" />} metric={cm08Salesforce} isLoading={isCm08SalesforceLoading} />
                <MetricCard id="CM-03" title="Competitive Win Rate" description="Blended win rate vs. named competitors (configure in Settings)" icon={<Swords className="h-5 w-5" />} metric={cm03} isLoading={isCm03Loading} />
              </>
            )}
          </div>
        </>
      )}
    </AppShell>
  )
}
