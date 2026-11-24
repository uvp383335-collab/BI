import { getLeadToMqlTrend, getMqlToSqlTrend } from '../../metrics/service/cmMetrics.service'
import { getInvoiceRevenueGrowthByProduct, getInvoiceRevenueGrowthByClass, getInvoiceRevenueGrowthByState } from '../../metrics/service/productRevenueGrowth.service'
import { getCustomerUpgradesTrend } from '../../metrics/service/customerUpgradesTrend.service'
import { getGAndAExpenseTrend } from '../../metrics/service/gaExpenseTrend.service'
import { getRecurringRevenueTrend } from '../../metrics/service/recurringRevenueTrend.service'
import { getNewCustomersTrend } from '../../metrics/service/newCustomersTrend.service'
import { getCACTrend } from '../../metrics/service/cacTrend.service'
import { getQualifiedPipelineTrend } from '../../metrics/service/qualifiedPipelineTrend.service'
import { getCampaignWonOpportunities } from '../../metrics/service/campaignWonOpportunities.service'
import { getCampaignRoi } from '../../metrics/service/campaignRoi.service'
import { getLeadsByMonthByCampaign } from '../../metrics/service/leadsByMonth.service'
import { getOpportunitiesByLeadSource } from '../../metrics/service/opportunitiesByLeadSource.service'
import { getOpportunitiesByLeadSourceByMonth } from '../../metrics/service/opportunitiesByLeadSourceByMonth.service'
import { getCustomerRevenueConcentration } from '../../metrics/service/customerRevenueConcentration.service'
import { getCustomerRevenueConcentrationByMonth } from '../../metrics/service/customerRevenueConcentrationByMonth.service'
import { getCompetitorWinRate } from '../../metrics/service/competitorWinRate.service'
import { getLeadVolumeVsTarget } from '../../metrics/service/leadVolumeVsTarget.service'
import { latestClosedMonth, shiftMonth } from '../../metrics/service/revenueRollForward.service'
import { funnelService } from '../../sync/service/funnel.service'
import { analyticsService } from '../../sync/service/analytics.service'

/** How many completed months of history an analysis covers, ending at the last closed month. */
export const ANALYSIS_WINDOW_MONTHS = 24

/** Long lists (campaigns, customers) are cut to this many rows, with the rest rolled into one total, to keep the prompt small. */
const MAX_LIST_ROWS = 25

export interface AnalysisWindow {
  /** Inclusive "YYYY-MM". */
  from: string
  /** Inclusive "YYYY-MM" — the last fully closed month. */
  to: string
}

export interface ChartDataContext {
  orgId: string
  window: AnalysisWindow
}

export interface ChartDataDefinition {
  /** Fills `{{chartTitle}}` in the prompt template; the prompt document's own title is used for display. */
  title: string
  /**
   * Loads the chart's data for the analysis. Always the overall view: every
   * product-, pipeline-, department- and state-level dashboard filter is
   * deliberately left unset here, so the report covers all products
   * regardless of what the user has selected on the chart. Returns
   * aggregates only — customer and contact names are never sent to the model.
   */
  load: (ctx: ChartDataContext) => Promise<unknown>
  /**
   * What period the loaded data actually covers, for charts that don't use
   * the standard analysis window (all-time totals, a fixed trailing year).
   * Fills `{{window}}` in the prompt and the "Covers …" line in the UI.
   * Defaults to "<from> to <to>" of the analysis window.
   */
  coverage?: (window: AnalysisWindow) => string
}

const ALL_TIME = () => 'All time'

/** "<from> to <to>" of the analysis window, or the chart's own coverage when it differs. */
export function describeCoverage(definition: ChartDataDefinition, window: AnalysisWindow): string {
  return definition.coverage ? definition.coverage(window) : `${window.from} to ${window.to}`
}

export function currentAnalysisWindow(): AnalysisWindow {
  const to = latestClosedMonth()
  return { from: shiftMonth(to, -(ANALYSIS_WINDOW_MONTHS - 1)), to }
}

function inWindow(period: string, window: AnalysisWindow): boolean {
  // "YYYY", "YYYY-MM" and "YYYY-MM-DD" all compare correctly against "YYYY-MM" bounds by prefix.
  const month = period.slice(0, 7)
  return month >= window.from && month <= window.to
}

function windowDates(window: AnalysisWindow): { from: Date; to: Date } {
  const [toYear, toMonth] = window.to.split('-').map(Number)
  return {
    from: new Date(`${window.from}-01T00:00:00.000Z`),
    // Day 0 of the following month is the last day of `to`'s month.
    to: new Date(Date.UTC(toYear, toMonth, 0, 23, 59, 59, 999))
  }
}

/** Keeps the top rows by `weight` and sums the rest into a single `others` total. */
const round2 = (n: number) => Math.round(n * 100) / 100

/** Sums `pick` over rows. Totals are precomputed for the model so it never has to add up long lists itself. */
function total<T>(rows: T[], pick: (row: T) => number | null | undefined): number {
  return round2(rows.reduce((sum, row) => sum + (pick(row) ?? 0), 0))
}

function topRows<T>(rows: T[], weight: (row: T) => number): { rows: T[]; othersCount: number; othersTotal: number } {
  const sorted = [...rows].sort((a, b) => weight(b) - weight(a))
  const rest = sorted.slice(MAX_LIST_ROWS)
  return { rows: sorted.slice(0, MAX_LIST_ROWS), othersCount: rest.length, othersTotal: rest.reduce((sum, row) => sum + weight(row), 0) }
}

async function loadCustomerMovement(orgId: string, window: AnalysisWindow) {
  const result = await getCustomerUpgradesTrend(orgId, undefined, 'monthly')
  return { hasData: result.hasData, points: result.points.filter((p) => inWindow(p.period, window)) }
}

async function loadRecurringRevenue(orgId: string, window: AnalysisWindow) {
  const result = await getRecurringRevenueTrend(orgId, 'monthly')
  return {
    hasCategorizedProducts: result.hasCategorizedProducts,
    points: result.points
      .filter((p) => inWindow(p.period, window))
      .map((p) => {
        const total = p.recurringRevenue + p.nonRecurringRevenue
        return { ...p, recurringSharePct: total > 0 ? Math.round((p.recurringRevenue / total) * 1000) / 10 : null }
      })
  }
}

async function loadFunnels(orgId: string, provider: string, window: AnalysisWindow) {
  return funnelService.getFunnels(orgId, provider, windowDates(window))
}

/** Deal stages can't be blended across pipelines, so the deal funnel is loaded once per pipeline instead of picking one. */
async function loadDealStageFunnels(orgId: string, provider: string, window: AnalysisWindow) {
  const pipelines: string[] = await analyticsService.getPipelines(orgId, provider)
  const funnels = await Promise.all(pipelines.map((pipeline) => funnelService.getFunnels(orgId, provider, { pipeline, ...windowDates(window) })))
  return { pipelines: funnels.map((f) => f.dealStage) }
}

function funnelDefinitions(provider: 'hubspot' | 'salesforce', label: string) {
  return {
    [`${provider}-lead-stage-funnel`]: {
      title: `Lead Stage Funnel (${label})`,
      load: async ({ orgId, window }: ChartDataContext) => ({ leadStage: (await loadFunnels(orgId, provider, window)).leadStage })
    },
    [`${provider}-lead-to-deal-funnel`]: {
      title: `Lead → Deal Conversion (${label})`,
      load: async ({ orgId, window }: ChartDataContext) => ({ leadToDeal: (await loadFunnels(orgId, provider, window)).leadToDeal })
    },
    [`${provider}-deal-stage-funnel`]: {
      title: `Deal Stage Funnel (${label}, every pipeline)`,
      load: ({ orgId, window }: ChartDataContext) => loadDealStageFunnels(orgId, provider, window)
    }
  } as Record<`${typeof provider}-${'lead-stage' | 'lead-to-deal' | 'deal-stage'}-funnel`, ChartDataDefinition>
}

export const CHART_DATA_REGISTRY = {
  ...funnelDefinitions('hubspot', 'HubSpot'),
  ...funnelDefinitions('salesforce', 'Salesforce'),

  'lead-to-mql-trend': {
    title: 'Lead → MQL Conversion Rate (monthly cohorts)',
    load: async ({ orgId, window }) => {
      const result = await getLeadToMqlTrend(orgId, 'hubspot', 'monthly', window.from, window.to)
      return { granularity: result.granularity, points: result.points }
    }
  },

  'mql-to-sql-trend': {
    title: 'MQL → SQL Conversion Rate (monthly cohorts)',
    load: async ({ orgId, window }) => {
      const result = await getMqlToSqlTrend(orgId, 'hubspot', 'monthly', window.from, window.to)
      return { granularity: result.granularity, points: result.points }
    }
  },

  'ga-expense-trend': {
    title: 'G&A % of Revenue (monthly)',
    load: async ({ orgId, window }) => {
      const result = await getGAndAExpenseTrend(orgId, 'monthly')
      return { hasConfiguredAccounts: result.hasConfiguredAccounts, points: result.points.filter((p) => inWindow(p.period, window)) }
    }
  },

  'recurring-revenue-trend': {
    title: 'Recurring vs. non-recurring revenue (monthly)',
    load: ({ orgId, window }) => loadRecurringRevenue(orgId, window)
  },

  'recurring-revenue-share': {
    title: 'Recurring revenue % of total (monthly)',
    load: ({ orgId, window }) => loadRecurringRevenue(orgId, window)
  },

  'invoice-revenue-growth-by-product': {
    title: 'Revenue growth by product (from synced invoices)',
    load: async ({ orgId, window }) => {
      const result = await getInvoiceRevenueGrowthByProduct(orgId, { fromYear: window.from.slice(0, 4) })
      const products = result.products
        .map((product) => ({ name: product.name, months: product.months.filter((m) => inWindow(m.month, window)) }))
        // Products with no revenue anywhere in the window add tokens and nothing to analyze.
        .filter((product) => product.months.some((m) => m.revenue !== 0))
      return { products }
    }
  },

  'invoice-revenue-growth-by-class': {
    title: 'Revenue growth by class (from synced invoices)',
    load: async ({ orgId, window }) => {
      const result = await getInvoiceRevenueGrowthByClass(orgId, { fromYear: window.from.slice(0, 4) })
      const classes = result.classes
        .map((cls) => ({ name: cls.name, months: cls.months.filter((m) => inWindow(m.month, window)) }))
        .filter((cls) => cls.months.some((m) => m.revenue !== 0))
      return { classes }
    }
  },

  'invoice-revenue-growth-by-state': {
    title: 'Revenue growth by location (billing state, all products)',
    load: async ({ orgId, window }) => {
      const result = await getInvoiceRevenueGrowthByState(orgId, { fromYear: window.from.slice(0, 4) })
      const states = result.states
        .map((state) => ({ state: state.name, months: state.months.filter((m) => inWindow(m.month, window)) }))
        .filter((state) => state.months.some((m) => m.revenue !== 0))
      return { states }
    }
  },

  'new-customers-trend': {
    title: 'New customers (all products, monthly)',
    load: async ({ orgId, window }) => {
      const result = await getNewCustomersTrend(orgId, window.from.slice(0, 4), undefined)
      return { hasInvoices: result.hasInvoices, points: result.points.filter((p) => inWindow(p.month, window)) }
    }
  },

  'cac-trend': {
    title: 'Customer Acquisition Cost',
    load: async ({ orgId, window }) => {
      const result = await getCACTrend(orgId)
      return { hasConfiguredSettings: result.hasConfiguredSettings, points: result.points.filter((p) => inWindow(p.periodEnd, window)) }
    }
  },

  'customer-upgrades-trend': {
    title: 'Customer upgrades — all recurring products, monthly',
    load: async ({ orgId, window }) => {
      const { hasData, points } = await loadCustomerMovement(orgId, window)
      return { hasData, points: points.map((p) => ({ period: p.period, upgradeCount: p.upgradeCount, upgradeAmount: p.upgradeAmount, startingRevenue: p.startingRevenue })) }
    }
  },

  'customer-downgrades-trend': {
    title: 'Customer downgrades — all recurring products, monthly',
    load: async ({ orgId, window }) => {
      const { hasData, points } = await loadCustomerMovement(orgId, window)
      return { hasData, points: points.map((p) => ({ period: p.period, downgradeCount: p.downgradeCount, downgradeAmount: p.downgradeAmount, startingRevenue: p.startingRevenue })) }
    }
  },

  'customer-churn-trend': {
    title: 'Customer churn — all recurring products, monthly',
    load: async ({ orgId, window }) => {
      const { hasData, points } = await loadCustomerMovement(orgId, window)
      return {
        hasData,
        points: points.map((p) => ({ period: p.period, churnCount: p.churnCount, churnAmount: p.churnAmount, startingRevenue: p.startingRevenue, grrPct: p.grrPct }))
      }
    }
  },

  'customer-retention-trend': {
    title: 'Customer retention (GRR/NRR) — all recurring products, monthly',
    load: ({ orgId, window }) => loadCustomerMovement(orgId, window)
  },

  'qualified-pipeline-trend': {
    title: 'Pipeline Coverage Ratio (monthly, HubSpot)',
    load: ({ orgId, window }) => getQualifiedPipelineTrend(orgId, 'hubspot', window.from, window.to)
  },

  'campaign-won-opportunities': {
    title: 'Opportunities Won by Campaign (all time, Salesforce)',
    coverage: ALL_TIME,
    load: async ({ orgId }) => {
      const result = await getCampaignWonOpportunities(orgId)
      const top = topRows(result.rows, (row) => row.wonAmount)
      return {
        campaignCount: result.rows.length,
        totalWonAmount: total(result.rows, (row) => row.wonAmount),
        totalWonCount: total(result.rows, (row) => row.wonCount),
        listedCampaignsWonAmount: total(top.rows, (row) => row.wonAmount),
        listedCampaignsWonCount: total(top.rows, (row) => row.wonCount),
        campaigns: top.rows.map((row) => ({ campaign: row.campaignName, wonCount: row.wonCount, wonAmount: row.wonAmount })),
        otherCampaignsCount: top.othersCount,
        otherCampaignsWonAmount: top.othersTotal
      }
    }
  },

  'campaign-roi': {
    title: 'Campaign ROI (all time, Salesforce)',
    coverage: ALL_TIME,
    load: async ({ orgId }) => {
      const result = await getCampaignRoi(orgId)
      const top = topRows(result.rows, (row) => row.wonAmount)
      const listedWon = total(top.rows, (row) => row.wonAmount)
      const listedCost = total(top.rows, (row) => row.actualCost)
      return {
        campaignCount: result.rows.length,
        totalWonAmount: total(result.rows, (row) => row.wonAmount),
        listedCampaignsWonAmount: listedWon,
        listedCampaignsActualCost: listedCost,
        // Won amount per unit of cost across the listed campaigns (same definition as each row's `roi`).
        listedCampaignsBlendedRoi: listedCost > 0 ? round2(listedWon / listedCost) : null,
        campaigns: top.rows.map((row) => ({ campaign: row.campaignName, wonAmount: row.wonAmount, actualCost: row.actualCost, roi: row.roi })),
        otherCampaignsCount: top.othersCount,
        otherCampaignsWonAmount: top.othersTotal
      }
    }
  },

  'leads-by-month-by-campaign': {
    title: 'Leads by Month, per campaign (Salesforce)',
    load: async ({ orgId, window }) => {
      const result = await getLeadsByMonthByCampaign(orgId)
      const campaigns = result.campaigns
        .map((c) => ({ campaign: c.campaignName, series: c.series.filter((p) => inWindow(p.month, window) && p.count > 0) }))
        .filter((c) => c.series.length > 0)
      const top = topRows(campaigns, (c) => c.series.reduce((sum, p) => sum + p.count, 0))
      return { campaigns: top.rows, otherCampaignsCount: top.othersCount, otherCampaignsLeadCount: top.othersTotal }
    }
  },

  'opportunities-by-lead-source': {
    title: 'Opportunities by Lead Source (all time, Salesforce)',
    coverage: ALL_TIME,
    load: async ({ orgId }) => {
      const result = await getOpportunitiesByLeadSource(orgId)
      const known = result.rows.filter((row) => row.leadSource !== 'Unknown')
      return { totalOpportunities: total(result.rows, (row) => row.count), knownSourceOpportunities: total(known, (row) => row.count), rows: result.rows }
    }
  },

  'opportunities-by-lead-source-by-month': {
    title: 'Opportunities by Lead Source by Month (Salesforce)',
    load: async ({ orgId, window }) => {
      const result = await getOpportunitiesByLeadSourceByMonth(orgId, 'monthly')
      return {
        leadSources: result.leadSources
          .map((s) => ({ leadSource: s.leadSource, series: s.series.filter((p) => inWindow(p.periodStart, window) && p.count > 0) }))
          .filter((s) => s.series.length > 0)
      }
    }
  },

  'customer-revenue-concentration': {
    title: 'Customer Concentration (all time, all products)',
    coverage: ALL_TIME,
    load: async ({ orgId }) => {
      const result = await getCustomerRevenueConcentration(orgId, undefined)
      const top = topRows(result.rows, (row) => row.revenue)
      return {
        totalRevenue: result.totalRevenue,
        top10Pct: result.top10Pct,
        customerCount: result.rows.length,
        // Ranked, unnamed — customer names stay out of the prompt.
        topCustomers: top.rows.map((row, index) => ({ rank: index + 1, revenue: row.revenue, pctOfTotal: row.pctOfTotal })),
        otherCustomersRevenue: top.othersTotal
      }
    }
  },

  'customer-revenue-concentration-by-month': {
    title: 'Customer Concentration by quarter (all products)',
    // Quarterly: the service's trailing window is 8 quarters, which matches the 24-month analysis window.
    load: ({ orgId }) => getCustomerRevenueConcentrationByMonth(orgId, undefined, 'quarterly')
  },

  'competitor-win-rate': {
    title: 'Competitor Win Rate (all time, Salesforce)',
    coverage: ALL_TIME,
    load: ({ orgId }) => getCompetitorWinRate(orgId)
  },

  'lead-volume-vs-target-mql': {
    title: 'Lead Volume vs. Target MQL (monthly, HubSpot)',
    // The chart itself always shows a trailing 12 months, not the 24-month analysis window.
    coverage: (window) => `${shiftMonth(window.to, -11)} to ${window.to}`,
    load: async ({ orgId, window }) => {
      const result = await getLeadVolumeVsTarget(orgId)
      return {
        points: result.points.filter((p) => inWindow(p.month, window)),
        missingTargetMonths: result.missingTargetMonths.filter((m) => inWindow(m, window))
      }
    }
  }
} satisfies Record<string, ChartDataDefinition>

export type AnalysisChartKey = keyof typeof CHART_DATA_REGISTRY

export const ANALYSIS_CHART_KEYS = Object.keys(CHART_DATA_REGISTRY) as [AnalysisChartKey, ...AnalysisChartKey[]]
