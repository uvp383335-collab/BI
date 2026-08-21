import request from 'supertest'
import { createApp } from '../../app'

jest.mock('../../shared/utils/email', () => ({
  sendVerificationEmail: jest.fn(),
  sendInvitationEmail: jest.fn(),
  sendPasswordResetEmail: jest.fn()
}))

// Mock the HubSpot network calls so the OAuth callback can be exercised
// deterministically, returning the same hub_id across different "connect"
// attempts to simulate the same HubSpot portal being used twice.
jest.mock('./service/hubspot.service', () => ({
  HubSpotService: {
    getAuthorizationUrl: jest.fn(() => 'https://app.hubspot.com/oauth/authorize?mock=1'),
    exchangeCodeForToken: jest.fn(async () => ({
      accessToken: 'mock-access-token',
      refreshToken: 'mock-refresh-token',
      expiresIn: 3600
    })),
    getTokenInfo: jest.fn(async () => ({ hubId: 'shared-hub-123', hubDomain: 'shared.hubspot.com', scopes: ['oauth'] }))
  }
}))

// eslint-disable-next-line @typescript-eslint/no-var-requires
const emailMock = require('../../shared/utils/email')
import { signIntegrationState } from '../../shared/utils/jwt'
import { HubSpotService } from './service/hubspot.service'
import jwt from 'jsonwebtoken'

const app = createApp()

function userIdFromAccessToken(accessToken: string): string {
  const decoded = jwt.decode(accessToken) as { sub: string }
  return decoded.sub
}

async function signupVerifyLogin(email: string, organizationName: string) {
  await request(app)
    .post('/api/v1/auth/signup')
    .send({ name: 'Test User', email, password: 'Password123', organizationName })
    .expect(201)
  const call = emailMock.sendVerificationEmail.mock.calls.find((c: string[]) => c[0] === email)
  const token = call[1] as string
  await request(app).get(`/api/v1/auth/verify-email?token=${token}`).expect(200)
  return request(app).post('/api/v1/auth/login').send({ email, password: 'Password123' }).expect(200)
}

beforeEach(() => {
  emailMock.sendVerificationEmail.mockClear()
})

describe('Multi-tenant database isolation + HubSpot collision detection', () => {
  it('creates a new organization for an already-logged-in user with its own tenant db', async () => {
    const loginRes = await signupVerifyLogin('owner1@example.com', 'Org One')
    const accessToken = loginRes.body.data.accessToken

    const createRes = await request(app)
      .post('/api/v1/organizations')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ name: 'Org Two' })
      .expect(201)

    expect(createRes.body.data.organization.role).toBe('owner')
    expect(createRes.body.data.organization.name).toBe('Org Two')
    expect(createRes.body.data.accessToken).toBeDefined()

    const orgsRes = await request(app)
      .get('/api/v1/auth/organizations')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200)
    expect(orgsRes.body.data.map((o: { name: string }) => o.name).sort()).toEqual(['Org One', 'Org Two'])
  })

  it('allows connecting the same HubSpot hub_id twice for the same org (reconnect), stored in that org tenant db', async () => {
    const loginRes = await signupVerifyLogin('owner2@example.com', 'Org Three')
    const orgId = loginRes.body.data.organization.id
    const userId = userIdFromAccessToken(loginRes.body.data.accessToken)
    const state = signIntegrationState({ userId, orgId, provider: 'hubspot' })

    const res1 = await request(app).get(`/api/v1/integrations/hubspot/callback?code=abc&state=${state}`)
    expect(res1.status).toBe(302)
    expect(res1.headers.location).toContain('/dashboard/hubspot?status=success')

    // Reconnecting the same org to the same hub_id must still succeed (not a collision).
    const res2 = await request(app).get(`/api/v1/integrations/hubspot/callback?code=abc2&state=${state}`)
    expect(res2.status).toBe(302)
    expect(res2.headers.location).toContain('/dashboard/hubspot?status=success')
  })

  it('blocks connecting a HubSpot account already claimed by another org the user belongs to, offering a switch', async () => {
    const loginRes = await signupVerifyLogin('owner3@example.com', 'Org Four')
    const accessToken = loginRes.body.data.accessToken
    const orgAId = loginRes.body.data.organization.id
    const userId = userIdFromAccessToken(accessToken)

    // Connect Org Four to the shared hub_id first.
    const stateA = signIntegrationState({ userId, orgId: orgAId, provider: 'hubspot' })
    await request(app).get(`/api/v1/integrations/hubspot/callback?code=abc&state=${stateA}`).expect(302)

    // Same user creates a second org and tries to connect the SAME hub_id.
    const createRes = await request(app)
      .post('/api/v1/organizations')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ name: 'Org Five' })
      .expect(201)
    const orgBId = createRes.body.data.organization.id

    const stateB = signIntegrationState({ userId, orgId: orgBId, provider: 'hubspot' })
    const res = await request(app).get(`/api/v1/integrations/hubspot/callback?code=abc&state=${stateB}`)
    expect(res.status).toBe(302)
    expect(res.headers.location).toContain('reason=already_connected_switch')
    expect(res.headers.location).toContain('Org+Four')
  })

  it('blocks connecting a HubSpot account already claimed by another org the user does NOT belong to, without leaking org identity', async () => {
    const org1Login = await signupVerifyLogin('owner4@example.com', 'Org Six')
    const org1Id = org1Login.body.data.organization.id
    const user1Id = userIdFromAccessToken(org1Login.body.data.accessToken)
    const stateOrg1 = signIntegrationState({ userId: user1Id, orgId: org1Id, provider: 'hubspot' })
    await request(app).get(`/api/v1/integrations/hubspot/callback?code=abc&state=${stateOrg1}`).expect(302)

    const org2Login = await signupVerifyLogin('stranger@example.com', 'Org Seven')
    const org2Id = org2Login.body.data.organization.id
    const user2Id = userIdFromAccessToken(org2Login.body.data.accessToken)
    const stateOrg2 = signIntegrationState({ userId: user2Id, orgId: org2Id, provider: 'hubspot' })
    const res = await request(app).get(`/api/v1/integrations/hubspot/callback?code=abc&state=${stateOrg2}`)

    expect(res.status).toBe(302)
    expect(res.headers.location).toContain('reason=already_connected_request_access')
    expect(res.headers.location).not.toContain('Org+Six')
  })

  it('permanently locks an org to its first HubSpot account: disconnecting and reconnecting a different hub_id is blocked', async () => {
    const loginRes = await signupVerifyLogin('owner5@example.com', 'Org Eight')
    const accessToken = loginRes.body.data.accessToken
    const orgId = loginRes.body.data.organization.id
    const userId = userIdFromAccessToken(accessToken)

    const state1 = signIntegrationState({ userId, orgId, provider: 'hubspot' })
    await request(app).get(`/api/v1/integrations/hubspot/callback?code=abc&state=${state1}`).expect(302)

    await request(app)
      .delete('/api/v1/integrations/hubspot/disconnect')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200)

    // A different HubSpot account (different hub_id) tries to connect to the same org.
    ;(HubSpotService.getTokenInfo as jest.Mock).mockResolvedValueOnce({
      hubId: 'different-hub-456',
      hubDomain: 'different.hubspot.com',
      scopes: ['oauth']
    })

    const state2 = signIntegrationState({ userId, orgId, provider: 'hubspot' })
    const res = await request(app).get(`/api/v1/integrations/hubspot/callback?code=xyz&state=${state2}`)

    expect(res.status).toBe(302)
    expect(res.headers.location).toContain('reason=org_locked_to_account')

    // Reconnecting the ORIGINAL hub_id after disconnect must still work.
    const state3 = signIntegrationState({ userId, orgId, provider: 'hubspot' })
    const res2 = await request(app).get(`/api/v1/integrations/hubspot/callback?code=abc3&state=${state3}`)
    expect(res2.status).toBe(302)
    expect(res2.headers.location).toContain('/dashboard/hubspot?status=success')
  })
})
