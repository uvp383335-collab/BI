import { httpClient } from '../../../shared/api/httpClient'

interface ApiEnvelope<T> {
  success: boolean
  data: T
}

export interface MonthlyRevenueGrowthPoint {
  month: string
  revenue: number
  revenueGrowthPct: number | null
}

export interface ProductRevenueGrowthProduct {
  id: string
  name: string
  months: MonthlyRevenueGrowthPoint[]
}

export interface ProductRevenueGrowthFailure {
  id: string
  name: string
  message: string
}

export interface ProductRevenueGrowthResult {
  products: ProductRevenueGrowthProduct[]
  failedProducts: ProductRevenueGrowthFailure[]
  message?: string
}

export interface QuickBooksDepartmentOption {
  id: string
  name: string
}

export interface ProductRevenueGrowthOptions {
  fromYear?: string
  department?: string
  state?: string
}

/**
 * Live, on-demand — this runs one Profit & Loss report per product/service
 * (docs/server.js §5) and can take a while for a company with many products,
 * same as the prototype's own "Load Product Revenue Growth" button.
 */
export async function getProductRevenueGrowthRequest(options: ProductRevenueGrowthOptions): Promise<ProductRevenueGrowthResult> {
  const res = await httpClient.get<ApiEnvelope<ProductRevenueGrowthResult>>('/metrics/quickbooks/product-revenue-growth', { params: options })
  return res.data.data
}

export async function getQuickBooksDepartmentsRequest(): Promise<QuickBooksDepartmentOption[]> {
  const res = await httpClient.get<ApiEnvelope<QuickBooksDepartmentOption[]>>('/metrics/quickbooks/departments')
  return res.data.data
}

export async function getQuickBooksCustomerStatesRequest(): Promise<string[]> {
  const res = await httpClient.get<ApiEnvelope<string[]>>('/metrics/quickbooks/customer-states')
  return res.data.data
}
