import { MetricFlag, MetricResult } from '../metrics.types'
import { getStoredProfitAndLoss, StoredQuarterSnapshot } from './plReport.service'
import { sumColumn } from './plParser'
import { ebitdaFromPL } from './plMetrics.service'
import { latestClosedMonth, latestClosedQuarterStart, shiftMonth } from './revenueRollForward.service'
import { cashBalanceSnapshotRepository } from '../../sync/repository/cashBalanceSnapshot.repository'
import { organizationsRepository } from '../../organizations/repository/organizations.repository'
import { OrganizationSettings } from '../../organizations/model/Organization.model'

/**
 * CB-05, CB-07, CB-10 — the Capital & Balance Sheet metrics (Phase 3).
 * CB-07/CB-10 follow the same quarter-grain, snapshot-backed pattern as the
 * VC metrics in plMetrics.service.ts (read `PLSnapshot`, never a live
 * QuickBooks call). CB-05 is different in kind — it's the one metric in the
 * whole framework checked *daily* — so it reads `CashBalanceSnapshot`
 * (one row per synced day) instead of the quarterly table.
 */

const round1 = (n: number): number => Math.round(n * 10) / 10
const round2 = (n: number): number => Math.round(n * 100) / 100
const QUICKBOOKS = 'quickbooks'
const MS_PER_DAY = 86400000

function notComputable(id: string, period: string, unit: MetricResult['unit']): MetricResult {
  return { id, period, computable: false, value: null, unit, data: { snapshotAvailable: false }, flag: null, asOf: new Date().toISOString() }
}

// ---------------------------------------------------------------------------
// CB-05 — Cash Position & Runway
// ---------------------------------------------------------------------------

export async function computeCB05(orgId: string): Promise<MetricResult> {
  // Most-recent-first; capped generously since burn rate wants ~90 days back
  // and this only ever has one row per actual sync, not one per calendar day
  // (no scheduler yet — see CashBalanceSnapshot.model.ts).
  const snapshots = await cashBalanceSnapshotRepository.findRecent(orgId, QUICKBOOKS, 100)
  if (snapshots.length === 0) return notComputable('CB-05', new Date().toISOString().slice(0, 10), 'usd')

  const latest = snapshots[0]
  const oldest = snapshots[snapshots.length - 1]
  const daysBetween = (new Date(latest.asOfDate).getTime() - new Date(oldest.asOfDate).getTime()) / MS_PER_DAY

  // Average monthly burn, scaled from whatever gap actually exists between
  // the oldest and newest data points — not a strict "exactly 3 months ago"
  // lookup, since sync cadence isn't guaranteed to land there yet.
  const avgMonthlyBurn = daysBetween > 0 ? ((oldest.unrestrictedCash - latest.unrestrictedCash) / daysBetween) * 30 : null
  const selfFunding = avgMonthlyBurn !== null && avgMonthlyBurn <= 0
  const runwayMonths = avgMonthlyBurn !== null && avgMonthlyBurn > 0 ? latest.unrestrictedCash / avgMonthlyBurn : null

  // "Unexplained single-day cash drop" only means something when the two
  // most recent snapshots really are ~1 day apart — a two-week gap between
  // sparse syncs isn't a "single-day" anything.
  let singleDayDropPct: number | null = null
  if (snapshots.length > 1) {
    const prev = snapshots[1]
    const gapDays = (new Date(latest.asOfDate).getTime() - new Date(prev.asOfDate).getTime()) / MS_PER_DAY
    if (gapDays <= 1 && prev.unrestrictedCash > 0) {
      singleDayDropPct = ((prev.unrestrictedCash - latest.unrestrictedCash) / prev.unrestrictedCash) * 100
    }
  }

  let flag: MetricFlag | null = null
  const bigDrop = singleDayDropPct !== null && singleDayDropPct > 15
  if (runwayMonths !== null && runwayMonths < 6) {
    flag = { level: 'act_now', reason: `Runway is ${runwayMonths.toFixed(1)} months, below the 6-month floor.` }
  } else if (bigDrop) {
    flag = { level: 'act_now', reason: `Cash dropped ${singleDayDropPct!.toFixed(1)}% in a single day.` }
  } else if (runwayMonths !== null && runwayMonths < 12) {
    flag = { level: 'watch', reason: `Runway is ${runwayMonths.toFixed(1)} months, below the 12-month watch line.` }
  }

  return {
    id: 'CB-05',
    period: latest.asOfDate,
    computable: true,
    value: runwayMonths !== null ? round1(runwayMonths) : null,
    unit: 'months',
    data: {
      unrestrictedCash: round2(latest.unrestrictedCash),
      avgMonthlyBurn: avgMonthlyBurn !== null ? round2(avgMonthlyBurn) : null,
      selfFunding,
      singleDayDropPct: singleDayDropPct !== null ? round1(singleDayDropPct) : null,
      dataPoints: snapshots.length,
      sourceQuality: 'quickbooks-fallback' // per the metrics guide: bank-feed/Plaid is the primary source, out of MVP scope
    },
    flag,
    asOf: new Date().toISOString()
  }
}

// ---------------------------------------------------------------------------
// CB-07 — Free Cash Flow Conversion
// ---------------------------------------------------------------------------

/**
 * Balance-Sheet-derived Operating Cash Flow fallback (the PDF's own words:
 * "not a workaround invented here") for when the Cash Flow report isn't
 * available for this quarter — common at smaller mid-market companies.
 * Indirect-method logic: EBITDA, adjusted for cash tied up in working
 * capital versus last quarter — A/R and Inventory increases are cash stuck
 * outside the business (subtract); an A/P increase is cash you get to keep
 * longer (add).
 *
 * Needs *both* quarters' A/R and A/P to be defined — a comparison this
 * indirect shouldn't be attempted on a partial data set. Inventory is the
 * one exception: a missing inventory report defaults to $0 on both sides
 * rather than blocking the whole fallback, same "hidden from display, not a
 * data gap" rule CB-10 already applies — plenty of real businesses (most
 * SaaS companies included) genuinely carry no inventory at all, and that's
 * a legitimate zero, not a report failure.
 *
 * CapEx has no equivalent automatic derivation (see
 * `cb07ExpenditureAccountIds` below) — different companies book capital
 * expenditure too inconsistently (leased vs. owned equipment, capitalized
 * software, etc.) for an automatic InvestingActivities/FixedAssets-delta
 * heuristic to be trustworthy (docs/sherpai-metrics-progress.md gaps
 * G-18/G-19). An org must explicitly pick which accounts it is.
 */
function operatingCashFlowProxyFromBalanceSheet(current: StoredQuarterSnapshot, previous: StoredQuarterSnapshot, ebitda: number): number | null {
  if (current.accountsReceivable === undefined || previous.accountsReceivable === undefined || current.accountsPayable === undefined || previous.accountsPayable === undefined) {
    return null
  }

  const currentInventory = current.inventoryValue ?? 0
  const previousInventory = previous.inventoryValue ?? 0

  const workingCapitalIncrease =
    current.accountsReceivable - previous.accountsReceivable + (currentInventory - previousInventory) - (current.accountsPayable - previous.accountsPayable)
  return ebitda - workingCapitalIncrease
}

/**
 * Sums the configured accounts' amounts off `accountAmounts` (one quarter's
 * leaf-account map — see `PLSnapshot.accountAmounts`). `undefined` when no
 * accounts are configured, or when any configured account id doesn't
 * resolve to an amount for this quarter (a comparison this direct shouldn't
 * silently treat a missing account as $0). Amounts are summed as
 * magnitudes — a CapEx account might be a Cash Flow investing-activities
 * line (reported as a negative, cash out) or a Balance Sheet fixed-asset
 * balance (reported as a positive), and either way the org picked it to
 * mean "this much was spent."
 */
function sumConfiguredAccounts(accountAmounts: Record<string, number> | undefined, accountIds: string[]): number | undefined {
  if (accountIds.length === 0) return undefined
  let sum = 0
  for (const id of accountIds) {
    const amount = accountAmounts?.[id]
    if (amount === undefined) return undefined
    sum += Math.abs(amount)
  }
  return sum
}

export async function computeCB07(orgId: string, period?: string): Promise<MetricResult> {
  const month = period ?? latestClosedMonth()
  const quarterStart = latestClosedQuarterStart(month)
  const prevQuarterStart = shiftMonth(quarterStart, -3)
  const [org, snapshot, prevSnapshot] = await Promise.all([
    organizationsRepository.findById(orgId),
    getStoredProfitAndLoss(orgId, QUICKBOOKS, quarterStart),
    getStoredProfitAndLoss(orgId, QUICKBOOKS, prevQuarterStart)
  ])
  if (!snapshot) return notComputable('CB-07', quarterStart, 'percent')

  const { ebitda } = ebitdaFromPL(snapshot)

  let operatingCashFlow = snapshot.operatingCashFlow
  let sourceQuality: 'quickbooks-primary' | 'balance-sheet-derived' | null = operatingCashFlow !== undefined ? 'quickbooks-primary' : null
  if (operatingCashFlow === undefined && prevSnapshot) {
    const derived = operatingCashFlowProxyFromBalanceSheet(snapshot, prevSnapshot, ebitda)
    if (derived !== null) {
      operatingCashFlow = derived
      sourceQuality = 'balance-sheet-derived'
    }
  }

  // CapEx is never inferred automatically -- it's exactly whichever accounts the
  // org picked in Settings (Organization.settings.cb07ExpenditureAccountIds).
  const expenditureAccountIds = org?.settings?.cb07ExpenditureAccountIds ?? []
  const capEx = sumConfiguredAccounts(snapshot.accountAmounts, expenditureAccountIds)

  const fcf = operatingCashFlow !== undefined && capEx !== undefined ? operatingCashFlow - capEx : null
  const conversionPct = fcf !== null && ebitda !== 0 ? (fcf / ebitda) * 100 : null

  return {
    id: 'CB-07',
    period: quarterStart,
    computable: conversionPct !== null,
    value: conversionPct !== null ? round1(conversionPct) : null,
    unit: 'percent',
    data: {
      operatingCashFlow: operatingCashFlow !== undefined ? round1(operatingCashFlow) : null,
      capEx: capEx !== undefined ? round1(capEx) : null,
      fcf: fcf !== null ? round1(fcf) : null,
      ebitda: round1(ebitda),
      sourceQuality,
      expenditureAccountsConfigured: expenditureAccountIds.length > 0,
      benchmarkAvailable: false,
      leverageAvailable: false
    },
    // Both of CB-07's flag conditions need data this MVP doesn't have: the watch leg needs
    // plan/peer comparison, and the act-now leg explicitly needs CB-01 (leverage), which is
    // deferred entirely — the PDF itself says this cross-check "can't fire until leverage
    // ships." Never fires until then; not silently dropped, just genuinely blocked.
    flag: null,
    asOf: new Date().toISOString()
  }
}

// ---------------------------------------------------------------------------
// CB-10 — Cash Conversion Cycle
// ---------------------------------------------------------------------------

function daysInQuarter(snapshot: StoredQuarterSnapshot): number {
  const days = Math.round((new Date(snapshot.endDate).getTime() - new Date(snapshot.startDate).getTime()) / MS_PER_DAY) + 1
  return days > 0 ? days : 91
}

interface CycleLegs {
  daysToCollect: number | null
  daysInInventory: number | null
  daysToPay: number | null
  cycle: number | null
  hasInventory: boolean
}

/**
 * A/R, A/P, and Inventory each come from whichever single QuickBooks account
 * the org configured for that bucket (Organization.settings, resolved via
 * `snapshot.accountAmounts`) — never a company-wide report total, since a
 * company may book more than one account under a given heading and the org
 * is the one who knows which is the real trade A/R vs. A/P vs. Inventory.
 * A/R and A/P are hard requirements: no account configured means that leg
 * (and so the whole cycle) isn't computable. Inventory is the one
 * exception, matching the existing "hidden $0 leg" convention — a company
 * that genuinely carries no inventory (most SaaS companies) shouldn't be
 * forced to configure anything just to make the other two legs computable.
 */
function computeCycleLegs(snapshot: StoredQuarterSnapshot, settings: OrganizationSettings): CycleLegs {
  const revenue = sumColumn(snapshot.income, 'Total')
  const cogs = sumColumn(snapshot.cogs, 'Total')
  const days = daysInQuarter(snapshot)

  const accountsReceivable = settings.cb10AccountsReceivableAccountId ? snapshot.accountAmounts?.[settings.cb10AccountsReceivableAccountId] : undefined
  const accountsPayable = settings.cb10AccountsPayableAccountId ? snapshot.accountAmounts?.[settings.cb10AccountsPayableAccountId] : undefined
  const inventoryValue = settings.cb10InventoryAccountId ? snapshot.accountAmounts?.[settings.cb10InventoryAccountId] : undefined

  const daysToCollect = revenue > 0 && accountsReceivable !== undefined ? (Math.abs(accountsReceivable) / revenue) * days : null
  // A missing/unconfigured inventory account is a display rule for service companies
  // (metrics guide: "show a zero that's hidden from display," not a data
  // gap) — 0 in, `hasInventory` tells the UI whether to show that leg.
  const resolvedInventory = Math.abs(inventoryValue ?? 0)
  const daysInInventory = cogs > 0 ? (resolvedInventory / cogs) * days : resolvedInventory > 0 ? null : 0
  const daysToPay = cogs > 0 && accountsPayable !== undefined ? (Math.abs(accountsPayable) / cogs) * days : null

  const cycle = daysToCollect !== null && daysInInventory !== null && daysToPay !== null ? daysToCollect + daysInInventory - daysToPay : null

  return { daysToCollect, daysInInventory, daysToPay, cycle, hasInventory: resolvedInventory > 0 }
}

export async function computeCB10(orgId: string, period?: string): Promise<MetricResult> {
  const month = period ?? latestClosedMonth()
  const quarterStart = latestClosedQuarterStart(month)
  const prevQuarterStart = shiftMonth(quarterStart, -3)
  const twoAgoQuarterStart = shiftMonth(quarterStart, -6)

  const [org, current, prevOrNull, twoAgoOrNull] = await Promise.all([
    organizationsRepository.findById(orgId),
    getStoredProfitAndLoss(orgId, QUICKBOOKS, quarterStart),
    getStoredProfitAndLoss(orgId, QUICKBOOKS, prevQuarterStart),
    getStoredProfitAndLoss(orgId, QUICKBOOKS, twoAgoQuarterStart)
  ])
  if (!current) return notComputable('CB-10', quarterStart, 'months')

  const settings = org?.settings ?? {}
  const legs = computeCycleLegs(current, settings)
  const prevLegs = prevOrNull ? computeCycleLegs(prevOrNull, settings) : null
  const twoAgoLegs = twoAgoOrNull ? computeCycleLegs(twoAgoOrNull, settings) : null

  // collectionsSlowedQoQ only ever checked daysToCollect, not legs.cycle (the value
  // `computable` depends on) -- daysToCollect can resolve even when legs.cycle can't
  // (e.g. accountsPayable missing), which would let a flag survive onto a response
  // the card renders as "Not computable." Gate the whole block on legs.cycle !== null.
  let flag: MetricFlag | null = null
  const lengthenedOverTwoQuarters =
    legs.cycle !== null && twoAgoLegs?.cycle !== null && twoAgoLegs !== null && legs.cycle - twoAgoLegs.cycle > 15
  const collectionsSlowedQoQ =
    legs.cycle !== null &&
    legs.daysToCollect !== null &&
    prevLegs?.daysToCollect !== null &&
    prevLegs !== null &&
    legs.daysToCollect - prevLegs.daysToCollect > 5

  if (lengthenedOverTwoQuarters) {
    flag = {
      level: 'act_now',
      reason: `Cash conversion cycle lengthened ${(legs.cycle! - twoAgoLegs!.cycle!).toFixed(1)} days over the past two quarters, to ${legs.cycle!.toFixed(1)} days.`
    }
  } else if (collectionsSlowedQoQ) {
    flag = {
      level: 'watch',
      reason: `Collections alone slowed ${(legs.daysToCollect! - prevLegs!.daysToCollect!).toFixed(1)} days quarter over quarter.`
    }
  }
  // The plan/peer-relative watch leg needs data this MVP doesn't have — see gap G-14.

  return {
    id: 'CB-10',
    period: quarterStart,
    computable: legs.cycle !== null,
    value: legs.cycle !== null ? round1(legs.cycle) : null,
    unit: 'days',
    data: {
      daysToCollect: legs.daysToCollect !== null ? round1(legs.daysToCollect) : null,
      daysInInventory: legs.hasInventory && legs.daysInInventory !== null ? round1(legs.daysInInventory) : null,
      hasInventory: legs.hasInventory,
      daysToPay: legs.daysToPay !== null ? round1(legs.daysToPay) : null,
      accountsConfigured: {
        accountsReceivable: !!settings.cb10AccountsReceivableAccountId,
        accountsPayable: !!settings.cb10AccountsPayableAccountId,
        inventory: !!settings.cb10InventoryAccountId
      },
      benchmarkAvailable: false
    },
    flag,
    asOf: new Date().toISOString()
  }
}
