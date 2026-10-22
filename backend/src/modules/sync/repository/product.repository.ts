import { Connection, Types } from 'mongoose'
import { getProductModel, ProductCategory, ProductBillingFrequency } from '../model/Product.model'
import { getTenantConnection } from '../../../database/tenantConnection'

export interface ProductInput {
  providerRecordId: string
  name: string
}

export interface ProductCategoryUpdate {
  providerRecordId: string
  category: ProductCategory
  /** Must be omitted/undefined unless `category === 'recurring'` — validated at the validator layer, not re-checked here. */
  billingFrequency?: ProductBillingFrequency
}

/** Resolves the Product model bound to the given org's own tenant database. */
async function modelForOrg(orgId: string | Types.ObjectId) {
  const connection: Connection = await getTenantConnection(orgId.toString())
  return getProductModel(connection)
}

export const productRepository = {
  /** Upserts the product catalog — names overwrite on every sync so a rename in the CRM is reflected. Never touches category/billingFrequency, so a user's categorization survives resync. */
  async bulkUpsert(orgId: string | Types.ObjectId, provider: string, products: ProductInput[]) {
    if (products.length === 0) return
    const ProductModel = await modelForOrg(orgId)
    const orgObjectId = new Types.ObjectId(orgId)
    const operations = products.map((product) => ({
      updateOne: {
        filter: { orgId: orgObjectId, provider, providerRecordId: product.providerRecordId },
        update: { $set: { orgId: orgObjectId, provider, ...product } },
        upsert: true
      }
    }))
    await ProductModel.bulkWrite(operations, { ordered: false })
  },

  /** All synced products for a provider — the funnel filter dropdown's contents, and the Settings product-category list. */
  async findAllForOrg(orgId: string | Types.ObjectId, provider: string) {
    const ProductModel = await modelForOrg(orgId)
    return ProductModel.find({ orgId, provider }, { providerRecordId: 1, name: 1, category: 1, billingFrequency: 1 }).lean()
  },

  /** Every `(category, billingFrequency)`-tagged product for a provider — VC-13's and VC-01/VC-02's join key against PLItemSnapshot/Invoice line items. Excludes `not_sure` since callers treat it as uncategorized. */
  async findCategorizedForOrg(orgId: string | Types.ObjectId, provider: string) {
    const ProductModel = await modelForOrg(orgId)
    return ProductModel.find(
      { orgId, provider, category: { $in: ['recurring', 'non_recurring'] } },
      { providerRecordId: 1, category: 1, billingFrequency: 1 }
    ).lean()
  },

  /** Bulk-sets category/billingFrequency for a batch of products — the Settings page's "Save" action. Only an owner/admin can call the service method that reaches this (role-gated at the route). */
  async setCategories(orgId: string | Types.ObjectId, provider: string, updates: ProductCategoryUpdate[]) {
    if (updates.length === 0) return
    const ProductModel = await modelForOrg(orgId)
    const orgObjectId = new Types.ObjectId(orgId)
    const operations = updates.map(({ providerRecordId, category, billingFrequency }) => ({
      updateOne: {
        filter: { orgId: orgObjectId, provider, providerRecordId },
        update:
          category === 'recurring' && billingFrequency
            ? { $set: { category, billingFrequency } }
            : { $set: { category }, $unset: { billingFrequency: '' } }
      }
    }))
    await ProductModel.bulkWrite(operations, { ordered: false })
  }
}
