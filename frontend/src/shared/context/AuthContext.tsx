import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { httpClient } from '../api/httpClient'
import { setAccessToken } from '../api/tokenStore'
import { OrganizationSummary, logoutRequest } from '../../features/auth/api/authApi'

interface AuthState {
  isAuthenticated: boolean
  isBootstrapping: boolean
  organization: OrganizationSummary | null
  setSession: (accessToken: string, organization: OrganizationSummary) => void
  clearSession: () => Promise<void>
}

const AuthContext = createContext<AuthState | undefined>(undefined)

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [organization, setOrganization] = useState<OrganizationSummary | null>(null)
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [isBootstrapping, setIsBootstrapping] = useState(true)
  const queryClient = useQueryClient()

  const setSession = useCallback(
    (accessToken: string, org: OrganizationSummary) => {
      setAccessToken(accessToken)
      setOrganization(org)
      setIsAuthenticated(true)
      // Org-scoped queries (e.g. the organizations list, integrations status) may have
      // been cached under a previous user/org in this same tab — refetch rather than
      // reuse stale data now that the session has changed.
      queryClient.invalidateQueries({ queryKey: ['organizations'] })
      queryClient.invalidateQueries({ queryKey: ['integrations'] })
    },
    [queryClient]
  )

  const clearSession = useCallback(async () => {
    await logoutRequest().catch(() => undefined)
    setAccessToken(null)
    setOrganization(null)
    setIsAuthenticated(false)
    // Drop all cached data so the next login in this tab always starts fresh.
    queryClient.clear()
  }, [queryClient])

  useEffect(() => {
    // On first load there is no in-memory access token (it isn't persisted), so
    // attempt a silent refresh using the httpOnly refresh-token cookie, if any.
    let cancelled = false
    async function bootstrap() {
      try {
        const res = await httpClient.post('/auth/refresh')
        const accessToken = res.data?.data?.accessToken
        const org = res.data?.data?.organization
        if (accessToken && !cancelled) {
          setAccessToken(accessToken)
          if (org) setOrganization(org)
          setIsAuthenticated(true)
        }
      } catch {
        // No valid session; user needs to log in.
      } finally {
        if (!cancelled) setIsBootstrapping(false)
      }
    }
    bootstrap()
    return () => {
      cancelled = true
    }
  }, [])

  const value = useMemo(
    () => ({ isAuthenticated, isBootstrapping, organization, setSession, clearSession }),
    [isAuthenticated, isBootstrapping, organization, setSession, clearSession]
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuthContext(): AuthState {
  const ctx = useContext(AuthContext)
  if (!ctx) {
    throw new Error('useAuthContext must be used within an AuthProvider')
  }
  return ctx
}
