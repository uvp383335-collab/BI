import { dealRepository } from '../repository/deal.repository'

export const analyticsService = {
  getPipelines(orgId: string, provider: string) {
    return dealRepository.distinctPipelines(orgId, provider)
  },

  getOwnerIds(orgId: string, provider: string) {
    return dealRepository.distinctOwnerIds(orgId, provider)
  }
}
