import { contactRepository } from '../repository/contact.repository'
import { dealRepository } from '../repository/deal.repository'
import { funnelStageEventRepository } from '../repository/funnelStageEvent.repository'
import { pipelineStageDefinitionRepository } from '../repository/pipelineStageDefinition.repository'
import { CONTACTS_PIPELINE } from './sync.service'

export interface FunnelStage {
  rawStage: string
  label: string
  count: number
  isClosed: boolean
  isWon: boolean
}

export interface FunnelChartData {
  pipeline: string
  totalEntered: number
  stages: FunnelStage[]
}

export interface FunnelsResponse {
  leadStage: FunnelChartData
  dealStage: FunnelChartData
  leadToDeal: FunnelChartData
}

export const funnelService = {
  /**
   * Builds all 3 dashboard funnels from FunnelStageEvent + PipelineStageDefinition
   * (the lead and deal stage funnels) plus Deal.contactIds (the lead-to-deal
   * conversion funnel). Per-provider by design — see docs/funnel-normalization-design.md:
   * stages are the CRM's own raw values/order, never mapped onto a canonical enum.
   *
   * `from`/`to` scope every funnel to the cohort of records whose *first* stage
   * event falls in that window (see getCohortRecordIds) — each stage is then
   * counted across that cohort's full history, not just in-range events. A
   * naive "count in-range events per stage" would break monotonicity (a record
   * can reach a later stage inside the window while an earlier stage happened
   * before it), which is exactly what let a win-rate stat read over 100%.
   */
  async getFunnels(
    orgId: string,
    provider: string,
    filters: { pipeline?: string; from?: Date; to?: Date }
  ): Promise<FunnelsResponse> {
    const dateRange = { from: filters.from, to: filters.to }
    const hasDateRange = !!filters.from || !!filters.to

    const [leadCohortIds, dealCohortIds] = hasDateRange
      ? await Promise.all([
          funnelStageEventRepository.getCohortRecordIds(orgId, provider, 'lead', dateRange),
          funnelStageEventRepository.getCohortRecordIds(orgId, provider, 'deal', dateRange)
        ])
      : [undefined, undefined]

    const [leadCounts, dealCounts, allDefs, totalLeads, dealsWithContacts] = await Promise.all([
      funnelStageEventRepository.getStageMembershipCounts(orgId, provider, 'lead', undefined, leadCohortIds),
      funnelStageEventRepository.getStageMembershipCounts(orgId, provider, 'deal', filters.pipeline, dealCohortIds),
      pipelineStageDefinitionRepository.findAllForOrg(orgId, provider),
      hasDateRange ? Promise.resolve(undefined) : contactRepository.count(orgId, provider),
      dealRepository.findContactAssociationsForFunnel(orgId, provider, filters.pipeline)
    ])

    const buildFunnel = (
      entityType: 'lead' | 'deal',
      counts: typeof leadCounts,
      pipeline: string
    ): FunnelChartData => {
      const defs = allDefs
        .filter((def) => def.entityType === entityType && def.pipeline === pipeline)
        .sort((a, b) => a.displayOrder - b.displayOrder)
      const countByStage = new Map(
        counts.filter((count) => count.pipeline === pipeline).map((count) => [count.rawStage, count.count])
      )
      const stages: FunnelStage[] = defs.map((def) => ({
        rawStage: def.rawStage,
        label: def.label,
        count: countByStage.get(def.rawStage) ?? 0,
        isClosed: def.isClosed,
        isWon: def.isWon
      }))
      return { pipeline, totalEntered: stages[0]?.count ?? 0, stages }
    }

    const leadStage = buildFunnel('lead', leadCounts, CONTACTS_PIPELINE)

    // No pipeline filter yet and no deal data synced at all -> nothing to resolve a pipeline from.
    const resolvedDealPipeline = filters.pipeline ?? dealCounts[0]?.pipeline ?? ''
    const dealStage = buildFunnel('deal', dealCounts, resolvedDealPipeline)

    const wonKeys = new Set(
      allDefs.filter((def) => def.entityType === 'deal' && def.isWon).map((def) => `${def.pipeline}::${def.rawStage}`)
    )
    // Scoping to a cohort only restricts which leads count, never which deal
    // rows are read — a lead's conversion/win is tracked regardless of when it
    // happened, so `dealsWithContacts` (all-time) is walked the same either way.
    const cohort = leadCohortIds ? new Set(leadCohortIds) : undefined
    const leadsConverted = new Set<string>()
    const leadsWithWonDeal = new Set<string>()
    for (const deal of dealsWithContacts) {
      for (const contactId of deal.contactIds) {
        if (cohort && !cohort.has(contactId)) continue
        leadsConverted.add(contactId)
        if (deal.dealstage && wonKeys.has(`${deal.pipeline}::${deal.dealstage}`)) {
          leadsWithWonDeal.add(contactId)
        }
      }
    }

    const resolvedTotalLeads = leadCohortIds ? leadCohortIds.length : (totalLeads ?? 0)

    const leadToDeal: FunnelChartData = {
      pipeline: 'all',
      totalEntered: resolvedTotalLeads,
      stages: [
        { rawStage: 'total_leads', label: 'Total Leads', count: resolvedTotalLeads, isClosed: false, isWon: false },
        { rawStage: 'has_deal', label: 'Converted to Deal', count: leadsConverted.size, isClosed: false, isWon: false },
        { rawStage: 'deal_won', label: 'Deal Won', count: leadsWithWonDeal.size, isClosed: true, isWon: true }
      ]
    }

    return { leadStage, dealStage, leadToDeal }
  }
}
