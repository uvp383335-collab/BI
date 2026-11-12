import { dealRepository } from '../../sync/repository/deal.repository'

const SALESFORCE = 'salesforce'
const UNKNOWN_LEAD_SOURCE = 'Unknown'

export type OpportunitiesByLeadSourceByMonthGranularity = 'monthly' | 'quarterly' | 'yearly'

// How many calendar months one period spans, per granularity — same grain
// convention as cmMetrics.service.ts's GRANULARITY_MONTHS.
const GRANULARITY_MONTHS: Record<OpportunitiesByLeadSourceByMonthGranularity, number> = { monthly: 1, quarterly: 3, yearly: 12 }

export interface OpportunitiesByLeadSourceMonthPoint {
  periodStart: string
  count: number
}

export interface OpportunitiesByLeadSourceMonthRow {
  leadSource: string
  series: OpportunitiesByLeadSourceMonthPoint[]
}

export interface OpportunitiesByLeadSourceByMonthResult {
  leadSources: OpportunitiesByLeadSourceMonthRow[]
}

/** First month ("YYYY-MM") of the calendar-aligned period containing `date` — quarterly periods align to Jan/Apr/Jul/Oct, yearly to Jan, same alignment as cmMetrics.service.ts's periodStartOf. */
function periodStartOf(date: Date, periodMonths: number): string {
  const year = date.getUTCFullYear()
  const periodFirstMonth = Math.floor(date.getUTCMonth() / periodMonths) * periodMonths
  return `${year}-${String(periodFirstMonth + 1).padStart(2, '0')}`
}

/**
 * Dashboard chart below "Opportunities by Lead Source": a lead-source-picker
 * dropdown over one Opportunity-creation-date histogram per LeadSource, at
 * monthly/quarterly/yearly granularity (picked via buttons client-side, same
 * convention as "Funnel Conversion Trends") — same picker-over-histogram
 * pattern as "Leads by Month" (leadsByMonth.service.ts) but keyed off
 * `Opportunity.LeadSource`/`CreatedDate` instead of Lead/CampaignMember.
 * Opportunities with no LeadSource set are bucketed under "Unknown", same
 * convention as opportunitiesByLeadSource.service.ts; opportunities with no
 * dealCreatedAt are skipped since there's no period to place them in.
 * Salesforce-only.
 */
export async function getOpportunitiesByLeadSourceByMonth(
  orgId: string,
  granularity: OpportunitiesByLeadSourceByMonthGranularity = 'monthly'
): Promise<OpportunitiesByLeadSourceByMonthResult> {
  const deals = await dealRepository.findAllLeadSources(orgId, SALESFORCE)
  const periodMonths = GRANULARITY_MONTHS[granularity]

  const periodCountsBySource = new Map<string, Map<string, number>>()
  for (const deal of deals) {
    if (!deal.dealCreatedAt) continue
    const source = deal.leadSource?.trim() || UNKNOWN_LEAD_SOURCE
    const period = periodStartOf(deal.dealCreatedAt, periodMonths)
    const periodCounts = periodCountsBySource.get(source) ?? new Map<string, number>()
    periodCounts.set(period, (periodCounts.get(period) ?? 0) + 1)
    periodCountsBySource.set(source, periodCounts)
  }

  const leadSources = Array.from(periodCountsBySource.entries())
    .map(([leadSource, periodCounts]) => ({
      leadSource,
      series: Array.from(periodCounts.entries())
        .map(([periodStart, count]) => ({ periodStart, count }))
        .sort((a, b) => a.periodStart.localeCompare(b.periodStart))
    }))
    .sort((a, b) => a.leadSource.localeCompare(b.leadSource))

  return { leadSources }
}
