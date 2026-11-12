import { dealRepository } from '../../sync/repository/deal.repository'

const SALESFORCE = 'salesforce'
const UNKNOWN_LEAD_SOURCE = 'Unknown'

export interface OpportunitiesByLeadSourceRow {
  leadSource: string
  count: number
}

export interface OpportunitiesByLeadSourceResult {
  rows: OpportunitiesByLeadSourceRow[]
}

/**
 * Dashboard chart below "Leads by Month": every Salesforce Opportunity,
 * grouped by `Opportunity.LeadSource` (the "Additional Information" picklist
 * on the opportunity record). Opportunities with no LeadSource set are
 * bucketed under "Unknown" rather than dropped, so the chart's total always
 * matches the org's total opportunity count — unlike "Opportunities Won by
 * Campaign", which has no such bucket because it has no x-axis category to
 * hold unattributed deals. Salesforce-only: LeadSource isn't synced for
 * HubSpot deals.
 */
export async function getOpportunitiesByLeadSource(orgId: string): Promise<OpportunitiesByLeadSourceResult> {
  const deals = await dealRepository.findAllLeadSources(orgId, SALESFORCE)

  const countBySource = new Map<string, number>()
  for (const deal of deals) {
    const source = deal.leadSource?.trim() || UNKNOWN_LEAD_SOURCE
    countBySource.set(source, (countBySource.get(source) ?? 0) + 1)
  }

  const rows = Array.from(countBySource.entries())
    .map(([leadSource, count]) => ({ leadSource, count }))
    .sort((a, b) => b.count - a.count)

  return { rows }
}
