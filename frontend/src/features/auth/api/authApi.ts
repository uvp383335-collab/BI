import { httpClient } from '../../../shared/api/httpClient'
import { MembershipRole } from '../../../entities/user/types'

interface ApiEnvelope<T> {
  success: boolean
  data: T
}

export interface OrganizationSummary {
  id: string
  name: string
  slug: string
  role: MembershipRole
}

export interface LoginResult {
  requiresOrgSelection: boolean
  accessToken?: string
  pendingToken?: string
  organization?: OrganizationSummary
  organizations?: OrganizationSummary[]
}

export async function signupRequest(payload: {
  name: string
  email: string
  password: string
  organizationName: string
}) {
  const res = await httpClient.post<ApiEnvelope<{ userId: string; organizationId: string; slug: string }>>(
    '/auth/signup',
    payload
  )
  return res.data.data
}

export async function loginRequest(payload: { email: string; password: string }): Promise<LoginResult> {
  const res = await httpClient.post<ApiEnvelope<LoginResult>>('/auth/login', payload)
  return res.data.data
}

export async function selectOrgRequest(orgId: string, pendingToken?: string) {
  const headers: Record<string, string> = {}
  if (pendingToken) {
    headers.Authorization = `Bearer ${pendingToken}`
  }
  const res = await httpClient.post<ApiEnvelope<{ accessToken: string; organization: OrganizationSummary }>>(
    '/auth/select-org',
    { orgId },
    { headers: Object.keys(headers).length ? headers : undefined }
  )
  return res.data.data
}

export async function getOrganizationsRequest(): Promise<OrganizationSummary[]> {
  const res = await httpClient.get<ApiEnvelope<OrganizationSummary[]>>('/auth/organizations')
  return res.data.data
}

export async function switchOrgRequest(orgId: string) {
  const res = await httpClient.post<ApiEnvelope<{ accessToken: string; organization: OrganizationSummary }>>(
    '/auth/switch-org',
    { orgId }
  )
  return res.data.data
}

export async function createOrganizationRequest(name: string) {
  const res = await httpClient.post<ApiEnvelope<{ accessToken: string; organization: OrganizationSummary }>>(
    '/organizations',
    { name }
  )
  return res.data.data
}

export async function logoutRequest() {
  await httpClient.post('/auth/logout')
}

export async function forgotPasswordRequest(email: string) {
  const res = await httpClient.post<ApiEnvelope<{ message: string }>>('/auth/forgot-password', { email })
  return res.data.data
}

export async function resetPasswordRequest(token: string, password: string) {
  const res = await httpClient.post<ApiEnvelope<{ message: string }>>('/auth/reset-password', { token, password })
  return res.data.data
}

export async function verifyEmailRequest(token: string) {
  const res = await httpClient.get<ApiEnvelope<{ verified: boolean }>>(
    `/auth/verify-email?token=${encodeURIComponent(token)}`
  )
  return res.data.data
}

export async function resendVerificationRequest(email: string) {
  const res = await httpClient.post<ApiEnvelope<{ message: string }>>('/auth/resend-verification', { email })
  return res.data.data
}

export async function createInvitationRequest(payload: { email: string; role: MembershipRole }) {
  const res = await httpClient.post<ApiEnvelope<{ invitationId: string }>>('/invitations', payload)
  return res.data.data
}

export async function listInvitationsRequest(params: { page?: number; pageSize?: number; status?: string; role?: MembershipRole; sort?: string } = {}) {
  const query = new URLSearchParams()
  if (params.page) query.set('page', String(params.page))
  if (params.pageSize) query.set('pageSize', String(params.pageSize))
  if (params.status) query.set('status', params.status)
  if (params.role) query.set('role', params.role)
  if (params.sort) query.set('sort', params.sort)
  const res = await httpClient.get<ApiEnvelope<{ items: any[]; total: number; page: number; pageSize: number }>>(
    `/invitations?${query.toString()}`
  )
  return res.data.data
}

export async function previewInvitationRequest(token: string) {
  const res = await httpClient.get<
    ApiEnvelope<{ email: string; role: MembershipRole; organizationName: string; hasExistingAccount: boolean }>
  >(`/invitations/${encodeURIComponent(token)}`)
  return res.data.data
}

export async function acceptInvitationRequest(token: string, password: string, name?: string) {
  const res = await httpClient.post<ApiEnvelope<{ userId: string; organizationId: string }>>(
    `/invitations/${encodeURIComponent(token)}/accept`,
    { password, name }
  )
  return res.data.data
}
