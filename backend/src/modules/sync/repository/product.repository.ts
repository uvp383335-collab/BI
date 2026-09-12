import { Connection, Types } from 'mongoose'
import { getProductModel } from '../model/Product.model'
import { getTenantConnection } from '../../../database/tenantConnection'

export interface ProductInput {
  providerRecordId: string
  name: string
}

/** Resolves the Product model bound to the given org's own tenant database. */
async function modelForOrg(orgId: string | Types.ObjectId) {
  const connection: Connection = await getTenantConnection(orgId.toString())
  return getProductModel(connection)
}

export const productRepository = {
  /** Upserts the product catalog — names overwrite on every sync so a rename in the CRM is reflected. */
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

  /** All synced products for a provider — the funnel filter dropdown's contents. */
  async findAllForOrg(orgId: string | Types.ObjectId, provider: string) {
    const ProductModel = await modelForOrg(orgId)
    return ProductModel.find({ orgId, provider }, { providerRecordId: 1, name: 1 }).lean()
  }
}
