import { httpClient } from '../../../shared/api/httpClient'
import { IntegrationProvider } from './integrationsApi'

interface ApiEnvelope<T> {
  success: boolean
  data: T
}

export type ProductCategory = 'recurring' | 'non_recurring' | 'not_sure'
export type ProductBillingFrequency = 'monthly' | 'quarterly' | 'yearly'

/** One synced product with its Settings-page categorization — distinct from syncApi's `Product` (the funnel filter dropdown's `{id, name}`), which carries no category. */
export interface CategorizedProduct {
  providerRecordId: string
  name: string
  category: ProductCategory
  billingFrequency?: ProductBillingFrequency
}

export interface ProductCategoryUpdate {
  providerRecordId: string
  category: ProductCategory
  /** Only allowed when category is 'recurring' — omit/clear otherwise. */
  billingFrequency?: ProductBillingFrequency
}

export async function getProductCategoriesRequest(provider: IntegrationProvider): Promise<CategorizedProduct[]> {
  const res = await httpClient.get<ApiEnvelope<{ products: CategorizedProduct[] }>>(`/sync/${provider}/products`)
  return res.data.data.products
}

export async function updateProductCategoriesRequest(provider: IntegrationProvider, updates: ProductCategoryUpdate[]): Promise<CategorizedProduct[]> {
  const res = await httpClient.patch<ApiEnvelope<{ products: CategorizedProduct[] }>>(`/sync/${provider}/products/categories`, { updates })
  return res.data.data.products
}
