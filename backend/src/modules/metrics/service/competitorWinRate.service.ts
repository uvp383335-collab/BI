import { dealRepository } from '../../sync/repository/deal.repository'
import { pipelineStageDefinitionRepository } from '../../sync/repository/pipelineStageDefinition.repository'

const SALESFORCE = 'salesforce'

// Matched case/whitespace-insensitively against each deal's customFields[].label — this is a
// generic org-configured extra display field (Organization.settings.salesforceOpportunityExtraFields),
// NOT the dedicated competitor/competitors fields CM-03 reads (cmMetrics.service.ts's computeCM03).
// Some orgs only ever populate this one instead of configuring Settings > Salesforce > Competitor
// tracking, which leaves CM-03 with nothing to read even though the competitor name is right here.
const COMPETITOR_FIELD_LABEL = 'primary competitor'

export interface CompetitorWinRateRow {
  competitor: string
  wins: number
  losses: number
  decided: number
  winRatePct: number
}

export interface CompetitorWinRateResult {
  rows: CompetitorWinRateRow[]
}

/**
 * "Competitor win rate" — every closed (won or lost) Salesforce Opportunity
 * whose "Primary Competitor" custom field is set, grouped by that
 * competitor's name, counting how many were won vs lost against each one.
 * "Won"/"lost" are resolved against PipelineStageDefinition, same
 * won-key/closed-key convention as CM-03/campaignWonOpportunities.service.ts
 * — never a hardcoded stage name. Opportunities still open (not in a closed
 * stage) or with no competitor recorded are excluded entirely; there's no
 * "unattributed" bucket to plot on a per-competitor x-axis. All-time, no
 * date window — unlike CM-03's rolling 6-month comparison, this is a
 * straightforward "how have we done against each competitor overall."
 */
export async function getCompetitorWinRate(orgId: string): Promise<CompetitorWinRateResult> {
  const [deals, stageDefs] = await Promise.all([
    dealRepository.findAllWithCustomFields(orgId, SALESFORCE),
    pipelineStageDefinitionRepository.findAllForOrg(orgId, SALESFORCE)
  ])

  const wonKeys = new Set(stageDefs.filter((d) => d.entityType === 'deal' && d.isWon).map((d) => `${d.pipeline}::${d.rawStage}`))
  const closedKeys = new Set(stageDefs.filter((d) => d.entityType === 'deal' && d.isClosed).map((d) => `${d.pipeline}::${d.rawStage}`))

  const winsByCompetitor = new Map<string, number>()
  const lossesByCompetitor = new Map<string, number>()

  for (const deal of deals) {
    if (!deal.pipeline || !deal.dealstage) continue
    const key = `${deal.pipeline}::${deal.dealstage}`
    if (!closedKeys.has(key)) continue // only decided (won or lost) opportunities count toward a win rate

    const competitorField = deal.customFields?.find((f) => f.label?.trim().toLowerCase() === COMPETITOR_FIELD_LABEL)
    if (competitorField === undefined || competitorField.value === null || competitorField.value === undefined || competitorField.value === '') continue
    const competitor = String(competitorField.value)

    if (wonKeys.has(key)) {
      winsByCompetitor.set(competitor, (winsByCompetitor.get(competitor) ?? 0) + 1)
    } else {
      lossesByCompetitor.set(competitor, (lossesByCompetitor.get(competitor) ?? 0) + 1)
    }
  }

  const allCompetitors = new Set([...winsByCompetitor.keys(), ...lossesByCompetitor.keys()])
  const rows: CompetitorWinRateRow[] = Array.from(allCompetitors)
    .map((competitor) => {
      const wins = winsByCompetitor.get(competitor) ?? 0
      const losses = lossesByCompetitor.get(competitor) ?? 0
      const decided = wins + losses
      return { competitor, wins, losses, decided, winRatePct: decided > 0 ? Math.round((wins / decided) * 1000) / 10 : 0 }
    })
    .sort((a, b) => b.decided - a.decided)

  return { rows }
}
