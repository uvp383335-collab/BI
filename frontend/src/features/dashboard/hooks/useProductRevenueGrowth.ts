import { useQuery } from '@tanstack/react-query'
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

/** Recurring-vs-non-recurring revenue trend bar chart's contents — cheap and storage-backed, so this auto-loads like the dropdowns above. */
export function useRecurringRevenueTrend(enabled: boolean, granularity: productRevenueGrowthApi.RecurringRevenueTrendGranularity = 'quarterly') {
  return useQuery({
    queryKey: ['metrics', 'quickbooks', 'recurring-revenue-trend', granularity],
    queryFn: () => productRevenueGrowthApi.getRecurringRevenueTrendRequest(granularity),
    enabled
  })
}

/** G&A % of Revenue bar chart's contents — cheap and storage-backed (PLSnapshot/PLMonthlySnapshot), auto-loads like every other metric. */
export function useGAndAExpenseTrend(enabled: boolean, granularity: productRevenueGrowthApi.GAndAExpenseTrendGranularity = 'quarterly') {
  return useQuery({
    queryKey: ['metrics', 'quickbooks', 'ga-expense-trend', granularity],
    queryFn: () => productRevenueGrowthApi.getGAndAExpenseTrendRequest(granularity),
    enabled
  })
}

/** Customer Acquisition Cost bar chart's contents — cheap and storage-backed (PLMonthlySnapshot + Invoice), auto-loads like every other metric. No granularity arg: the window size is a Settings-configured duration. */
export function useCACTrend(enabled: boolean) {
  return useQuery({
    queryKey: ['metrics', 'quickbooks', 'cac-trend'],
    queryFn: productRevenueGrowthApi.getCACTrendRequest,
    enabled
  })
}

/** New-customers-by-month bar chart's contents — cheap and storage-backed (reads Invoice directly), so this auto-loads like the dropdowns above. `itemId` narrows "new" to customers new to that specific product. */
export function useNewCustomersTrend(enabled: boolean, fromYear?: string, itemId?: string) {
  return useQuery({
    queryKey: ['metrics', 'quickbooks', 'new-customers-trend', fromYear, itemId],
    queryFn: () => productRevenueGrowthApi.getNewCustomersTrendRequest(fromYear, itemId),
    enabled
  })
}

/**
 * Customer upgrades/downgrades/churn/retention (GRR/NRR) bar charts' shared
 * contents — cheap and storage-backed, so this auto-loads like the
 * dropdowns above. `itemId` omitted/empty means "All products" (a valid
 * selection in its own right for the retention card — blends every
 * eligible recurring product), not "nothing selected yet," so this must
 * NOT gate on `!!itemId` the way it used to.
 */
export function useCustomerUpgradesTrend(enabled: boolean, itemId?: string, granularity: productRevenueGrowthApi.CustomerUpgradesTrendGranularity = 'monthly') {
  return useQuery({
    queryKey: ['metrics', 'quickbooks', 'customer-upgrades-trend', itemId, granularity],
    queryFn: () => productRevenueGrowthApi.getCustomerUpgradesTrendRequest(itemId, granularity),
    enabled
  })
}

/**
 * "Revenue growth by product" (docs/server.js §5) — this runs one P&L
 * report per product against QuickBooks and can take a while, but auto-loads
 * like every other metric on this dashboard rather than waiting for a manual
 * "Load" click. Re-fetches whenever `options` changes (From year/location/
 * state filters), same as the other filterable trend queries above.
 */
export function useProductRevenueGrowth(enabled: boolean, options: productRevenueGrowthApi.ProductRevenueGrowthOptions) {
  return useQuery({
    queryKey: ['metrics', 'quickbooks', 'product-revenue-growth', options.fromYear, options.department, options.state],
    queryFn: () => productRevenueGrowthApi.getProductRevenueGrowthRequest(options),
    enabled
  })
}
