import { dealRepository } from '../repository/deal.repository'
import { productRepository } from '../repository/product.repository'
import { contactRepository } from '../repository/contact.repository'
import { campaignRepository } from '../repository/campaign.repository'

export const analyticsService = {
  getPipelines(orgId: string, provider: string) {
    return dealRepository.distinctPipelines(orgId, provider)
  },

  async getProducts(orgId: string, provider: string) {
    const products = await productRepository.findAllForOrg(orgId, provider)
    return products.map((product) => ({ id: product.providerRecordId, name: product.name }))
  },

  getLeadsByOwner(orgId: string, provider: string) {
    return contactRepository.countsByOwner(orgId, provider)
  },

  /**
   * CAC = channel spend / won opportunities attributed to that channel.
   * ROI = (won revenue - spend) / spend, as a percentage.
   * Mirrors salesforce-oauth-learning/server.js's computeROIByChannel.
   */
  async getMarketingROIByChannel(orgId: string, provider: string) {
    const channels = await campaignRepository.sumsByChannel(orgId, provider)
    return channels.map((channel) => ({
      channel: channel.channel,
      campaigns: channel.campaigns,
      cost: channel.cost,
      revenue: channel.wonRevenue,
      customers: channel.wonOpportunities,
      cac: channel.wonOpportunities > 0 ? channel.cost / channel.wonOpportunities : null,
      roi: channel.cost > 0 ? ((channel.wonRevenue - channel.cost) / channel.cost) * 100 : null
    }))
  }
}
