import { contactRepository } from '../repository/contact.repository'
import { dealRepository } from '../repository/deal.repository'
import { productRepository } from '../repository/product.repository'
import { salesforceAccountRepository } from '../repository/salesforceAccount.repository'
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
  },

  /**
   * Raw Salesforce Contact records with their Account name resolved —
   * Salesforce-only (Leads and HubSpot contacts are excluded), empty for
   * other providers.
   */
  async getSalesforceContacts(orgId: string, provider: string, opts: { page?: number; pageSize?: number }) {
    const result = await contactRepository.findSalesforceContactsPaginated(orgId, provider, opts)
    const accountIds = [...new Set(result.items.map((contact) => contact.accountRecordId).filter((id): id is string => !!id))]
    const accounts = await salesforceAccountRepository.findNamesByIds(orgId, provider, accountIds)
    const accountNameById = new Map(accounts.map((account) => [account.providerRecordId, account.name]))

    return {
      ...result,
      items: result.items.map((contact) => ({
        ...contact,
        accountName: contact.accountRecordId ? accountNameById.get(contact.accountRecordId) : undefined
      }))
    }
  }
}
