import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getOryonSettingsRequest, resetOryonSettingsRequest, saveOryonSettingsRequest } from '../api/oryonSettingsApi'
import { useAuthContext } from '../../../shared/context/AuthContext'

const KEY = ['oryon-settings']

export function useOryonSettings(enabled = true) {
  const { isAuthenticated } = useAuthContext()
  return useQuery({ queryKey: KEY, queryFn: getOryonSettingsRequest, enabled: isAuthenticated && enabled })
}

/** Saving or resetting changes metric values everywhere, so every cached query (dashboard included) is refetched. */
export function useSaveOryonSettings() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ section, body }: { section: string; body: unknown }) => saveOryonSettingsRequest(section, body),
    onSuccess: () => queryClient.invalidateQueries()
  })
}

export function useResetOryonSettings() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (section: string) => resetOryonSettingsRequest(section),
    onSuccess: () => queryClient.invalidateQueries()
  })
}
