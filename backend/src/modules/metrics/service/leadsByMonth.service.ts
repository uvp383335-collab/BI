import { contactRepository } from '../../sync/repository/contact.repository'
import { salesforceCampaignRepository } from '../../sync/repository/salesforceCampaign.repository'

const SALESFORCE = 'salesforce'

export interface LeadsByMonthPoint {
  month: string
  count: number
}

export interface LeadsByMonthCampaignRow {
  campaignId: string
  campaignName: string
  series: LeadsByMonthPoint[]
}

export interface LeadsByMonthByCampaignResult {
  campaigns: LeadsByMonthCampaignRow[]
}

function toMonthKey(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`
}

/**
 * Dashboard's "Leads by Month" chart: a campaign-picker dropdown over one
 * Salesforce Lead-creation-date histogram per campaign. Every campaign is
 * included (even ones with no leads yet) so the dropdown always lists the
 * full set — the chart itself degrades to an empty series rather than the
 * campaign disappearing from the list, unlike the won-opportunities bar
 * chart above, which drops zero-value campaigns since it has no dropdown
 * to hide behind. A lead can be a CampaignMember of more than one campaign
 * (contactRepository.findCampaignAttributedLeads), so one lead can
 * contribute to more than one campaign's series.
 */
export async function getLeadsByMonthByCampaign(orgId: string): Promise<LeadsByMonthByCampaignResult> {
  const [leads, campaigns] = await Promise.all([
    contactRepository.findCampaignAttributedLeads(orgId, SALESFORCE),
    salesforceCampaignRepository.findAll(orgId, SALESFORCE)
  ])

  const monthCountsByCampaign = new Map<string, Map<string, number>>()
  for (const lead of leads) {
    if (!lead.leadCreatedAt || !lead.campaignIds?.length) continue
    const month = toMonthKey(lead.leadCreatedAt)
    for (const campaignId of lead.campaignIds) {
      const monthCounts = monthCountsByCampaign.get(campaignId) ?? new Map<string, number>()
      monthCounts.set(month, (monthCounts.get(month) ?? 0) + 1)
      monthCountsByCampaign.set(campaignId, monthCounts)
    }
  }

  const campaignRows = campaigns
    .map((campaign) => {
      const monthCounts = monthCountsByCampaign.get(campaign.providerRecordId) ?? new Map<string, number>()
      const series = Array.from(monthCounts.entries())
        .map(([month, count]) => ({ month, count }))
        .sort((a, b) => a.month.localeCompare(b.month))
      return {
        campaignId: campaign.providerRecordId,
        campaignName: campaign.name ?? campaign.providerRecordId,
        series
      }
    })
    .sort((a, b) => a.campaignName.localeCompare(b.campaignName))

  return { campaigns: campaignRows }
}
