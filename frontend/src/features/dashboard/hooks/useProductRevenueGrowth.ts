import { useMutation, useQuery } from '@tanstack/react-query'
import * as productRevenueGrowthApi from '../api/productRevenueGrowthApi'

/** Location filter dropdown's contents — cheap, so this auto-loads once QuickBooks metrics are enabled. */
export function useQuickBooksDepartments(enabled: boolean) {
  return useQuery({
    queryKey: ['metrics', 'quickbooks', 'departments'],
    queryFn: () => productRevenueGrowthApi.getQuickBooksDepartmentsRequest(),
    enabled
  })
}

/** Billing-state filter dropdown's contents — cheap, so this auto-loads once QuickBooks metrics are enabled. */
export function useQuickBooksCustomerStates(enabled: boolean) {
  return useQuery({
    queryKey: ['metrics', 'quickbooks', 'customer-states'],
    queryFn: () => productRevenueGrowthApi.getQuickBooksCustomerStatesRequest(),
    enabled
  })
}

/**
 * "Revenue growth by product" (docs/server.js §5) — a mutation, not a query:
 * this runs one report per product and can take a while, so it only fires
 * on an explicit "Load" click, never automatically on mount/filter-change.
 */
export function useProductRevenueGrowth() {
  return useMutation({
    mutationFn: (options: productRevenueGrowthApi.ProductRevenueGrowthOptions) => productRevenueGrowthApi.getProductRevenueGrowthRequest(options)
  })
}
