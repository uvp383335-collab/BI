import { dealRepository } from '../../sync/repository/deal.repository'
import { pipelineStageDefinitionRepository } from '../../sync/repository/pipelineStageDefinition.repository'
import { salesforceCampaignRepository } from '../../sync/repository/salesforceCampaign.repository'

const SALESFORCE = 'salesforce'
const round2 = (n: number): number => Math.round(n * 100) / 100

export interface CampaignRoiRow {
  campaignId: string
  campaignName: string
  wonAmount: number
  actualCost: number
  roi: number
}

export interface CampaignRoiResult {
  rows: CampaignRoiRow[]
}

/**
 * Dashboard chart below "Opportunities Won by Campaign": ROI per Salesforce
 * Campaign — closed-won Opportunity amount attributed to the campaign,
 * divided by the campaign's own `ActualCost`. "Won" is resolved against
 * PipelineStageDefinition, same convention as CampaignWonOpportunities and
 * CM-03/04/05 — never a hardcoded stage name, and never Salesforce's own
 * Campaign rollup fields (amountWonOpportunities etc.), which depend on an
 * org having Campaign Influence enabled. Campaigns with no ActualCost set
 * (or a zero cost, which would make ROI undefined) are excluded entirely —
 * there's no "cost" to divide by, not a value to default to 0. Salesforce-only.
 */
export async function getCampaignRoi(orgId: string): Promise<CampaignRoiResult> {
  const [deals, stageDefs, campaigns] = await Promise.all([
    dealRepository.findCampaignAttributedDeals(orgId, SALESFORCE),
    pipelineStageDefinitionRepository.findAllForOrg(orgId, SALESFORCE),
    salesforceCampaignRepository.findAll(orgId, SALESFORCE)
  ])

  const wonKeys = new Set(stageDefs.filter((d) => d.entityType === 'deal' && d.isWon).map((d) => `${d.pipeline}::${d.rawStage}`))

  const wonAmountByCampaign = new Map<string, number>()
  for (const deal of deals) {
    if (!deal.campaignId || !deal.pipeline || !deal.dealstage) continue
    if (!wonKeys.has(`${deal.pipeline}::${deal.dealstage}`)) continue
    wonAmountByCampaign.set(deal.campaignId, (wonAmountByCampaign.get(deal.campaignId) ?? 0) + (deal.amount ?? 0))
  }

  const rows = campaigns
    .filter((c) => c.actualCost != null && c.actualCost > 0)
    .map((c) => {
      const actualCost = c.actualCost as number
      const wonAmount = wonAmountByCampaign.get(c.providerRecordId) ?? 0
      return {
        campaignId: c.providerRecordId,
        campaignName: c.name ?? c.providerRecordId,
        wonAmount: round2(wonAmount),
        actualCost: round2(actualCost),
        roi: round2(wonAmount / actualCost)
      }
    })
    .sort((a, b) => b.roi - a.roi)

  return { rows }
}
