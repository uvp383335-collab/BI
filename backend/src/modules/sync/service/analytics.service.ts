import { dealRepository } from '../repository/deal.repository'
import { productRepository } from '../repository/product.repository'
import { contactRepository } from '../repository/contact.repository'

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
  }
}
