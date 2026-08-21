import { dealRepository } from '../repository/deal.repository'

export interface PipelineTransition {
  fromStage: string
  toStage: string
  count: number
}

export interface PipelineProgressionFilters {
  startDate?: string
  endDate?: string
  pipeline?: string
  hubspotOwnerId?: string
}

/**
 * Computes stage-to-stage transition counts from each deal's `dealstage`
 * history, scoped to the organization. This is the only analytics computation
 * needed for the dashboard's pipeline-progression graph.
 */
export const analyticsService = {
  async getPipelineProgression(
    orgId: string,
    provider: string,
    filters: PipelineProgressionFilters
  ): Promise<PipelineTransition[]> {
    const deals = await dealRepository.findForPipelineProgression(orgId, provider, {
      pipeline: filters.pipeline,
      hubspotOwnerId: filters.hubspotOwnerId
    })

    const startDate = filters.startDate ? new Date(filters.startDate) : undefined
    const endDate = filters.endDate ? new Date(filters.endDate) : undefined
    if (endDate) endDate.setHours(23, 59, 59, 999)

    const transitionCounts = new Map<string, number>()

    for (const deal of deals) {
      const history = [...(deal.dealStageHistory || [])]
      if (history.length < 2) continue

      history.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())

      const cleanedHistory: typeof history = []
      for (const item of history) {
        if (cleanedHistory.length === 0 || cleanedHistory[cleanedHistory.length - 1].value !== item.value) {
          cleanedHistory.push(item)
        }
      }

      const firstStage = cleanedHistory[0]
      const firstStageDate = new Date(firstStage.timestamp)
      if ((!startDate || firstStageDate >= startDate) && (!endDate || firstStageDate <= endDate)) {
        const key = `${firstStage.value}__TO__${firstStage.value}`
        transitionCounts.set(key, (transitionCounts.get(key) || 0) + 1)
      }

      for (let i = 1; i < cleanedHistory.length; i++) {
        const previous = cleanedHistory[i - 1]
        const current = cleanedHistory[i]
        const transitionDate = new Date(current.timestamp)

        if (startDate && transitionDate < startDate) continue
        if (endDate && transitionDate > endDate) continue

        const key = `${previous.value}__TO__${current.value}`
        transitionCounts.set(key, (transitionCounts.get(key) || 0) + 1)
      }
    }

    return Array.from(transitionCounts.entries()).map(([key, count]) => {
      const [fromStage, toStage] = key.split('__TO__')
      return { fromStage, toStage, count }
    })
  },

  getPipelines(orgId: string, provider: string) {
    return dealRepository.distinctPipelines(orgId, provider)
  },

  getOwnerIds(orgId: string, provider: string) {
    return dealRepository.distinctOwnerIds(orgId, provider)
  }
}
