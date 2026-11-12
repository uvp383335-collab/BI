import { funnelStageEventRepository } from '../../sync/repository/funnelStageEvent.repository'
import { pipelineStageDefinitionRepository } from '../../sync/repository/pipelineStageDefinition.repository'
import { organizationsRepository } from '../../organizations/repository/organizations.repository'
import { latestClosedMonth, shiftMonth } from './revenueRollForward.service'
import { targetForMonths } from './cmMetrics.service'

const HUBSPOT = 'hubspot'
const LEAD_STAGE = 'lead'

// A full year of monthly bars — same "don't show an unreadably long or mostly-empty
// series" judgment call as the other trend charts' trailing windows (e.g.
// customerUpgradesTrend.service.ts's TRAILING_MONTHS).
const TRAILING_MONTHS = 12

const round1 = (n: number): number => Math.round(n * 10) / 10

/** Number of months in an inclusive `YYYY-MM` range — same formula as cmMetrics.service.ts's module-private monthsInRange. */
function monthsInRange(fromMonth: string, toMonth: string): number {
  const [fromYear, fromMo] = fromMonth.split('-').map(Number)
  const [toYear, toMo] = toMonth.split('-').map(Number)
  return (toYear - fromYear) * 12 + (toMo - fromMo) + 1
}

/**
 * The admin types a per-month figure in Settings (every month in the row's
 * range gets exactly that number — same UX as CM-04's targets), but
 * `targetForMonths` divides each row's `total` by the row's month count
 * (CM-08's MQL-plan convention, where the typed number is a total spread
 * across the range instead). Scale the typed value up by the row's month
 * count first so that division cancels out — same trick as
 * cmMetrics.service.ts's `cm04TargetRows`.
 */
function leadVolumeTargetRows(targets: { fromMonth: string; toMonth: string; targetMql: number }[]): { fromMonth: string; toMonth: string; total: number }[] {
  return targets.map((t) => ({ fromMonth: t.fromMonth, toMonth: t.toMonth, total: t.targetMql * monthsInRange(t.fromMonth, t.toMonth) }))
}

export interface LeadVolumeVsTargetPoint {
  /** "YYYY-MM" */
  month: string
  /** How many contacts were sitting at the Lead stage — had reached it, but not yet advanced past it — as of this month's first day. A snapshot, not an entry count. */
  leadVolume: number
  target: number | null
  /** leadVolume / target * 100 — null when no target is configured for this month. */
  ratioPct: number | null
}

export interface LeadVolumeVsTargetResult {
  points: LeadVolumeVsTargetPoint[]
  missingTargetMonths: string[]
}

/**
 * "Lead Volume vs. Target MQL" — a point-in-time snapshot (not a stage-entry
 * count, unlike every other funnel metric in cmMetrics.service.ts) of how
 * many HubSpot contacts were occupying the Lead lifecycle stage as of the
 * first day of each of the trailing 12 months, against an org-configured
 * monthly target (`Organization.settings.leadVolumeTargets` — independent
 * from CM-08's `cm08MqlTargets`, see that field's doc comment).
 *
 * "Occupying Lead" means: this contact had already reached the Lead stage by
 * that date, AND had not yet reached any stage that ranks after Lead
 * (resolved dynamically via `PipelineStageDefinition.displayOrder`, not a
 * hardcoded stage list — the same "has this record advanced past stage X"
 * idea the funnel chart already relies on, see
 * funnelStageEvent.repository.ts's getFirstStageEntries doc comment).
 * A contact who later advances past Lead stops counting from the month they
 * advanced, even though their Lead-stage FunnelStageEvent row is still in
 * the collection forever (events are append-only).
 */
export async function getLeadVolumeVsTarget(orgId: string): Promise<LeadVolumeVsTargetResult> {
  const [stageDefs, org] = await Promise.all([
    pipelineStageDefinitionRepository.findAllForOrg(orgId, HUBSPOT),
    organizationsRepository.findById(orgId)
  ])

  const leadStageDefs = stageDefs.filter((d) => d.entityType === 'lead')
  const leadDef = leadStageDefs.find((d) => d.rawStage === LEAD_STAGE)
  if (!leadDef) return { points: [], missingTargetMonths: [] }

  const laterStages = leadStageDefs.filter((d) => d.displayOrder > leadDef.displayOrder).map((d) => d.rawStage)

  const records = await funnelStageEventRepository.getFirstStageEntries(orgId, HUBSPOT, 'lead', [LEAD_STAGE, ...laterStages])

  const months = Array.from({ length: TRAILING_MONTHS }, (_, i) => shiftMonth(latestClosedMonth(), -(TRAILING_MONTHS - 1 - i)))

  const targetRows = leadVolumeTargetRows(org?.settings?.leadVolumeTargets ?? [])

  const points: LeadVolumeVsTargetPoint[] = []
  const missingTargetMonths: string[] = []

  for (const month of months) {
    const cutoff = new Date(`${month}-01T00:00:00.000Z`)

    const leadVolume = records.filter((record) => {
      const leadEnteredAt = record.firstEntered[LEAD_STAGE]
      if (!leadEnteredAt || leadEnteredAt > cutoff) return false
      return !laterStages.some((stage) => {
        const enteredAt = record.firstEntered[stage]
        return enteredAt && enteredAt <= cutoff
      })
    }).length

    const { target, missingMonths } = targetForMonths(targetRows, [month])
    if (missingMonths.length > 0) missingTargetMonths.push(month)

    points.push({
      month,
      leadVolume,
      target: target !== null ? round1(target) : null,
      ratioPct: target !== null && target > 0 ? round1((leadVolume / target) * 100) : null
    })
  }

  return { points, missingTargetMonths }
}
