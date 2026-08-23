import { MetricFlag, MetricResult } from '../metrics.types'
import { invoiceRepository } from '../../sync/repository/invoice.repository'
import { quickBooksCustomerRepository } from '../../sync/repository/quickBooksCustomer.repository'
import { dealRepository } from '../../sync/repository/deal.repository'
import { contactRepository } from '../../sync/repository/contact.repository'
import { pipelineStageDefinitionRepository } from '../../sync/repository/pipelineStageDefinition.repository'
import { funnelStageEventRepository } from '../../sync/repository/funnelStageEvent.repository'
import { organizationsRepository } from '../../organizations/repository/organizations.repository'
import { CONTACTS_PIPELINE } from '../../sync/service/sync.service'
import { getStoredProfitAndLoss, StoredQuarterSnapshot } from './plReport.service'
import { sumExpensesByCategory } from './plParser'
import { grossMarginFromPL } from './plMetrics.service'
import { latestClosedMonth, shiftMonth, monthToDateRange, quarterStartOf, quarterToDateRange, latestClosedQuarterStart } from './revenueRollForward.service'

/**
 * CM-02 — Customer Concentration (Top-10 Revenue %). Grouping uses
 * QuickBooks `Customer.ParentRef` (already synced in Phase 1) as the
 * subsidiary signal — the metrics guide names this and Salesforce
 * `Account.ParentId` as the two available signals for this, and QuickBooks'
 * own hierarchy needs no fuzzy name-matching to a separate Salesforce
 * Account record, so it's the primary (and, for now, only) signal used.
 * Cross-referencing Salesforce's `Account.ParentId` (now synced — Phase 4)
 * for QuickBooks customers with no native parent is a real enhancement but
 * isn't built yet — tracked in the progress doc.
 */

const round1 = (n: number): number => Math.round(n * 10) / 10
const round2 = (n: number): number => Math.round(n * 100) / 100
const QUICKBOOKS_PROVIDER = 'quickbooks'

interface CustomerGroupRevenue {
  rootId: string
  label: string
  revenue: number
}

async function getTrailingTwelveMonthRevenueByGroup(
  orgId: string,
  endMonth: string
): Promise<{ groups: CustomerGroupRevenue[]; totalRevenue: number }> {
  const startMonth = shiftMonth(endMonth, -11)
  const from = new Date(monthToDateRange(startMonth).startDate)
  const to = new Date(monthToDateRange(endMonth).endDate)

  const [rows, customers] = await Promise.all([
    invoiceRepository.getMonthlyRevenueByCustomer(orgId, QUICKBOOKS_PROVIDER, from, to),
    quickBooksCustomerRepository.findAll(orgId, QUICKBOOKS_PROVIDER)
  ])

  const parentById = new Map(customers.map((c) => [c.providerRecordId, c.parentRecordId]))
  const nameById = new Map(customers.map((c) => [c.providerRecordId, c.displayName ?? c.providerRecordId]))

  function resolveRootId(customerId: string): string {
    const visited = new Set<string>()
    let current = customerId
    for (;;) {
      const parent = parentById.get(current)
      if (!parent || visited.has(current)) return current
      visited.add(current)
      current = parent
    }
  }

  const revenueByCustomer = new Map<string, number>()
  for (const row of rows) {
    revenueByCustomer.set(row.customerRecordId, (revenueByCustomer.get(row.customerRecordId) ?? 0) + row.revenue)
  }

  const revenueByRoot = new Map<string, number>()
  for (const [customerId, revenue] of revenueByCustomer) {
    const rootId = resolveRootId(customerId)
    revenueByRoot.set(rootId, (revenueByRoot.get(rootId) ?? 0) + revenue)
  }

  const groups: CustomerGroupRevenue[] = Array.from(revenueByRoot.entries())
    .map(([rootId, revenue]) => ({ rootId, label: nameById.get(rootId) ?? rootId, revenue }))
    .sort((a, b) => b.revenue - a.revenue)

  const totalRevenue = groups.reduce((sum, g) => sum + g.revenue, 0)
  return { groups, totalRevenue }
}

function topNPct(groups: CustomerGroupRevenue[], n: number, total: number): number {
  return total > 0 ? (groups.slice(0, n).reduce((sum, g) => sum + g.revenue, 0) / total) * 100 : 0
}

export async function computeCM02(orgId: string, period?: string): Promise<MetricResult> {
  const endMonth = period ?? latestClosedMonth()
  const yearAgoEndMonth = shiftMonth(endMonth, -12)

  const [current, yearAgo] = await Promise.all([
    getTrailingTwelveMonthRevenueByGroup(orgId, endMonth),
    getTrailingTwelveMonthRevenueByGroup(orgId, yearAgoEndMonth)
  ])

  if (current.totalRevenue <= 0) {
    return {
      id: 'CM-02',
      period: endMonth,
      computable: false,
      value: null,
      unit: 'percent',
      data: { snapshotAvailable: false },
      flag: null,
      asOf: new Date().toISOString()
    }
  }

  const top10Pct = topNPct(current.groups, 10, current.totalRevenue)
  const top5Pct = topNPct(current.groups, 5, current.totalRevenue)
  const top1Pct = current.groups.length > 0 ? (current.groups[0].revenue / current.totalRevenue) * 100 : 0
  const yearAgoTop10Pct = yearAgo.totalRevenue > 0 ? topNPct(yearAgo.groups, 10, yearAgo.totalRevenue) : null

  const singleCustomerOver20 = top1Pct > 20
  const top10Over60 = top10Pct > 60
  const top10Over40 = top10Pct > 40
  const risenOver3pts = yearAgoTop10Pct !== null && top10Pct - yearAgoTop10Pct > 3

  let flag: MetricFlag | null = null
  if (top10Over60 || singleCustomerOver20) {
    flag = {
      level: 'act_now',
      reason: top10Over60
        ? `Top 10 customers are ${top10Pct.toFixed(1)}% of trailing-12-month revenue, above the 60% ceiling.`
        : `${current.groups[0].label} alone is ${top1Pct.toFixed(1)}% of trailing-12-month revenue, above the 20% single-customer ceiling.`
    }
  } else if (top10Over40 || risenOver3pts) {
    flag = {
      level: 'watch',
      reason: top10Over40
        ? `Top 10 customers are ${top10Pct.toFixed(1)}% of trailing-12-month revenue, above the 40% comfort level.`
        : `Top-10 concentration rose ${(top10Pct - yearAgoTop10Pct!).toFixed(1)} points over the past year, to ${top10Pct.toFixed(1)}%.`
    }
  }

  return {
    id: 'CM-02',
    period: endMonth,
    computable: true,
    value: round1(top10Pct),
    unit: 'percent',
    data: {
      top10Pct: round1(top10Pct),
      top5Pct: round1(top5Pct),
      top1Pct: round1(top1Pct),
      totalRevenue: round1(current.totalRevenue),
      customerGroupCount: current.groups.length,
      yearAgoTop10Pct: yearAgoTop10Pct !== null ? round1(yearAgoTop10Pct) : null,
      topCustomers: current.groups.slice(0, 10).map((g) => ({
        label: g.label,
        revenue: round1(g.revenue),
        pct: round1((g.revenue / current.totalRevenue) * 100)
      }))
    },
    flag,
    asOf: new Date().toISOString()
  }
}

function notComputable(id: string, period: string, unit: MetricResult['unit']): MetricResult {
  return { id, period, computable: false, value: null, unit, data: { snapshotAvailable: false }, flag: null, asOf: new Date().toISOString() }
}

/**
 * Qualified-stage-cutoff heuristic (metrics guide gap G-7, no per-org config
 * yet — see G-22): within each open pipeline, the lowest-displayOrder open
 * stage is treated as the unqualified intake stage; every other open stage
 * counts as "qualified." Closed stages (won or lost) never count as
 * pipeline. Shared by CM-04 and CM-05, which both need "is this deal in a
 * qualified stage" — keyed `${pipeline}::${rawStage}` for O(1) lookup.
 */
function resolveQualifiedStageKeys(stageDefs: { entityType: string; pipeline: string; rawStage: string; displayOrder: number; isClosed: boolean }[]): Set<string> {
  const dealDefs = stageDefs.filter((d) => d.entityType === 'deal')
  const qualifiedKeys = new Set<string>()
  const pipelineGroups = new Map<string, typeof dealDefs>()
  for (const def of dealDefs) {
    if (def.isClosed) continue
    const list = pipelineGroups.get(def.pipeline) ?? []
    list.push(def)
    pipelineGroups.set(def.pipeline, list)
  }
  for (const [pipeline, defs] of pipelineGroups) {
    const sorted = [...defs].sort((a, b) => a.displayOrder - b.displayOrder)
    for (const def of sorted.slice(1)) {
      qualifiedKeys.add(`${pipeline}::${def.rawStage}`)
    }
  }
  return qualifiedKeys
}

// ---------------------------------------------------------------------------
// CM-04 — Pipeline Coverage Ratio
// ---------------------------------------------------------------------------

/**
 * Coverage's denominator ("next quarter's new-business target") is
 * operating-plan data this MVP doesn't have at all (gap G-14) — not a
 * missing-comparison-period situation like most other metrics' plan legs,
 * a structurally missing input to the ratio itself. So `computable` is
 * always `false` here; what *is* real and returned is the numerator
 * (qualified pipeline closing next quarter) plus the qualified-stage-cutoff
 * work the metrics guide calls out as CM-04's actual gap (G-7) — this
 * metric lights up the moment an operating-plan feature exists, no
 * qualified-pipeline logic needs to change.
 */
export async function computeCM04(orgId: string, provider: string, period?: string): Promise<MetricResult> {
  const month = period ?? latestClosedMonth()
  const quarterStart = quarterStartOf(month)
  const nextQuarterStart = shiftMonth(quarterStart, 3)
  const range = quarterToDateRange(nextQuarterStart)

  const [deals, stageDefs] = await Promise.all([
    dealRepository.findByCloseDateRange(orgId, provider, new Date(range.startDate), new Date(`${range.endDate}T23:59:59.999Z`)),
    pipelineStageDefinitionRepository.findAllForOrg(orgId, provider)
  ])

  const qualifiedKeys = resolveQualifiedStageKeys(stageDefs)
  const qualifiedDeals = deals.filter((d) => d.pipeline && d.dealstage && qualifiedKeys.has(`${d.pipeline}::${d.dealstage}`))
  const qualifiedPipelineAmount = qualifiedDeals.reduce((sum, d) => sum + (d.amount ?? 0), 0)

  return {
    id: 'CM-04',
    period: nextQuarterStart,
    computable: false,
    value: null,
    unit: 'multiple',
    data: {
      qualifiedPipelineAmount: round1(qualifiedPipelineAmount),
      qualifiedDealCount: qualifiedDeals.length,
      nextQuarterTarget: null,
      blockedOn: 'operating-plan-input'
    },
    flag: null,
    asOf: new Date().toISOString()
  }
}

// ---------------------------------------------------------------------------
// CM-06 — Funnel Conversion Rates (Lead -> MQL -> SQL -> Won)
// ---------------------------------------------------------------------------

/**
 * The funnel-role mapping (metrics guide gap G-7) that CM-06/CM-08 both
 * need — which `lifecyclestage` values count as MQL/SQL/Won. HubSpot's
 * lifecycle stage is a standard, largely non-customizable enum (unlike
 * Salesforce Opportunity stages, which are always company-specific), so a
 * fixed default mapped straight from HubSpot's own value names is a safe
 * MVP default — see G-22 for the "not per-org configurable" caveat this
 * shares with G-13's chart-of-accounts heuristic.
 */
const LEAD_STAGE = 'lead'
const MQL_STAGE = 'marketingqualifiedlead'
const SQL_STAGE = 'salesqualifiedlead'
const WON_STAGE = 'customer'
const MIN_COHORT_LEADS = 100
const MIN_COHORT_MQLS = 30

interface CohortRates {
  leadCount: number
  mqlCount: number
  sqlCount: number
  wonCount: number
  leadToMql: number | null
  mqlToSql: number | null
  sqlToWon: number | null
}

async function computeCohortRates(orgId: string, provider: string, cohortMonth: string): Promise<CohortRates | null> {
  const { startDate, endDate } = monthToDateRange(cohortMonth)
  const recordIds = await funnelStageEventRepository.getCohortRecordIds(orgId, provider, 'lead', {
    from: new Date(startDate),
    to: new Date(`${endDate}T23:59:59.999Z`)
  })
  if (recordIds.length === 0) return null

  const stageCounts = await funnelStageEventRepository.getStageMembershipCounts(orgId, provider, 'lead', CONTACTS_PIPELINE, recordIds)
  const countFor = (stage: string) => stageCounts.find((s) => s.rawStage === stage)?.count ?? 0

  const leadCount = countFor(LEAD_STAGE)
  const mqlCount = countFor(MQL_STAGE)
  const sqlCount = countFor(SQL_STAGE)
  const wonCount = countFor(WON_STAGE)

  return {
    leadCount,
    mqlCount,
    sqlCount,
    wonCount,
    leadToMql: leadCount > 0 ? (mqlCount / leadCount) * 100 : null,
    mqlToSql: mqlCount > 0 ? (sqlCount / mqlCount) * 100 : null,
    sqlToWon: sqlCount > 0 ? (wonCount / sqlCount) * 100 : null
  }
}

const TRAILING_AVERAGE_WINDOW_MONTHS = 4

interface TrailingAverageRates {
  leadToMql: number | null
  mqlToSql: number | null
  sqlToWon: number | null
}

/**
 * Doc: "down >20% vs. trailing 4-quarter average" / "falls below half its
 * trailing average" — the flag baseline is a smoothed multi-period average,
 * not a single prior data point (found during manual validation: the code
 * previously compared against just the immediately-prior cohort month,
 * which is far noisier and more prone to a false-positive single-month
 * wobble). CM-06 operates at monthly-cohort grain, so this reads "trailing
 * 4 quarters" as its natural monthly analog: the trailing 4 monthly
 * cohorts, not 4 literal calendar quarters (12+ months back). Averages only
 * over cohorts that actually have data for that leg — a thin or missing
 * month doesn't drag the average toward zero.
 */
async function computeTrailingAverageRates(orgId: string, provider: string, cohortMonth: string): Promise<TrailingAverageRates> {
  const months = Array.from({ length: TRAILING_AVERAGE_WINDOW_MONTHS }, (_, i) => shiftMonth(cohortMonth, -(i + 1)))
  const cohorts = await Promise.all(months.map((m) => computeCohortRates(orgId, provider, m)))

  const average = (key: 'leadToMql' | 'mqlToSql' | 'sqlToWon'): number | null => {
    const values = cohorts.filter((c): c is CohortRates => c !== null).map((c) => c[key]).filter((v): v is number => v !== null)
    return values.length > 0 ? values.reduce((sum, v) => sum + v, 0) / values.length : null
  }

  return { leadToMql: average('leadToMql'), mqlToSql: average('mqlToSql'), sqlToWon: average('sqlToWon') }
}

export async function computeCM06(orgId: string, provider = 'hubspot', period?: string): Promise<MetricResult> {
  // A 2-month maturation buffer before a cohort's rates are treated as final
  // (the metrics guide asks for "a stage-appropriate maturation window";
  // exact quarter-scale windows per stage aren't modeled — see G-22).
  const cohortMonth = period ?? shiftMonth(latestClosedMonth(), -2)

  const [current, trailingAvg] = await Promise.all([
    computeCohortRates(orgId, provider, cohortMonth),
    computeTrailingAverageRates(orgId, provider, cohortMonth)
  ])
  if (!current) return notComputable('CM-06', cohortMonth, 'percent')

  const cohortSizeSufficient = current.leadCount >= MIN_COHORT_LEADS && current.mqlCount >= MIN_COHORT_MQLS

  let flag: MetricFlag | null = null
  if (cohortSizeSufficient) {
    const declinedOver20Pct = (curr: number | null, prior: number | null) => curr !== null && prior !== null && curr < prior * 0.8
    const mqlToSqlBelowHalf = current.mqlToSql !== null && trailingAvg.mqlToSql !== null && current.mqlToSql < trailingAvg.mqlToSql / 2
    const leadMqlDown = declinedOver20Pct(current.leadToMql, trailingAvg.leadToMql)
    const mqlSqlDown = declinedOver20Pct(current.mqlToSql, trailingAvg.mqlToSql)
    const sqlWonDown = declinedOver20Pct(current.sqlToWon, trailingAvg.sqlToWon)
    const twoAdjacentDown = (leadMqlDown && mqlSqlDown) || (mqlSqlDown && sqlWonDown)

    if (mqlToSqlBelowHalf) {
      flag = {
        level: 'act_now',
        reason: `MQL -> SQL fell to ${current.mqlToSql!.toFixed(1)}%, below half its trailing 4-month average (${trailingAvg.mqlToSql!.toFixed(1)}%) — sales is rejecting marketing's leads.`
      }
    } else if (twoAdjacentDown) {
      flag = { level: 'act_now', reason: 'Two adjacent funnel stages deteriorated vs. their trailing 4-month average.' }
    } else if (leadMqlDown || mqlSqlDown || sqlWonDown) {
      flag = { level: 'watch', reason: "A funnel stage's conversion rate fell more than 20% versus its trailing 4-month average." }
    }
  }

  return {
    id: 'CM-06',
    period: cohortMonth,
    computable: current.mqlToSql !== null,
    value: current.mqlToSql !== null ? round1(current.mqlToSql) : null,
    unit: 'percent',
    data: {
      leadToMqlPct: current.leadToMql !== null ? round1(current.leadToMql) : null,
      mqlToSqlPct: current.mqlToSql !== null ? round1(current.mqlToSql) : null,
      sqlToWonPct: current.sqlToWon !== null ? round1(current.sqlToWon) : null,
      leadCount: current.leadCount,
      mqlCount: current.mqlCount,
      sqlCount: current.sqlCount,
      wonCount: current.wonCount,
      trailingAvgMqlToSqlPct: trailingAvg.mqlToSql !== null ? round1(trailingAvg.mqlToSql) : null,
      cohortSizeSufficient
    },
    flag: cohortSizeSufficient ? flag : null,
    asOf: new Date().toISOString()
  }
}

// ---------------------------------------------------------------------------
// CM-08 — Lead Volume vs. Plan (MQL Flow)
// ---------------------------------------------------------------------------

export async function computeCM08(orgId: string, provider = 'hubspot', period?: string): Promise<MetricResult> {
  const month = period ?? latestClosedMonth()
  const previousMonth = shiftMonth(month, -1)
  const twoAgoMonth = shiftMonth(month, -2)

  const counts = await Promise.all(
    [month, previousMonth, twoAgoMonth].map((m) => {
      const { startDate, endDate } = monthToDateRange(m)
      return funnelStageEventRepository.countRecordsEnteringStage(orgId, provider, 'lead', MQL_STAGE, {
        from: new Date(startDate),
        to: new Date(`${endDate}T23:59:59.999Z`)
      })
    })
  )
  const [current, previous, twoAgo] = counts

  const growthPct = previous > 0 ? ((current - previous) / previous) * 100 : null
  const decliningTwoMonthsRunning = current < previous && previous < twoAgo

  // The plan-relative legs (>15%/>25% below plan) need operating-plan data
  // this MVP doesn't have (gap G-14). "Declining two months running" and
  // "falling while CM-06 is also deteriorating" are both plan-independent —
  // computed here for real, not stubbed out.
  //
  // These are two separate doc-worded legs, not one condition gating the other:
  // watch needs a genuine two-month streak; act-now only needs a plain single-month
  // fall paired with CM-06 also deteriorating (no "two months running" in that leg's
  // wording) — so a one-month drop alongside a red CM-06 must still escalate even
  // when there wasn't yet a second down month.
  const fallingThisMonth = current < previous
  let flag: MetricFlag | null = null
  if (decliningTwoMonthsRunning || fallingThisMonth) {
    const cm06 = await computeCM06(orgId, provider)
    if (cm06.flag !== null) {
      flag = {
        level: 'act_now',
        reason: decliningTwoMonthsRunning
          ? `MQL volume has declined two months running (${twoAgo} -> ${previous} -> ${current}) while funnel conversion (CM-06) is also deteriorating.`
          : `MQL volume fell to ${current} (from ${previous}) while funnel conversion (CM-06) is also deteriorating.`
      }
    } else if (decliningTwoMonthsRunning) {
      flag = { level: 'watch', reason: `MQL volume has declined two months running: ${twoAgo} -> ${previous} -> ${current}.` }
    }
  }

  return {
    id: 'CM-08',
    period: month,
    computable: true,
    value: current,
    unit: 'count',
    data: {
      mqlCount: current,
      previousMonthMqlCount: previous,
      twoMonthsAgoMqlCount: twoAgo,
      growthPct: growthPct !== null ? round1(growthPct) : null,
      benchmarkAvailable: false
    },
    flag,
    asOf: new Date().toISOString()
  }
}

// ---------------------------------------------------------------------------
// CM-05 — Marketing-Sourced Pipeline & Revenue %
// ---------------------------------------------------------------------------

/**
 * "Marketing-originated" per the metrics guide: the deal's original source
 * in HubSpot is a marketing channel (organic/paid search, email, social,
 * campaigns) as opposed to sales outbound/partners/referrals/direct. First-
 * touch only (not multi-touch — the guide allows either but says never mix
 * the two in one trend line; this MVP picks first-touch and doesn't expose
 * a toggle). Values are HubSpot's own fixed `hs_analytics_source` enum
 * (confirmed live against a connected portal — see the crm-integrations skill).
 */
const HUBSPOT = 'hubspot'
const MARKETING_SOURCES = new Set(['ORGANIC_SEARCH', 'PAID_SEARCH', 'EMAIL_MARKETING', 'SOCIAL_MEDIA', 'PAID_SOCIAL', 'OTHER_CAMPAIGNS', 'AI_REFERRALS'])
const UNSOURCED_HOLDBACK_SHARE = 0.25

interface AttributionTotals {
  totalPipeline: number
  marketingPipeline: number
  totalRevenue: number
  marketingRevenue: number
  unsourcedPipelineShare: number | null
}

async function computeAttributionTotals(orgId: string, endMonth: string): Promise<AttributionTotals> {
  const startMonth = shiftMonth(endMonth, -11)
  const from = new Date(monthToDateRange(startMonth).startDate)
  const to = new Date(`${monthToDateRange(endMonth).endDate}T23:59:59.999Z`)

  const [createdDeals, closedDeals, contacts, stageDefs] = await Promise.all([
    dealRepository.findByCreateDateRange(orgId, HUBSPOT, from, to),
    dealRepository.findByCloseDateRange(orgId, HUBSPOT, from, to),
    contactRepository.findSourcesByProvider(orgId, HUBSPOT),
    pipelineStageDefinitionRepository.findAllForOrg(orgId, HUBSPOT)
  ])

  const qualifiedKeys = resolveQualifiedStageKeys(stageDefs)
  const wonKeys = new Set(stageDefs.filter((d) => d.entityType === 'deal' && d.isWon).map((d) => `${d.pipeline}::${d.rawStage}`))
  const sourceByContact = new Map(contacts.map((c) => [c.providerRecordId, c.analyticsSource]))

  // First-touch proxy: the first associated contact with a resolvable source.
  const sourceForDeal = (contactIds: string[]): string | undefined => {
    for (const id of contactIds) {
      const source = sourceByContact.get(id)
      if (source) return source
    }
    return undefined
  }

  let totalPipeline = 0
  let marketingPipeline = 0
  let unsourcedPipeline = 0
  for (const deal of createdDeals) {
    if (!deal.pipeline || !deal.dealstage || !qualifiedKeys.has(`${deal.pipeline}::${deal.dealstage}`)) continue
    const amount = deal.amount ?? 0
    totalPipeline += amount
    const source = sourceForDeal(deal.contactIds ?? [])
    if (!source) unsourcedPipeline += amount
    else if (MARKETING_SOURCES.has(source)) marketingPipeline += amount
  }

  let totalRevenue = 0
  let marketingRevenue = 0
  for (const deal of closedDeals) {
    if (!deal.pipeline || !deal.dealstage || !wonKeys.has(`${deal.pipeline}::${deal.dealstage}`)) continue
    const amount = deal.amount ?? 0
    totalRevenue += amount
    const source = sourceForDeal(deal.contactIds ?? [])
    if (source && MARKETING_SOURCES.has(source)) marketingRevenue += amount
  }

  return {
    totalPipeline,
    marketingPipeline,
    totalRevenue,
    marketingRevenue,
    unsourcedPipelineShare: totalPipeline > 0 ? unsourcedPipeline / totalPipeline : null
  }
}

export async function computeCM05(orgId: string, period?: string): Promise<MetricResult> {
  const endMonth = period ?? latestClosedMonth()
  const prevEndMonth = shiftMonth(endMonth, -3)
  const twoAgoEndMonth = shiftMonth(endMonth, -6)

  const [current, previous, twoAgo] = await Promise.all([
    computeAttributionTotals(orgId, endMonth),
    computeAttributionTotals(orgId, prevEndMonth),
    computeAttributionTotals(orgId, twoAgoEndMonth)
  ])

  if (current.totalPipeline <= 0) return notComputable('CM-05', endMonth, 'percent')

  const pipelinePct = (current.marketingPipeline / current.totalPipeline) * 100
  const revenuePct = current.totalRevenue > 0 ? (current.marketingRevenue / current.totalRevenue) * 100 : null

  // Honest-numbers data-quality gate: the metrics guide holds alerts back
  // when more than a quarter of qualified pipeline has no resolvable source.
  const dataQualityOk = current.unsourcedPipelineShare === null || current.unsourcedPipelineShare < UNSOURCED_HOLDBACK_SHARE

  const prevPipelinePct = previous.totalPipeline > 0 ? (previous.marketingPipeline / previous.totalPipeline) * 100 : null
  const twoAgoPipelinePct = twoAgo.totalPipeline > 0 ? (twoAgo.marketingPipeline / twoAgo.totalPipeline) * 100 : null

  let flag: MetricFlag | null = null
  if (dataQualityOk) {
    const fallingTwoQuarters = prevPipelinePct !== null && twoAgoPipelinePct !== null && pipelinePct < prevPipelinePct && prevPipelinePct < twoAgoPipelinePct
    const belowTarget = pipelinePct < 30
    if (fallingTwoQuarters || belowTarget) {
      flag = {
        level: 'watch',
        reason: fallingTwoQuarters
          ? `Marketing-sourced pipeline share has fallen two quarters running, to ${pipelinePct.toFixed(1)}%.`
          : `Marketing-sourced pipeline is ${pipelinePct.toFixed(1)}%, below the 30% target.`
      }
    }
  }
  // Act-now needs pipeline coverage (CM-04) also below target — CM-04's own target is unavailable
  // (operating-plan data, gap G-14), so that cross-check can't fire, same dependency shape as G-19.

  return {
    id: 'CM-05',
    period: endMonth,
    computable: true,
    value: round1(pipelinePct),
    unit: 'percent',
    data: {
      pipelinePct: round1(pipelinePct),
      revenuePct: revenuePct !== null ? round1(revenuePct) : null,
      marketingQualifiedPipeline: round1(current.marketingPipeline),
      totalQualifiedPipeline: round1(current.totalPipeline),
      marketingRevenue: round1(current.marketingRevenue),
      totalRevenue: round1(current.totalRevenue),
      unsourcedPipelineSharePct: current.unsourcedPipelineShare !== null ? round1(current.unsourcedPipelineShare * 100) : null,
      dataQualityOk
    },
    flag: dataQualityOk ? flag : null,
    asOf: new Date().toISOString()
  }
}

// ---------------------------------------------------------------------------
// CM-07 — Marketing ROI by Channel (blended only — see G-16b)
// ---------------------------------------------------------------------------

/**
 * Per-channel figures need HubSpot Campaigns API cost data (a genuinely new
 * integration surface, gap G-9) plus ad-platform spend (permanently out of
 * MVP scope) — neither exists, so only the blended ratio ships, exactly the
 * fallback the metrics guide itself specifies ("expect the blended figure to
 * be the only one available at launch"). Reuses CM-05's marketing-sourced
 * pipeline/revenue and the same QuickBooks `sales_marketing` P&L category
 * VC-06 already reads (which blends sales and marketing spend together —
 * see G-16 — so "marketing spend" here is really "sales & marketing spend").
 */
export async function computeCM07(orgId: string, period?: string): Promise<MetricResult> {
  const month = period ?? latestClosedMonth()
  const quarterStart = latestClosedQuarterStart(month)
  const prevQuarterStart = shiftMonth(quarterStart, -3)
  const twoAgoQuarterStart = shiftMonth(quarterStart, -6)

  const [cm05, prevCm05, twoAgoCm05, snapshot, prevSnapshot, twoAgoSnapshot] = await Promise.all([
    computeCM05(orgId, month),
    computeCM05(orgId, prevQuarterStart),
    computeCM05(orgId, twoAgoQuarterStart),
    getStoredProfitAndLoss(orgId, 'quickbooks', quarterStart),
    getStoredProfitAndLoss(orgId, 'quickbooks', prevQuarterStart),
    getStoredProfitAndLoss(orgId, 'quickbooks', twoAgoQuarterStart)
  ])
  if (!snapshot) return notComputable('CM-07', quarterStart, 'multiple')

  const marketingSpend = sumExpensesByCategory(snapshot, 'sales_marketing', 'Total')
  const grossMarginPct = grossMarginFromPL(snapshot)

  const marketingSourcedPipeline = (cm05.data.marketingQualifiedPipeline as number | undefined) ?? 0
  const marketingSourcedRevenue = (cm05.data.marketingRevenue as number | undefined) ?? 0

  const pipelineRoi = marketingSpend > 0 ? marketingSourcedPipeline / marketingSpend : null
  const profitRoi = marketingSpend > 0 && grossMarginPct !== null ? (marketingSourcedRevenue * grossMarginPct) / marketingSpend : null

  // Doc: "declining two quarters running" needs a genuine two-point losing streak
  // (two-ago > previous > current), not just this quarter being lower than last —
  // same fix already applied to VC-07/CM-06 for the identical bug shape.
  const roiForQuarter = (cm05Result: MetricResult, plSnapshot: StoredQuarterSnapshot | null): number | null => {
    if (!plSnapshot) return null
    const spend = sumExpensesByCategory(plSnapshot, 'sales_marketing', 'Total')
    const pipeline = cm05Result.computable ? ((cm05Result.data.marketingQualifiedPipeline as number | undefined) ?? null) : null
    return spend > 0 && pipeline !== null ? pipeline / spend : null
  }
  const prevPipelineRoi = roiForQuarter(prevCm05, prevSnapshot)
  const twoAgoPipelineRoi = roiForQuarter(twoAgoCm05, twoAgoSnapshot)

  let flag: MetricFlag | null = null
  if (pipelineRoi !== null) {
    const belowTarget = pipelineRoi < 5
    const declining =
      prevPipelineRoi !== null && twoAgoPipelineRoi !== null && pipelineRoi < prevPipelineRoi && prevPipelineRoi < twoAgoPipelineRoi
    if (belowTarget || declining) {
      flag = {
        level: 'watch',
        reason: belowTarget
          ? `Blended pipeline ROI is ${pipelineRoi.toFixed(2)}x, below the 5x target.`
          : `Blended pipeline ROI has fallen two quarters running: ${twoAgoPipelineRoi!.toFixed(2)}x → ${prevPipelineRoi!.toFixed(2)}x → ${pipelineRoi.toFixed(2)}x.`
      }
    }
  }
  // Act-now ("a channel over 20% of spend returning <2x") and the Opportunity flag both need
  // per-channel data — unavailable (G-9, G-16b). Never fire until an ad-platform/Campaigns connector ships.

  return {
    id: 'CM-07',
    period: quarterStart,
    computable: pipelineRoi !== null,
    value: pipelineRoi !== null ? round2(pipelineRoi) : null,
    unit: 'multiple',
    data: {
      pipelineRoi: pipelineRoi !== null ? round2(pipelineRoi) : null,
      profitRoi: profitRoi !== null ? round2(profitRoi) : null,
      marketingSpend: round1(marketingSpend),
      marketingSourcedPipeline: round1(marketingSourcedPipeline),
      marketingSourcedRevenue: round1(marketingSourcedRevenue),
      grossMarginPct: grossMarginPct !== null ? round1(grossMarginPct * 100) : null,
      perChannelAvailable: false
    },
    flag,
    asOf: new Date().toISOString()
  }
}

// ---------------------------------------------------------------------------
// CM-03 — Competitive Win Rate (vs. Named Competitors)
// ---------------------------------------------------------------------------

/**
 * Salesforce has no single standard field for "which competitor was in the
 * deal" (metrics guide gap G-11) — it's a per-org custom field (commonly
 * `Competitor__c`), captured as `Organization.settings.salesforceCompetitorField`
 * and synced dynamically onto `Deal.competitor` (see sync.service.ts's
 * `syncSalesforceOpportunitiesAsDeals`). An org with no field configured gets
 * `computable: false` rather than a guess — same honest-numbers rule as
 * every other MVP gap. Trailing-2-quarter (6-month) rolling window per the
 * guide's cadence; win rate is tracked *per competitor*, so the top-level
 * `value`/flag are a blended figure across all named competitors while
 * `data.competitors` carries the full per-competitor breakdown a UI can
 * drill into.
 */
const SALESFORCE = 'salesforce'
const COMPETITOR_MIN_DECIDED_PER_WINDOW = 10
const COMPETITOR_DATA_QUALITY_MIN_SHARE_PCT = 25
const COMPETITOR_WIN_RATE_DROP_WATCH_POINTS = 10
const COMPETITOR_WIN_RATE_ACT_NOW_FLOOR_PCT = 30

interface CompetitorTally {
  wins: number
  losses: number
}

interface CompetitorWindowStats {
  stats: Map<string, CompetitorTally>
  decidedTotal: number
  decidedWithCompetitor: number
}

/**
 * Buckets closed (won or lost) deals by competitor within a window —
 * `closedKeys`/`wonKeys` come from PipelineStageDefinition, same pattern as
 * resolveQualifiedStageKeys. Handles both competitor-tracking modes
 * (G-11/G-24): `competitor` (single field, one per deal) and `competitors`
 * (the `OpportunityCompetitor` junction object, several per deal) — a deal
 * naming multiple competitors credits a win/loss to *each* of them, since
 * "we beat Competitor A and Competitor B in this deal" is meaningful for
 * both. `decidedWithCompetitor` counts the deal once regardless of how many
 * competitors it named, for the data-quality "share of deals with a
 * competitor recorded" check.
 */
function buildCompetitorStats(
  deals: { pipeline?: string; dealstage?: string; competitor?: string; competitors?: string[] }[],
  wonKeys: Set<string>,
  closedKeys: Set<string>
): CompetitorWindowStats {
  const stats = new Map<string, CompetitorTally>()
  let decidedTotal = 0
  let decidedWithCompetitor = 0

  for (const deal of deals) {
    if (!deal.pipeline || !deal.dealstage) continue
    const key = `${deal.pipeline}::${deal.dealstage}`
    if (!closedKeys.has(key)) continue
    decidedTotal += 1
    const dealCompetitors = deal.competitors && deal.competitors.length > 0 ? deal.competitors : deal.competitor ? [deal.competitor] : []
    if (dealCompetitors.length === 0) continue
    decidedWithCompetitor += 1
    const won = wonKeys.has(key)
    for (const competitor of dealCompetitors) {
      const tally = stats.get(competitor) ?? { wins: 0, losses: 0 }
      if (won) tally.wins += 1
      else tally.losses += 1
      stats.set(competitor, tally)
    }
  }

  return { stats, decidedTotal, decidedWithCompetitor }
}

export async function computeCM03(orgId: string, period?: string): Promise<MetricResult> {
  const endMonth = period ?? latestClosedMonth()

  const org = await organizationsRepository.findById(orgId)
  const competitorSource = org?.settings?.salesforceCompetitorSource
  const isConfigured = competitorSource === 'junction' || (competitorSource === 'field' && !!org?.settings?.salesforceCompetitorField)
  if (!isConfigured) {
    return {
      id: 'CM-03',
      period: endMonth,
      computable: false,
      value: null,
      unit: 'percent',
      data: { configured: false, blockedOn: 'competitor-field-config' },
      flag: null,
      asOf: new Date().toISOString()
    }
  }

  const currentFrom = new Date(monthToDateRange(shiftMonth(endMonth, -5)).startDate)
  const currentTo = new Date(`${monthToDateRange(endMonth).endDate}T23:59:59.999Z`)
  const priorFrom = new Date(monthToDateRange(shiftMonth(endMonth, -11)).startDate)
  const priorTo = new Date(`${monthToDateRange(shiftMonth(endMonth, -6)).endDate}T23:59:59.999Z`)

  const [currentDeals, priorDeals, stageDefs] = await Promise.all([
    dealRepository.findByCloseDateRange(orgId, SALESFORCE, currentFrom, currentTo),
    dealRepository.findByCloseDateRange(orgId, SALESFORCE, priorFrom, priorTo),
    pipelineStageDefinitionRepository.findAllForOrg(orgId, SALESFORCE)
  ])

  const wonKeys = new Set(stageDefs.filter((d) => d.entityType === 'deal' && d.isWon).map((d) => `${d.pipeline}::${d.rawStage}`))
  const closedKeys = new Set(stageDefs.filter((d) => d.entityType === 'deal' && d.isClosed).map((d) => `${d.pipeline}::${d.rawStage}`))

  const current = buildCompetitorStats(currentDeals, wonKeys, closedKeys)
  const prior = buildCompetitorStats(priorDeals, wonKeys, closedKeys)

  if (current.decidedTotal === 0) {
    return {
      id: 'CM-03',
      period: endMonth,
      computable: false,
      value: null,
      unit: 'percent',
      data: { configured: true, decidedDealsCurrent: 0 },
      flag: null,
      asOf: new Date().toISOString()
    }
  }

  const recordedSharePct = (current.decidedWithCompetitor / current.decidedTotal) * 100
  // Honest-numbers data-quality gate, per the guide: hold alerts back when
  // fewer than a quarter of closed deals have a competitor recorded.
  const dataQualityOk = recordedSharePct >= COMPETITOR_DATA_QUALITY_MIN_SHARE_PCT

  const competitors = Array.from(current.stats.entries())
    .map(([competitor, tally]) => {
      const decided = tally.wins + tally.losses
      const winRatePct = decided > 0 ? (tally.wins / decided) * 100 : null
      const priorTally = prior.stats.get(competitor)
      const priorDecided = priorTally ? priorTally.wins + priorTally.losses : 0
      const priorWinRatePct = priorTally && priorDecided > 0 ? (priorTally.wins / priorDecided) * 100 : null
      const eligible = decided >= COMPETITOR_MIN_DECIDED_PER_WINDOW && priorDecided >= COMPETITOR_MIN_DECIDED_PER_WINDOW
      const deltaPoints = eligible && winRatePct !== null && priorWinRatePct !== null ? winRatePct - priorWinRatePct : null
      return {
        competitor,
        wins: tally.wins,
        losses: tally.losses,
        decided,
        winRatePct: winRatePct !== null ? round1(winRatePct) : null,
        priorDecided,
        priorWinRatePct: priorWinRatePct !== null ? round1(priorWinRatePct) : null,
        deltaPoints: deltaPoints !== null ? round1(deltaPoints) : null,
        eligible
      }
    })
    .sort((a, b) => b.decided - a.decided)

  const totalWins = Array.from(current.stats.values()).reduce((sum, t) => sum + t.wins, 0)
  const blendedWinRatePct = current.decidedWithCompetitor > 0 ? (totalWins / current.decidedWithCompetitor) * 100 : null

  let flag: MetricFlag | null = null
  if (dataQualityOk) {
    const dropping = competitors.filter((c) => c.eligible && c.deltaPoints !== null && c.deltaPoints <= -COMPETITOR_WIN_RATE_DROP_WATCH_POINTS)
    if (dropping.length > 0) {
      const worst = dropping.reduce((a, b) => (a.deltaPoints! < b.deltaPoints! ? a : b))
      const actNow = worst.winRatePct !== null && worst.winRatePct < COMPETITOR_WIN_RATE_ACT_NOW_FLOOR_PCT
      flag = {
        level: actNow ? 'act_now' : 'watch',
        reason: actNow
          ? `Win rate vs. ${worst.competitor} fell ${Math.abs(worst.deltaPoints!).toFixed(1)} points to ${worst.winRatePct!.toFixed(1)}%, below the 30% floor.`
          : `Win rate vs. ${worst.competitor} fell ${Math.abs(worst.deltaPoints!).toFixed(1)} points, to ${worst.winRatePct!.toFixed(1)}%.`
      }
    }
  }

  return {
    id: 'CM-03',
    period: endMonth,
    computable: true,
    value: blendedWinRatePct !== null ? round1(blendedWinRatePct) : null,
    unit: 'percent',
    data: {
      configured: true,
      competitorSource,
      blendedWinRatePct: blendedWinRatePct !== null ? round1(blendedWinRatePct) : null,
      decidedDealsCurrent: current.decidedTotal,
      decidedDealsWithCompetitorCurrent: current.decidedWithCompetitor,
      recordedSharePct: round1(recordedSharePct),
      dataQualityOk,
      competitors
    },
    flag: dataQualityOk ? flag : null,
    asOf: new Date().toISOString()
  }
}
