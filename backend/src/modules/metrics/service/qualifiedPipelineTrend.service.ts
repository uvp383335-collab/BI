import { MetricUnit } from '../metrics.types'
import { dealRepository } from '../../sync/repository/deal.repository'
import { pipelineStageDefinitionRepository } from '../../sync/repository/pipelineStageDefinition.repository'
import { organizationsRepository } from '../../organizations/repository/organizations.repository'
import { resolveQualifiedStageKeys, isNewBusinessOrUntyped, targetForMonths, cm04TargetRows } from './cmMetrics.service'
import { shiftMonth, latestClosedMonth, monthToDateRange } from './revenueRollForward.service'

export interface QualifiedPipelineTrendPoint {
  month: string
  actual: number
  qualifiedDealCount: number
  target: number | null
  /** CM-04's own formula (qualifiedPipelineAmount / target), applied per month instead of per quarter. Null whenever target is. */
  ratio: number | null
}

export interface QualifiedPipelineTrendResult {
  unit: MetricUnit
  points: QualifiedPipelineTrendPoint[]
}

const TRAILING_MONTHS = 12
const round1 = (n: number): number => Math.round(n * 10) / 10
const round2 = (n: number): number => Math.round(n * 100) / 100

// UTC month-key, consistent with shiftMonth's own UTC math — avoids local-TZ month boundary bugs.
function toMonthKey(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

/**
 * Qualified new-business pipeline created each month vs. that month's own
 * prorated share of the org's CM-04 targets. Deliberately bucketed by the
 * deal's created date, not closedate — this is "pipeline generated this
 * month," distinct from CM-04's own forward-looking quarterly coverage
 * ratio. Reuses CM-04's qualified-stage-cutoff heuristic and new-business
 * filter so the two metrics never drift from different definitions of
 * "qualified."
 */
export async function getQualifiedPipelineTrend(
  orgId: string,
  provider: string,
  fromMonth?: string,
  toMonth?: string
): Promise<QualifiedPipelineTrendResult> {
  const end = toMonth ?? latestClosedMonth()
  const start = fromMonth ?? shiftMonth(end, -(TRAILING_MONTHS - 1))
  const months: string[] = []
  for (let m = start; m <= end; m = shiftMonth(m, 1)) months.push(m)

  const from = new Date(monthToDateRange(start).startDate)
  const to = new Date(`${monthToDateRange(end).endDate}T23:59:59.999Z`)

  const [deals, stageDefs, org] = await Promise.all([
    dealRepository.findByCreateDateRange(orgId, provider, from, to),
    pipelineStageDefinitionRepository.findAllForOrg(orgId, provider),
    organizationsRepository.findById(orgId)
  ])

  const qualifiedKeys = resolveQualifiedStageKeys(stageDefs)
  const targetRows = cm04TargetRows(org?.settings?.cm04Targets ?? [])

  const actualByMonth = new Map<string, number>(months.map((m) => [m, 0]))
  const countByMonth = new Map<string, number>(months.map((m) => [m, 0]))

  for (const deal of deals) {
    if (!deal.pipeline || !deal.dealstage || !deal.dealCreatedAt) continue
    if (!qualifiedKeys.has(`${deal.pipeline}::${deal.dealstage}`)) continue
    if (!isNewBusinessOrUntyped(deal.type)) continue
    const month = toMonthKey(deal.dealCreatedAt)
    if (!actualByMonth.has(month)) continue
    actualByMonth.set(month, actualByMonth.get(month)! + (deal.amount ?? 0))
    countByMonth.set(month, countByMonth.get(month)! + 1)
  }

  const points: QualifiedPipelineTrendPoint[] = months.map((month) => {
    const { target } = targetForMonths(targetRows, [month])
    const actual = actualByMonth.get(month) ?? 0
    return {
      month,
      actual: round1(actual),
      qualifiedDealCount: countByMonth.get(month) ?? 0,
      target: target !== null ? round1(target) : null,
      ratio: target !== null && target > 0 ? round2(actual / target) : null
    }
  })

  return { unit: 'multiple', points }
}
