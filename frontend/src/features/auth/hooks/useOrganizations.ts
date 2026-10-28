import { useQuery } from '@tanstack/react-query'
import * as authApi from '../api/authApi'
import { useAuthContext } from '../../../shared/context/AuthContext'

export function useOrganizations() {
  const { isAuthenticated } = useAuthContext()
  return useQuery({
    queryKey: ['organizations'],
    queryFn: authApi.getOrganizationsRequest,
    // Only fetch once a session actually exists — avoids racing the access token
    // being attached, and prevents a stale/errored cache entry from a previous
    // session in this tab from suppressing the dropdown.
    enabled: isAuthenticated,
    staleTime: 1000 * 60 * 5,
    // Always re-check on mount so switching users/orgs in the same tab (or a
    // fresh login right after logout) reliably reflects the current membership list.
    refetchOnMount: 'always'
  })
}
