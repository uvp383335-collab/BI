import { useQuery, UseQueryResult } from '@tanstack/react-query'
import * as authApi from '../api/authApi'

export interface InvitationsListResult {
  items: any[]
  total: number
  page: number
  pageSize: number
}

export function useListInvitations({ page = 1, pageSize = 20, status, role, sort }: { page?: number; pageSize?: number; status?: string; role?: string; sort?: string }) {
  return useQuery({
    queryKey: ['invitations', page, pageSize, status, role, sort],
    queryFn: () => authApi.listInvitationsRequest({ page, pageSize, status, role: role as any, sort })
  })
}
