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
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['sync', provider, 'products'] })
  })
}
