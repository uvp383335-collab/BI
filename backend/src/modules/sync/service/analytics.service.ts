import { dealRepository } from '../repository/deal.repository'
import { productRepository } from '../repository/product.repository'
import { salesforceCampaignRepository } from '../repository/salesforceCampaign.repository'

export const analyticsService = {
  getPipelines(orgId: string, provider: string) {
    return dealRepository.distinctPipelines(orgId, provider)
  },

  async getProducts(orgId: string, provider: string) {
    const products = await productRepository.findAllForOrg(orgId, provider)
    return products.map((product) => ({ id: product.providerRecordId, name: product.name }))
  },

  /** Raw opportunity/deal records for the Campaigns & Opportunities browse view. */
  getOpportunities(orgId: string, provider: string, opts: { page?: number; pageSize?: number }) {
    return dealRepository.findAllPaginated(orgId, provider, opts)
  },

  /** Raw campaign records — Salesforce-only (see SalesforceCampaign.model.ts), empty for other providers. */
  getCampaigns(orgId: string, provider: string, opts: { page?: number; pageSize?: number }) {
    return salesforceCampaignRepository.findAllPaginated(orgId, provider, opts)
  }
}
