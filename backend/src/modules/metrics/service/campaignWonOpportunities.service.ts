import { dealRepository } from '../../sync/repository/deal.repository'
import { pipelineStageDefinitionRepository } from '../../sync/repository/pipelineStageDefinition.repository'
import { salesforceCampaignRepository } from '../../sync/repository/salesforceCampaign.repository'

const SALESFORCE = 'salesforce'
const round1 = (n: number): number => Math.round(n * 10) / 10

export interface CampaignWonOpportunitiesRow {
  campaignId: string
  campaignName: string
  wonCount: number
  wonAmount: number
}

export interface CampaignWonOpportunitiesResult {
  rows: CampaignWonOpportunitiesRow[]
}

/**
 * Dashboard chart below "Pipeline Coverage Trend": every closed-won Salesforce
 * Opportunity attributed to a Campaign (`Opportunity.CampaignId`), grouped by
 * campaign — the chart toggles between opportunity count and won $ amount per
 * campaign. Salesforce-only: Campaign is a Salesforce-only object (see
 * SalesforceCampaign.model.ts), there's no HubSpot equivalent to blend in.
 * "Won" is resolved against PipelineStageDefinition, same convention as
 * CM-03/04/05 — never a hardcoded stage name. Opportunities with no
 * CampaignId are excluded; there's no "Unattributed" bucket to plot on a
 * per-campaign x-axis.
 */
export async function getCampaignWonOpportunities(orgId: string): Promise<CampaignWonOpportunitiesResult> {
  const [deals, stageDefs, campaigns] = await Promise.all([
    dealRepository.findCampaignAttributedDeals(orgId, SALESFORCE),
    pipelineStageDefinitionRepository.findAllForOrg(orgId, SALESFORCE),
    salesforceCampaignRepository.findAll(orgId, SALESFORCE)
  ])

  const wonKeys = new Set(stageDefs.filter((d) => d.entityType === 'deal' && d.isWon).map((d) => `${d.pipeline}::${d.rawStage}`))
  const campaignNameById = new Map(campaigns.map((c) => [c.providerRecordId, c.name ?? c.providerRecordId]))

  const wonCountByCampaign = new Map<string, number>()
  const wonAmountByCampaign = new Map<string, number>()

  for (const deal of deals) {
    if (!deal.campaignId || !deal.pipeline || !deal.dealstage) continue
    if (!wonKeys.has(`${deal.pipeline}::${deal.dealstage}`)) continue
    wonCountByCampaign.set(deal.campaignId, (wonCountByCampaign.get(deal.campaignId) ?? 0) + 1)
    wonAmountByCampaign.set(deal.campaignId, (wonAmountByCampaign.get(deal.campaignId) ?? 0) + (deal.amount ?? 0))
  }

  const rows = Array.from(wonCountByCampaign.keys())
    .map((campaignId) => ({
      campaignId,
      campaignName: campaignNameById.get(campaignId) ?? campaignId,
      wonCount: wonCountByCampaign.get(campaignId) ?? 0,
      wonAmount: round1(wonAmountByCampaign.get(campaignId) ?? 0)
    }))
    .sort((a, b) => b.wonCount - a.wonCount)

  return { rows }
}

export interface CampaignWonOpportunitiesDetailDeal {
  dealId: string
  dealName: string | null
  campaignId: string
  campaignName: string
  pipeline: string
  dealstage: string
  amount: number
  closeDate: string | null
}

export interface CampaignWonOpportunitiesDetailResult {
  rows: CampaignWonOpportunitiesRow[]
  /** Every closed-won Opportunity behind the rows above — sums to rows[].wonCount/wonAmount per campaign exactly, same source query as getCampaignWonOpportunities with a wider field projection. */
  deals: CampaignWonOpportunitiesDetailDeal[]
}

/**
 * Record-level backing data for "Opportunities Won by Campaign" — every
 * closed-won Opportunity attributed to a campaign, one row per deal, for the
 * chart's "export to Excel" verification button. Mirrors
 * getCampaignWonOpportunities' own won/campaign-attribution logic exactly
 * (same stage-definition "won" check, same CampaignId requirement) so the
 * exported deal list always reconciles against the chart's own numbers.
 */
export async function getCampaignWonOpportunitiesDetail(orgId: string): Promise<CampaignWonOpportunitiesDetailResult> {
  const [deals, stageDefs, campaigns] = await Promise.all([
    dealRepository.findCampaignAttributedDealDetail(orgId, SALESFORCE),
    pipelineStageDefinitionRepository.findAllForOrg(orgId, SALESFORCE),
    salesforceCampaignRepository.findAll(orgId, SALESFORCE)
  ])

  const wonKeys = new Set(stageDefs.filter((d) => d.entityType === 'deal' && d.isWon).map((d) => `${d.pipeline}::${d.rawStage}`))
  const campaignNameById = new Map(campaigns.map((c) => [c.providerRecordId, c.name ?? c.providerRecordId]))

  const wonCountByCampaign = new Map<string, number>()
  const wonAmountByCampaign = new Map<string, number>()
  const wonDeals: CampaignWonOpportunitiesDetailDeal[] = []

  for (const deal of deals) {
    if (!deal.campaignId || !deal.pipeline || !deal.dealstage) continue
    if (!wonKeys.has(`${deal.pipeline}::${deal.dealstage}`)) continue
    wonCountByCampaign.set(deal.campaignId, (wonCountByCampaign.get(deal.campaignId) ?? 0) + 1)
    wonAmountByCampaign.set(deal.campaignId, (wonAmountByCampaign.get(deal.campaignId) ?? 0) + (deal.amount ?? 0))
    wonDeals.push({
      dealId: deal.providerRecordId,
      dealName: deal.dealname ?? null,
      campaignId: deal.campaignId,
      campaignName: campaignNameById.get(deal.campaignId) ?? deal.campaignId,
      pipeline: deal.pipeline,
      dealstage: deal.dealstage,
      amount: deal.amount ?? 0,
      closeDate: deal.closedate ? deal.closedate.toISOString().slice(0, 10) : null
    })
  }

  const rows = Array.from(wonCountByCampaign.keys())
    .map((campaignId) => ({
      campaignId,
      campaignName: campaignNameById.get(campaignId) ?? campaignId,
      wonCount: wonCountByCampaign.get(campaignId) ?? 0,
      wonAmount: round1(wonAmountByCampaign.get(campaignId) ?? 0)
    }))
    .sort((a, b) => b.wonCount - a.wonCount)

  wonDeals.sort((a, b) => a.campaignName.localeCompare(b.campaignName) || (a.closeDate ?? '').localeCompare(b.closeDate ?? ''))

  return { rows, deals: wonDeals }
}
