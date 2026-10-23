import { MetricFlag, MetricResult } from '../metrics.types'
import { invoiceRepository } from '../../sync/repository/invoice.repository'
import { quickBooksCustomerRepository } from '../../sync/repository/quickBooksCustomer.repository'
import { dealRepository } from '../../sync/repository/deal.repository'
import { contactRepository } from '../../sync/repository/contact.repository'
import { pipelineStageDefinitionRepository } from '../../sync/repository/pipelineStageDefinition.repository'
import { funnelStageEventRepository } from '../../sync/repository/funnelStageEvent.repository'
import { salesforceCampaignRepository } from '../../sync/repository/salesforceCampaign.repository'
import { organizationsRepository } from '../../organizations/repository/organizations.repository'
import { getStoredProfitAndLoss, StoredQuarterSnapshot } from './plReport.service'
import { sumConfiguredAccountIds } from './plParser'
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

// The metrics guide's coverage thresholds (the guide calls the 3.0x target
// adjustable — not per-org configurable yet): Watch under 3.0x; Act now under
// 2.0x, or under 3.0x while the competitive win rate (CM-03) is also falling.
const CM04_COVERAGE_THRESHOLD = 3
const CM04_COVERAGE_ACT_NOW_THRESHOLD = 2

/**
 * The target is a *new-business* goal, so only new-business deals count
 * toward it — HubSpot's `dealtype` (`newbusiness`) and Salesforce's
 * `Opportunity.Type` (`New Business`) both normalize to `newbusiness`.
 * A deal with no type recorded is kept rather than silently dropped: a
 * portal that doesn't use the field at all would otherwise read as zero
 * coverage. The untyped count is returned so that gap stays visible.
 */
function isNewBusinessOrUntyped(type: string | undefined): boolean {
  return !type || type.toLowerCase().replace(/[^a-z]/g, '') === 'newbusiness'
}

/** Number of months in an inclusive `YYYY-MM` range. */
function monthsInRange(fromMonth: string, toMonth: string): number {
  const [fromYear, fromMo] = fromMonth.split('-').map(Number)
  const [toYear, toMo] = toMonth.split('-').map(Number)
  return (toYear - fromYear) * 12 + (toMo - fromMo) + 1
}

/**
 * The plan for a set of months from an org's month-range target rows (CM-04's
 * new-business amounts, CM-08's MQL counts — Organization.model.ts): each
 * row's total is spread evenly across its months, and the set takes the share
 * of every month it contains. `missingMonths` lists months no row covers —
 * any gap makes the whole set's target unknown, never a partial sum.
 */
function targetForMonths(
  rows: { fromMonth: string; toMonth: string; total: number }[],
  months: string[]
): { target: number | null; missingMonths: string[] } {
  let target = 0
  const missingMonths: string[] = []
  for (const month of months) {
    const row = rows.find((t) => t.fromMonth <= month && month <= t.toMonth)
    if (!row) missingMonths.push(month)
    else target += row.total / monthsInRange(row.fromMonth, row.toMonth)
  }
  return { target: missingMonths.length > 0 ? null : target, missingMonths }
}

/** The quarter's new-business target from the org's CM-04 target rows (see targetForMonths). */
export function quarterTargetFromRanges(
  targets: { fromMonth: string; toMonth: string; targetAmount: number }[],
  quarterStart: string
): { target: number | null; missingMonths: string[] } {
  return targetForMonths(
    targets.map((t) => ({ fromMonth: t.fromMonth, toMonth: t.toMonth, total: t.targetAmount })),
    [0, 1, 2].map((i) => shiftMonth(quarterStart, i))
  )
}

/**
 * Qualified new-business pipeline closing next quarter vs. that quarter's
 * new-business target. The target is operating-plan data no CRM holds (gap
 * G-14), so it comes from the org's own CM-04 target rows (Settings); a
 * quarter with any month left uncovered stays `computable: false`, though
 * the numerator (plus the qualified-stage-cutoff work the metrics guide
 * calls out as CM-04's actual gap, G-7) is still returned.
 */
export async function computeCM04(orgId: string, provider: string, period?: string): Promise<MetricResult> {
  const month = period ?? latestClosedMonth()
  const quarterStart = quarterStartOf(month)
  const nextQuarterStart = shiftMonth(quarterStart, 3)
  const range = quarterToDateRange(nextQuarterStart)

  const [deals, stageDefs, org] = await Promise.all([
    dealRepository.findByCloseDateRange(orgId, provider, new Date(range.startDate), new Date(`${range.endDate}T23:59:59.999Z`)),
    pipelineStageDefinitionRepository.findAllForOrg(orgId, provider),
    organizationsRepository.findById(orgId)
  ])

  const qualifiedKeys = resolveQualifiedStageKeys(stageDefs)
  const qualifiedAnyType = deals.filter((d) => d.pipeline && d.dealstage && qualifiedKeys.has(`${d.pipeline}::${d.dealstage}`))
  const qualifiedDeals = qualifiedAnyType.filter((d) => isNewBusinessOrUntyped(d.type))
  const qualifiedPipelineAmount = qualifiedDeals.reduce((sum, d) => sum + (d.amount ?? 0), 0)

  const { target, missingMonths } = quarterTargetFromRanges(org?.settings?.cm04Targets ?? [], nextQuarterStart)
  const coverage = target !== null && target > 0 ? qualifiedPipelineAmount / target : null

  let flag: MetricFlag | null = null
  if (coverage !== null && coverage < CM04_COVERAGE_ACT_NOW_THRESHOLD) {
    flag = {
      level: 'act_now',
      reason: `Pipeline coverage is ${coverage.toFixed(2)}x, below the ${CM04_COVERAGE_ACT_NOW_THRESHOLD.toFixed(1)}x floor.`
    }
  } else if (coverage !== null && coverage < CM04_COVERAGE_THRESHOLD) {
    // CM-03 (competitive win rate) only exists for Salesforce; its flag is
    // raised exactly when a competitor's win rate has fallen.
    const winRateFalling = provider === SALESFORCE && (await computeCM03(orgId, period)).flag !== null
    flag = winRateFalling
      ? {
          level: 'act_now',
          reason: `Pipeline coverage is ${coverage.toFixed(2)}x, below the ${CM04_COVERAGE_THRESHOLD.toFixed(1)}x target, while the competitive win rate (CM-03) is also falling.`
        }
      : { level: 'watch', reason: `Pipeline coverage is ${coverage.toFixed(2)}x, below the ${CM04_COVERAGE_THRESHOLD.toFixed(1)}x target.` }
  }

  return {
    id: 'CM-04',
    period: nextQuarterStart,
    computable: coverage !== null,
    value: coverage !== null ? round2(coverage) : null,
    unit: 'multiple',
    data: {
      qualifiedPipelineAmount: round1(qualifiedPipelineAmount),
      qualifiedDealCount: qualifiedDeals.length,
      excludedNonNewBusinessDealCount: qualifiedAnyType.length - qualifiedDeals.length,
      untypedDealCount: qualifiedDeals.filter((d) => !d.type).length,
      nextQuarterTarget: target !== null ? round1(target) : null,
      missingTargetMonths: missingMonths
    },
    flag,
    asOf: new Date().toISOString()
  }
}

// ---------------------------------------------------------------------------
// CM-06 — Funnel Conversion Rates (Lead -> MQL -> SQL -> Opportunity -> Won)
// ---------------------------------------------------------------------------

/**
 * The funnel-role mapping (metrics guide gap G-7) that CM-06/CM-08 both
 * need — which `lifecyclestage` values are the standard funnel's stages.
 * HubSpot's lifecycle stage is a standard, largely non-customizable enum
 * (unlike Salesforce Opportunity stages, which are always company-specific),
 * so a fixed default mapped straight from HubSpot's own value names is a
 * safe MVP default — see G-22 for the "not per-org configurable" caveat this
 * shares with G-13's chart-of-accounts heuristic.
 */
const LEAD_STAGE = 'lead'
const MQL_STAGE = 'marketingqualifiedlead'
const SQL_STAGE = 'salesqualifiedlead'
const OPPORTUNITY_STAGE = 'opportunity'
const WON_STAGE = 'customer'
const MIN_COHORT_LEADS = 100
const MIN_COHORT_MQLS = 30
const TRAILING_AVERAGE_QUARTERS = 4

/**
 * The guide's standard funnel, one transition per adjacent pair, each with
 * its own maturation window — months a quarterly cohort is held open after
 * the quarter ends before its rate counts as final (the answer key's
 * 90 / 60 / 180-day windows; SQL -> Opportunity takes MQL -> SQL's). A
 * record "advances" only by entering the exact next stage: a contact sales
 * created straight at SQL never counts as a Lead -> MQL conversion.
 */
const CM06_TRANSITIONS = [
  { key: 'leadToMql', label: 'Lead -> MQL', from: LEAD_STAGE, to: MQL_STAGE, maturationMonths: 3 },
  { key: 'mqlToSql', label: 'MQL -> SQL', from: MQL_STAGE, to: SQL_STAGE, maturationMonths: 2 },
  { key: 'sqlToOpportunity', label: 'SQL -> Opportunity', from: SQL_STAGE, to: OPPORTUNITY_STAGE, maturationMonths: 2 },
  { key: 'opportunityToWon', label: 'Opportunity -> Won', from: OPPORTUNITY_STAGE, to: WON_STAGE, maturationMonths: 6 }
] as const

interface QuarterCohort {
  quarterStart: string
  entered: number
  advanced: number
  ratePct: number | null
  medianDaysToAdvance: number | null
}

/** Records that first entered `from` during the quarter, and how many of them went on to enter `to`. */
function quarterCohort(
  records: { firstEntered: Record<string, Date> }[],
  from: string,
  to: string,
  quarterStart: string
): QuarterCohort {
  const start = new Date(monthToDateRange(quarterStart).startDate).getTime()
  const end = new Date(`${monthToDateRange(shiftMonth(quarterStart, 2)).endDate}T23:59:59.999Z`).getTime()
  let entered = 0
  const daysToAdvance: number[] = []
  for (const { firstEntered } of records) {
    const enteredAt = firstEntered[from]?.getTime()
    if (enteredAt === undefined || enteredAt < start || enteredAt > end) continue
    entered += 1
    const advancedAt = firstEntered[to]?.getTime()
    if (advancedAt !== undefined && advancedAt >= enteredAt) daysToAdvance.push((advancedAt - enteredAt) / 86_400_000)
  }
  daysToAdvance.sort((a, b) => a - b)
  const mid = Math.floor(daysToAdvance.length / 2)
  const median =
    daysToAdvance.length === 0 ? null : daysToAdvance.length % 2 ? daysToAdvance[mid] : (daysToAdvance[mid - 1] + daysToAdvance[mid]) / 2
  return {
    quarterStart,
    entered,
    advanced: daysToAdvance.length,
    ratePct: entered > 0 ? (daysToAdvance.length / entered) * 100 : null,
    medianDaysToAdvance: median !== null ? round1(median) : null
  }
}

/**
 * Stage-to-stage conversion, cohort-based per the metrics guide: for each
 * transition, records are grouped by the quarter they first entered the
 * stage, and the rate is how many of them went on to enter the next one.
 * Each transition reports its latest *mature* quarterly cohort (its quarter
 * ended at least `maturationMonths` before the as-of month), compared with
 * the average of that transition's four prior quarterly cohorts — the
 * guide's "trailing-four-quarter average". Since maturation differs per
 * transition, "two adjacent stages deteriorating in the same quarter" is
 * read as both transitions' latest mature cohorts being down. The headline
 * value is MQL -> SQL, the rate the guide singles out.
 */
export async function computeCM06(orgId: string, provider = 'hubspot', period?: string): Promise<MetricResult> {
  const asOfMonth = period ?? latestClosedMonth()
  const records = await funnelStageEventRepository.getFirstStageEntries(orgId, provider, 'lead', [
    LEAD_STAGE,
    MQL_STAGE,
    SQL_STAGE,
    OPPORTUNITY_STAGE,
    WON_STAGE
  ])

  const transitions = CM06_TRANSITIONS.map((transition) => {
    // Latest quarter that has fully matured for this transition by the as-of month.
    let cohortQuarter = lastFullQuarterStart(asOfMonth)
    while (shiftMonth(cohortQuarter, 2 + transition.maturationMonths) > asOfMonth) cohortQuarter = shiftMonth(cohortQuarter, -3)

    const current = quarterCohort(records, transition.from, transition.to, cohortQuarter)
    const priorRates = Array.from({ length: TRAILING_AVERAGE_QUARTERS }, (_, i) =>
      quarterCohort(records, transition.from, transition.to, shiftMonth(cohortQuarter, -3 * (i + 1)))
    )
      .map((cohort) => cohort.ratePct)
      .filter((rate): rate is number => rate !== null)
    // Averages only over prior quarters that had anyone enter — an empty quarter doesn't drag it toward zero.
    const trailingAvgPct = priorRates.length > 0 ? priorRates.reduce((sum, rate) => sum + rate, 0) / priorRates.length : null
    const down20Pct = current.ratePct !== null && trailingAvgPct !== null && current.ratePct < trailingAvgPct * 0.8

    return { ...transition, current, trailingAvgPct, down20Pct }
  })
  const byKey = Object.fromEntries(transitions.map((t) => [t.key, t])) as Record<(typeof CM06_TRANSITIONS)[number]['key'], (typeof transitions)[number]>
  const mqlToSql = byKey.mqlToSql

  if (transitions.every((t) => t.current.entered === 0)) return notComputable('CM-06', asOfMonth, 'percent')

  // Alerts are held back when a cohort is too small to trust: fewer than 100 leads or 30 MQLs.
  const cohortSizeSufficient = byKey.leadToMql.current.entered >= MIN_COHORT_LEADS && mqlToSql.current.entered >= MIN_COHORT_MQLS

  let flag: MetricFlag | null = null
  if (cohortSizeSufficient) {
    const mqlToSqlBelowHalf =
      mqlToSql.current.ratePct !== null && mqlToSql.trailingAvgPct !== null && mqlToSql.current.ratePct < mqlToSql.trailingAvgPct / 2
    const adjacentDown = transitions.findIndex((t, i) => i > 0 && t.down20Pct && transitions[i - 1].down20Pct)
    const down = transitions.filter((t) => t.down20Pct)

    if (mqlToSqlBelowHalf) {
      flag = {
        level: 'act_now',
        reason: `MQL -> SQL fell to ${mqlToSql.current.ratePct!.toFixed(1)}%, below half its trailing four-quarter average (${mqlToSql.trailingAvgPct!.toFixed(1)}%) — sales is rejecting marketing's leads.`
      }
    } else if (adjacentDown > 0) {
      flag = {
        level: 'act_now',
        reason: `Two adjacent funnel stages deteriorated: ${transitions[adjacentDown - 1].label} and ${transitions[adjacentDown].label} are both more than 20% below their trailing four-quarter averages.`
      }
    } else if (down.length > 0) {
      flag = {
        level: 'watch',
        reason: `${down.map((t) => t.label).join(', ')} fell more than 20% below ${down.length > 1 ? 'their' : 'its'} trailing four-quarter average.`
      }
    }
  }

  return {
    id: 'CM-06',
    period: mqlToSql.current.quarterStart,
    computable: mqlToSql.current.ratePct !== null,
    value: mqlToSql.current.ratePct !== null ? round1(mqlToSql.current.ratePct) : null,
    unit: 'percent',
    data: {
      stages: transitions.map((t) => ({
        key: t.key,
        label: t.label,
        cohortQuarter: t.current.quarterStart,
        maturationMonths: t.maturationMonths,
        cohortSize: t.current.entered,
        advanced: t.current.advanced,
        ratePct: t.current.ratePct !== null ? round1(t.current.ratePct) : null,
        trailingAvgPct: t.trailingAvgPct !== null ? round1(t.trailingAvgPct) : null,
        medianDaysToAdvance: t.current.medianDaysToAdvance
      })),
      cohortSizeSufficient
    },
    flag: cohortSizeSufficient ? flag : null,
    asOf: new Date().toISOString()
  }
}

// ---------------------------------------------------------------------------
// CM-08 — Lead Volume vs. Plan (MQL Flow)
// ---------------------------------------------------------------------------

// The metrics guide's plan thresholds: Watch when a month runs more than 15%
// below plan, Act now when a full quarter runs more than 25% below it.
const CM08_MONTH_BELOW_PLAN_PCT = 15
const CM08_QUARTER_BELOW_PLAN_PCT = 25

/** The last full calendar quarter ending on or before `month` — `month` itself when it closes a quarter. */
function lastFullQuarterStart(month: string): string {
  const quarterStart = quarterStartOf(month)
  return shiftMonth(quarterStart, 2) <= month ? quarterStart : shiftMonth(quarterStart, -3)
}

/**
 * MQLs generated in the month vs. the org's MQL plan (Settings — operating
 * plan data no CRM holds, gap G-14), plus month-over-month growth. A contact
 * counts in the month it *first* became an MQL (once per journey). With no
 * plan for the month the count, growth and plan-independent flags still
 * work; only the plan comparison and plan-based flags stay off.
 */
export async function computeCM08(orgId: string, provider = 'hubspot', period?: string): Promise<MetricResult> {
  const month = period ?? latestClosedMonth()
  const previousMonth = shiftMonth(month, -1)
  const twoAgoMonth = shiftMonth(month, -2)
  const quarterStart = lastFullQuarterStart(month)
  const quarterMonths = [0, 1, 2].map((i) => shiftMonth(quarterStart, i))

  const countMqls = (fromMonth: string, toMonth: string) =>
    funnelStageEventRepository.countRecordsFirstEnteringStage(orgId, provider, 'lead', MQL_STAGE, {
      from: new Date(monthToDateRange(fromMonth).startDate),
      to: new Date(`${monthToDateRange(toMonth).endDate}T23:59:59.999Z`)
    })

  const [current, previous, twoAgo, quarterMqls, org] = await Promise.all([
    countMqls(month, month),
    countMqls(previousMonth, previousMonth),
    countMqls(twoAgoMonth, twoAgoMonth),
    countMqls(quarterMonths[0], quarterMonths[2]),
    organizationsRepository.findById(orgId)
  ])

  const growthPct = previous > 0 ? ((current - previous) / previous) * 100 : null
  const decliningTwoMonthsRunning = current < previous && previous < twoAgo

  const planRows = (org?.settings?.cm08MqlTargets ?? []).map((t) => ({ fromMonth: t.fromMonth, toMonth: t.toMonth, total: t.targetCount }))
  const { target: plannedMqls, missingMonths: missingPlanMonths } = targetForMonths(planRows, [month])
  const { target: quarterPlannedMqls } = targetForMonths(planRows, quarterMonths)
  const variancePct = plannedMqls !== null && plannedMqls > 0 ? ((current - plannedMqls) / plannedMqls) * 100 : null
  const quarterVariancePct = quarterPlannedMqls !== null && quarterPlannedMqls > 0 ? ((quarterMqls - quarterPlannedMqls) / quarterPlannedMqls) * 100 : null

  // Each leg is the guide's own wording, independent of the others. "Falling
  // while CM-06 is also deteriorating" needs only a plain one-month fall (no
  // "two months running" in that leg), so a single drop alongside a red CM-06
  // still escalates.
  const fallingThisMonth = current < previous
  const cm06Deteriorating = fallingThisMonth && (await computeCM06(orgId, provider)).flag !== null
  const quarterFarBelowPlan = quarterVariancePct !== null && quarterVariancePct < -CM08_QUARTER_BELOW_PLAN_PCT
  const monthBelowPlan = variancePct !== null && variancePct < -CM08_MONTH_BELOW_PLAN_PCT

  let flag: MetricFlag | null = null
  if (quarterFarBelowPlan) {
    flag = {
      level: 'act_now',
      reason: `MQLs for the quarter (${quarterMqls}) ran ${Math.abs(quarterVariancePct!).toFixed(1)}% below plan (${Math.round(quarterPlannedMqls!)}).`
    }
  } else if (cm06Deteriorating) {
    flag = {
      level: 'act_now',
      reason: decliningTwoMonthsRunning
        ? `MQL volume has declined two months running (${twoAgo} -> ${previous} -> ${current}) while funnel conversion (CM-06) is also deteriorating.`
        : `MQL volume fell to ${current} (from ${previous}) while funnel conversion (CM-06) is also deteriorating.`
    }
  } else if (monthBelowPlan) {
    flag = { level: 'watch', reason: `MQLs (${current}) ran ${Math.abs(variancePct!).toFixed(1)}% below plan (${Math.round(plannedMqls!)}) this month.` }
  } else if (decliningTwoMonthsRunning) {
    flag = { level: 'watch', reason: `MQL volume has declined two months running: ${twoAgo} -> ${previous} -> ${current}.` }
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
      plannedMqls: plannedMqls !== null ? round1(plannedMqls) : null,
      variancePct: variancePct !== null ? round1(variancePct) : null,
      missingPlanMonths,
      quarterStart,
      quarterMqlCount: quarterMqls,
      quarterPlannedMqls: quarterPlannedMqls !== null ? round1(quarterPlannedMqls) : null,
      quarterVariancePct: quarterVariancePct !== null ? round1(quarterVariancePct) : null,
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
const SALESFORCE = 'salesforce'
const MARKETING_SOURCES = new Set(['ORGANIC_SEARCH', 'PAID_SEARCH', 'EMAIL_MARKETING', 'SOCIAL_MEDIA', 'PAID_SOCIAL', 'OTHER_CAMPAIGNS', 'AI_REFERRALS'])
const UNSOURCED_HOLDBACK_SHARE = 0.25
const ATTRIBUTION_MODEL = 'first-touch'

/**
 * CM-05's two windows for a quarter: pipeline *created* in the quarter itself
 * (the guide's "created this period" — quarterly, the grain its alerts
 * compare at), revenue *closed* over the trailing twelve months ending with
 * that quarter.
 */
function attributionWindows(quarterStart: string) {
  const quarterEnd = shiftMonth(quarterStart, 2)
  const endOf = (month: string) => new Date(`${monthToDateRange(month).endDate}T23:59:59.999Z`)
  return {
    pipelineFrom: new Date(monthToDateRange(quarterStart).startDate),
    revenueFrom: new Date(monthToDateRange(shiftMonth(quarterEnd, -11)).startDate),
    to: endOf(quarterEnd)
  }
}

/**
 * "Qualified pipeline" per the guide (same as CM-04): deals that passed the
 * qualification stage. Unlike CM-04's *open* pipeline, a deal created in the
 * period that has since been won — or lost after qualifying — still counts,
 * so the stage history is checked, not just the current stage. A deal lost
 * before ever qualifying doesn't.
 */
function passedQualification(
  deal: { pipeline?: string; dealstage?: string; dealStageHistory?: { value: string }[] },
  qualifiedKeys: Set<string>,
  wonKeys: Set<string>
): boolean {
  if (!deal.pipeline) return false
  const stages = [deal.dealstage, ...(deal.dealStageHistory ?? []).map((entry) => entry.value)]
  return stages.some((stage) => !!stage && (qualifiedKeys.has(`${deal.pipeline}::${stage}`) || wonKeys.has(`${deal.pipeline}::${stage}`)))
}

interface AttributionTotals {
  totalPipeline: number
  marketingPipeline: number
  totalRevenue: number
  marketingRevenue: number
  /** Marketing-sourced new-business revenue closed in the quarter itself (not the trailing 12 months) — CM-07's profit ROI sets it against the same quarter's spend. */
  marketingRevenueInQuarter: number
  unsourcedPipelineShare: number | null
  /** Salesforce-only: named-campaign breakdown of marketing-sourced pipeline (metrics guide gap G-23) — HubSpot's `hs_analytics_source` has no equivalent named entity to break out this way. */
  topCampaigns?: { label: string; pipeline: number; revenue: number; dealCount: number }[]
}

async function computeAttributionTotals(orgId: string, quarterStart: string): Promise<AttributionTotals> {
  const { pipelineFrom, revenueFrom, to } = attributionWindows(quarterStart)

  const [createdDeals, closedDeals, contacts, stageDefs] = await Promise.all([
    dealRepository.findByCreateDateRange(orgId, HUBSPOT, pipelineFrom, to),
    dealRepository.findByCloseDateRange(orgId, HUBSPOT, revenueFrom, to),
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
    if (!isNewBusinessOrUntyped(deal.type) || !passedQualification(deal, qualifiedKeys, wonKeys)) continue
    const amount = deal.amount ?? 0
    totalPipeline += amount
    const source = sourceForDeal(deal.contactIds ?? [])
    if (!source) unsourcedPipeline += amount
    else if (MARKETING_SOURCES.has(source)) marketingPipeline += amount
  }

  let totalRevenue = 0
  let marketingRevenue = 0
  let marketingRevenueInQuarter = 0
  for (const deal of closedDeals) {
    if (!isNewBusinessOrUntyped(deal.type) || !deal.pipeline || !deal.dealstage || !wonKeys.has(`${deal.pipeline}::${deal.dealstage}`)) continue
    const amount = deal.amount ?? 0
    totalRevenue += amount
    const source = sourceForDeal(deal.contactIds ?? [])
    if (source && MARKETING_SOURCES.has(source)) {
      marketingRevenue += amount
      if (deal.closedate && deal.closedate >= pipelineFrom) marketingRevenueInQuarter += amount
    }
  }

  return {
    totalPipeline,
    marketingPipeline,
    totalRevenue,
    marketingRevenue,
    marketingRevenueInQuarter,
    unsourcedPipelineShare: totalPipeline > 0 ? unsourcedPipeline / totalPipeline : null
  }
}

/**
 * Salesforce equivalent of computeAttributionTotals (metrics guide gap G-23
 * — CM-05 was HubSpot-only because `Contact.analyticsSource` has no
 * Salesforce counterpart). Salesforce's `Lead.LeadSource` picklist is
 * free-text/custom per org (unlike HubSpot's fixed `hs_analytics_source`
 * enum), so guessing which values mean "marketing" would be a fragile,
 * per-org heuristic. `Opportunity.CampaignId` is used instead: Salesforce
 * Campaigns are themselves a marketing-initiative object, so "this deal is
 * linked to a Campaign" is a clean, unambiguous marketing-sourced signal —
 * no deal is currently synced with `leadSource` used for classification, but
 * the field stays on `Deal` for a future per-org LeadSource mapping (same
 * category as G-22's "not per-org configurable" caveat). No first-touch
 * contact hop is needed here (unlike the HubSpot path) since the signal
 * lives directly on the deal.
 */
async function computeSalesforceAttributionTotals(orgId: string, quarterStart: string): Promise<AttributionTotals> {
  const { pipelineFrom, revenueFrom, to } = attributionWindows(quarterStart)

  const [createdDeals, closedDeals, stageDefs, campaigns] = await Promise.all([
    dealRepository.findByCreateDateRange(orgId, SALESFORCE, pipelineFrom, to),
    dealRepository.findByCloseDateRange(orgId, SALESFORCE, revenueFrom, to),
    pipelineStageDefinitionRepository.findAllForOrg(orgId, SALESFORCE),
    salesforceCampaignRepository.findAll(orgId, SALESFORCE)
  ])

  const qualifiedKeys = resolveQualifiedStageKeys(stageDefs)
  const wonKeys = new Set(stageDefs.filter((d) => d.entityType === 'deal' && d.isWon).map((d) => `${d.pipeline}::${d.rawStage}`))
  const campaignNameById = new Map(campaigns.map((c) => [c.providerRecordId, c.name ?? c.providerRecordId]))

  const campaignPipeline = new Map<string, number>()
  const campaignRevenue = new Map<string, number>()
  const campaignDealCount = new Map<string, number>()

  let totalPipeline = 0
  let marketingPipeline = 0
  let unsourcedPipeline = 0
  for (const deal of createdDeals) {
    if (!isNewBusinessOrUntyped(deal.type) || !passedQualification(deal, qualifiedKeys, wonKeys)) continue
    const amount = deal.amount ?? 0
    totalPipeline += amount
    if (deal.campaignId) {
      marketingPipeline += amount
      campaignPipeline.set(deal.campaignId, (campaignPipeline.get(deal.campaignId) ?? 0) + amount)
      campaignDealCount.set(deal.campaignId, (campaignDealCount.get(deal.campaignId) ?? 0) + 1)
    } else {
      unsourcedPipeline += amount
    }
  }

  let totalRevenue = 0
  let marketingRevenue = 0
  let marketingRevenueInQuarter = 0
  for (const deal of closedDeals) {
    if (!isNewBusinessOrUntyped(deal.type) || !deal.pipeline || !deal.dealstage || !wonKeys.has(`${deal.pipeline}::${deal.dealstage}`)) continue
    const amount = deal.amount ?? 0
    totalRevenue += amount
    if (deal.campaignId) {
      marketingRevenue += amount
      if (deal.closedate && deal.closedate >= pipelineFrom) marketingRevenueInQuarter += amount
      campaignRevenue.set(deal.campaignId, (campaignRevenue.get(deal.campaignId) ?? 0) + amount)
    }
  }

  const topCampaigns = Array.from(new Set([...campaignPipeline.keys(), ...campaignRevenue.keys()]))
    .map((campaignId) => ({
      label: campaignNameById.get(campaignId) ?? campaignId,
      pipeline: round1(campaignPipeline.get(campaignId) ?? 0),
      revenue: round1(campaignRevenue.get(campaignId) ?? 0),
      dealCount: campaignDealCount.get(campaignId) ?? 0
    }))
    .sort((a, b) => b.pipeline - a.pipeline)

  return {
    totalPipeline,
    marketingPipeline,
    totalRevenue,
    marketingRevenue,
    marketingRevenueInQuarter,
    unsourcedPipelineShare: totalPipeline > 0 ? unsourcedPipeline / totalPipeline : null,
    topCampaigns
  }
}

/**
 * Marketing-sourced share of the qualified new-business pipeline created in
 * the latest closed quarter, plus of new-business revenue closed over the
 * trailing twelve months — both new-business only (same filter as CM-04),
 * compared quarter over quarter for the alerts.
 */
export async function computeCM05(orgId: string, provider: string = 'hubspot', period?: string): Promise<MetricResult> {
  const quarterStart = latestClosedQuarterStart(period ?? latestClosedMonth())
  const prevQuarterStart = shiftMonth(quarterStart, -3)
  const twoAgoQuarterStart = shiftMonth(quarterStart, -6)

  const computeTotals = provider === SALESFORCE ? computeSalesforceAttributionTotals : computeAttributionTotals

  const [current, previous, twoAgo] = await Promise.all([
    computeTotals(orgId, quarterStart),
    computeTotals(orgId, prevQuarterStart),
    computeTotals(orgId, twoAgoQuarterStart)
  ])

  if (current.totalPipeline <= 0) return notComputable('CM-05', quarterStart, 'percent')

  const pipelinePct = (current.marketingPipeline / current.totalPipeline) * 100
  const revenuePct = current.totalRevenue > 0 ? (current.marketingRevenue / current.totalRevenue) * 100 : null

  // Honest-numbers data-quality gate: the metrics guide holds alerts back
  // when more than a quarter of qualified pipeline has no resolvable source.
  const dataQualityOk = current.unsourcedPipelineShare === null || current.unsourcedPipelineShare < UNSOURCED_HOLDBACK_SHARE

  const prevPipelinePct = previous.totalPipeline > 0 ? (previous.marketingPipeline / previous.totalPipeline) * 100 : null
  const twoAgoPipelinePct = twoAgo.totalPipeline > 0 ? (twoAgo.marketingPipeline / twoAgo.totalPipeline) * 100 : null

  let flag: MetricFlag | null = null
  if (dataQualityOk) {
    const falling = prevPipelinePct !== null && pipelinePct < prevPipelinePct
    // Act now: the share is falling while pipeline coverage (CM-04) is also
    // below its target — CM-04 flags exactly when coverage is under 3.0x.
    const coverageBelowTarget = falling && (await computeCM04(orgId, provider)).flag !== null
    const fallingTwoQuarters = falling && twoAgoPipelinePct !== null && prevPipelinePct! < twoAgoPipelinePct
    const belowTarget = pipelinePct < 30
    if (coverageBelowTarget) {
      flag = {
        level: 'act_now',
        reason: `Marketing-sourced pipeline share fell to ${pipelinePct.toFixed(1)}% (from ${prevPipelinePct!.toFixed(1)}%) while pipeline coverage (CM-04) is also below target.`
      }
    } else if (fallingTwoQuarters || belowTarget) {
      flag = {
        level: 'watch',
        reason: fallingTwoQuarters
          ? `Marketing-sourced pipeline share has fallen two quarters running, to ${pipelinePct.toFixed(1)}%.`
          : `Marketing-sourced pipeline is ${pipelinePct.toFixed(1)}%, below the 30% target.`
      }
    }
  }

  return {
    id: 'CM-05',
    period: quarterStart,
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
      marketingRevenueInQuarter: round1(current.marketingRevenueInQuarter),
      unsourcedPipelineSharePct: current.unsourcedPipelineShare !== null ? round1(current.unsourcedPipelineShare * 100) : null,
      dataQualityOk,
      attributionModel: ATTRIBUTION_MODEL,
      ...(current.topCampaigns ? { topCampaigns: current.topCampaigns } : {})
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

  const [cm05, prevCm05, twoAgoCm05, snapshot, prevSnapshot, twoAgoSnapshot, org] = await Promise.all([
    // CM-07 stays HubSpot-only (G-23) — it needs marketing spend split out of the
    // QuickBooks P&L, which has no per-CRM equivalent, so there's no Salesforce leg to add here.
    computeCM05(orgId, 'hubspot', month),
    computeCM05(orgId, 'hubspot', prevQuarterStart),
    computeCM05(orgId, 'hubspot', twoAgoQuarterStart),
    getStoredProfitAndLoss(orgId, 'quickbooks', quarterStart),
    getStoredProfitAndLoss(orgId, 'quickbooks', prevQuarterStart),
    getStoredProfitAndLoss(orgId, 'quickbooks', twoAgoQuarterStart),
    organizationsRepository.findById(orgId)
  ])
  // Marketing spend is the org's own picked marketing accounts (Settings) — never the
  // keyword-guessed "sales & marketing" bucket, which would fold sales spend in too.
  const marketingAccountIds = new Set(org?.settings?.marketingSpendAccountIds ?? [])
  if (marketingAccountIds.size === 0) {
    return { ...notComputable('CM-07', quarterStart, 'multiple'), data: { configured: false, blockedOn: 'marketing-spend-accounts' } }
  }
  if (!snapshot) return notComputable('CM-07', quarterStart, 'multiple')

  const marketingSpend = sumConfiguredAccountIds(snapshot, marketingAccountIds, 'Total')
  const grossMarginPct = grossMarginFromPL(snapshot)

  // Both ROIs set the quarter's spend against the same quarter: pipeline created in it,
  // and new-business revenue closed in it (not CM-05's trailing-twelve-month revenue).
  const marketingSourcedPipeline = (cm05.data.marketingQualifiedPipeline as number | undefined) ?? 0
  const marketingSourcedRevenue = (cm05.data.marketingRevenueInQuarter as number | undefined) ?? 0

  const pipelineRoi = marketingSpend > 0 ? marketingSourcedPipeline / marketingSpend : null
  const profitRoi = marketingSpend > 0 && grossMarginPct !== null ? (marketingSourcedRevenue * grossMarginPct) / marketingSpend : null

  // Doc: "declining two quarters running" needs a genuine two-point losing streak
  // (two-ago > previous > current), not just this quarter being lower than last —
  // same fix already applied to VC-07/CM-06 for the identical bug shape.
  const roiForQuarter = (cm05Result: MetricResult, plSnapshot: StoredQuarterSnapshot | null): number | null => {
    if (!plSnapshot) return null
    const spend = sumConfiguredAccountIds(plSnapshot, marketingAccountIds, 'Total')
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
    // "Pipeline ROI leads and profit ROI confirms ... every alert reports both."
    const profitNote = profitRoi !== null ? ` Profit ROI is ${profitRoi.toFixed(2)}x.` : ''
    if (belowTarget || declining) {
      flag = {
        level: 'watch',
        reason:
          (belowTarget
            ? `Blended pipeline ROI is ${pipelineRoi.toFixed(2)}x, below the 5x target.`
            : `Blended pipeline ROI has fallen two quarters running: ${twoAgoPipelineRoi!.toFixed(2)}x → ${prevPipelineRoi!.toFixed(2)}x → ${pipelineRoi.toFixed(2)}x.`) +
          profitNote
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
      configured: true,
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
