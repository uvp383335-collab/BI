import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import * as productCategoriesApi from '../api/productCategoriesApi'
import { ProductCategoryUpdate } from '../api/productCategoriesApi'
import { IntegrationProvider } from '../api/integrationsApi'
import { useAuthContext } from '../../../shared/context/AuthContext'

/** `enabled` should be `status?.[provider]?.connected` — products only exist once that provider has synced. */
export function useProductCategories(provider: IntegrationProvider, enabled: boolean) {
  const { isAuthenticated } = useAuthContext()
  return useQuery({
    queryKey: ['sync', provider, 'products'],
    queryFn: () => productCategoriesApi.getProductCategoriesRequest(provider),
    enabled: isAuthenticated && enabled
  })
}

export function useUpdateProductCategories(provider: IntegrationProvider) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (updates: ProductCategoryUpdate[]) => productCategoriesApi.updateProductCategoriesRequest(provider, updates),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sync', provider, 'products'] })
      // Every dashboard chart keyed on product recurring/billing-frequency category (customer
      // upgrades/downgrades/churn/retention, recurring-revenue-trend, product-revenue-growth, ...)
      // lives under this shared ['metrics', ...] prefix — without this, a chart fetched before a
      // category was saved here keeps showing its old "not eligible"/"not computable" result until
      // a hard page reload, since those queries have no other reason to know this changed.
      queryClient.invalidateQueries({ queryKey: ['metrics'] })
    }
  })
}
