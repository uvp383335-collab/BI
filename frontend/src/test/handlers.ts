import React from 'react'
import { http, HttpResponse } from 'msw'

const BASE = 'http://localhost:4000/api/v1'

export const handlers = [
  http.post(`${BASE}/auth/signup`, async () => {
    return HttpResponse.json({ success: true, data: { userId: 'u1', organizationId: 'o1', slug: 'acme' } }, { status: 201 })
  }),

  http.post(`${BASE}/auth/login`, async ({ request }) => {
    const body = (await request.json()) as { email: string; password: string }
    if (body.email === 'wrong@example.com') {
      return HttpResponse.json(
        { success: false, error: { message: 'Invalid email or password', code: 'INVALID_CREDENTIALS' } },
        { status: 401 }
      )
    }
    if (body.email === 'multi@example.com') {
      return HttpResponse.json({
        success: true,
        data: {
          requiresOrgSelection: true,
          pendingToken: 'pending-token-123',
          organizations: [
            { id: 'org1', name: 'Org One', slug: 'org-one', role: 'owner' },
            { id: 'org2', name: 'Org Two', slug: 'org-two', role: 'member' }
          ]
        }
      })
    }
    return HttpResponse.json({
      success: true,
      data: {
        requiresOrgSelection: false,
        accessToken: 'access-token-abc',
        organization: { id: 'org1', name: 'Solo Org', slug: 'solo-org', role: 'owner' }
      }
    })
  }),

  http.post(`${BASE}/auth/select-org`, async ({ request }) => {
    const body = (await request.json()) as { orgId: string }
    return HttpResponse.json({
      success: true,
      data: {
        accessToken: 'access-token-selected',
        organization: { id: body.orgId, name: 'Org One', slug: 'org-one', role: 'owner' }
      }
    })
  }),

  http.post(`${BASE}/auth/refresh`, async () => {
    return HttpResponse.json(
      { success: false, error: { message: 'No refresh token', code: 'MISSING_REFRESH_TOKEN' } },
      { status: 401 }
    )
  }),

  http.post(`${BASE}/auth/logout`, async () => {
    return HttpResponse.json({ success: true, data: { loggedOut: true } })
  }),

  http.post(`${BASE}/auth/forgot-password`, async () => {
    return HttpResponse.json({ success: true, data: { message: 'If that email is registered, a reset link has been sent.' } })
  }),

  http.post(`${BASE}/auth/reset-password`, async ({ request }) => {
    const body = (await request.json()) as { token: string }
    if (body.token === 'bad-token') {
      return HttpResponse.json(
        { success: false, error: { message: 'Invalid or expired token', code: 'INVALID_TOKEN' } },
        { status: 400 }
      )
    }
    return HttpResponse.json({ success: true, data: { message: 'Password has been reset successfully.' } })
  }),

  http.get(`${BASE}/auth/verify-email`, ({ request }) => {
    const url = new URL(request.url)
    const token = url.searchParams.get('token')
    if (token === 'bad-token') {
      return HttpResponse.json(
        { success: false, error: { message: 'Invalid or expired verification link', code: 'INVALID_TOKEN' } },
        { status: 400 }
      )
    }
    return HttpResponse.json({ success: true, data: { verified: true } })
  }),

  http.get(`${BASE}/invitations/:token`, ({ params }) => {
    if (params.token === 'bad-invite') {
      return HttpResponse.json(
        { success: false, error: { message: 'Invalid or expired invitation', code: 'INVALID_TOKEN' } },
        { status: 400 }
      )
    }
    if (params.token === 'existing-user-invite') {
      return HttpResponse.json({
        success: true,
        data: { email: 'existing@example.com', role: 'admin', organizationName: 'Acme Inc', hasExistingAccount: true }
      })
    }
    return HttpResponse.json({
      success: true,
      data: { email: 'newmember@example.com', role: 'member', organizationName: 'Acme Inc', hasExistingAccount: false }
    })
  }),

  http.get(`${BASE}/invitations`, ({ request }) => {
    const u = new URL(request.url)
    const page = parseInt(u.searchParams.get('page') || '1', 10)
    const pageSize = parseInt(u.searchParams.get('pageSize') || '20', 10)
    const status = u.searchParams.get('status')
    const role = u.searchParams.get('role')

    // Build some fake invitations
    const all = Array.from({ length: 36 }).map((_, i) => ({
      _id: `inv${i + 1}`,
      email: `user${i + 1}@example.com`,
      role: i % 3 === 0 ? 'owner' : i % 3 === 1 ? 'admin' : 'member',
      invitedBy: { name: 'Alice Admin', email: 'alice@example.com' },
      status: i % 4 === 0 ? 'accepted' : 'pending',
      createdAt: new Date(Date.now() - i * 3600 * 1000).toISOString(),
      expiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000 - i * 3600 * 1000).toISOString(),
      acceptedAt: i % 4 === 0 ? new Date(Date.now() - i * 1800 * 1000).toISOString() : null
    }))

    let filtered = all
    if (status) filtered = filtered.filter((x) => x.status === status)
    if (role) filtered = filtered.filter((x) => x.role === role)

    const start = (page - 1) * pageSize
    const items = filtered.slice(start, start + pageSize)
    return HttpResponse.json({ success: true, data: { items, total: filtered.length, page, pageSize } })
  }),

  http.post(`${BASE}/invitations`, async ({ request }) => {
    const body = (await request.json()) as { email: string; role: string }
    return HttpResponse.json({ success: true, data: { invitationId: 'inv1' } })
  }),

  http.post(`${BASE}/invitations/:token/accept`, async ({ request, params }) => {
    const body = (await request.json()) as { password: string }
    if (params.token === 'existing-user-invite' && body.password !== 'CorrectPass123') {
      return HttpResponse.json(
        { success: false, error: { message: 'Incorrect password', code: 'INVALID_CREDENTIALS' } },
        { status: 401 }
      )
    }
    return HttpResponse.json({ success: true, data: { userId: 'u2', organizationId: 'org1' } })
  }),

  http.get(`${BASE}/auth/organizations`, () => {
    return HttpResponse.json({
      success: true,
      data: [
        { id: 'org1', name: 'Org One', slug: 'org-one', role: 'owner' },
        { id: 'org2', name: 'Org Two', slug: 'org-two', role: 'member' }
      ]
    })
  }),

  http.post(`${BASE}/auth/switch-org`, async ({ request }) => {
    const body = await request.json() as { orgId: string }
    return HttpResponse.json({
      success: true,
      data: { accessToken: 'access-token-switched', organization: { id: body.orgId, name: 'Switched Org', slug: 'switched', role: 'member' } }
    })
  }),

  http.get(`${BASE}/integrations/status`, () => {
    return HttpResponse.json({
      success: true,
      data: {
        hubspot: { connected: false },
        salesforce: { connected: false, comingSoon: true },
        quickbooks: { connected: false, comingSoon: true }
      }
    })
  }),

  http.get(`${BASE}/integrations/:provider/authorize`, () => {
    return HttpResponse.json({ success: true, data: { authUrl: 'https://app.hubspot.com/oauth/authorize?mock=1' } })
  }),

  http.delete(`${BASE}/integrations/:provider/disconnect`, () => {
    return HttpResponse.json({ success: true, data: { disconnected: true } })
  }),

  http.get(`${BASE}/sync/:provider/status`, () => {
    return HttpResponse.json({ success: true, data: null })
  })
]
