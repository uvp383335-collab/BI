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

// Mock the Salesforce network calls the same way, returning the same org id
// across different "connect" attempts to simulate the same Salesforce org
// being used twice.
jest.mock('./service/salesforce.service', () => ({
  SalesforceService: {
    getAuthorizationUrl: jest.fn(() => 'https://login.salesforce.com/services/oauth2/authorize?mock=1'),
    exchangeCodeForToken: jest.fn(async () => ({
      accessToken: 'mock-sf-access-token',
      refreshToken: 'mock-sf-refresh-token',
      instanceUrl: 'https://shared-org.my.salesforce.com',
      externalAccountId: 'shared-org-000000000001',
      scope: ['api', 'refresh_token'],
      expiresIn: 7200
    }))
  }
}))

// Mock the QuickBooks network calls the same way, returning the same realmId
// across different "connect" attempts to simulate the same company being
// used twice. (realmId itself comes from the callback query string, not the
// token exchange, so it's supplied per-request in the tests below.)
jest.mock('./service/quickbooks.service', () => ({
  QuickBooksService: {
    getAuthorizationUrl: jest.fn(() => 'https://appcenter.intuit.com/connect/oauth2?mock=1'),
    exchangeCodeForToken: jest.fn(async () => ({
      accessToken: 'mock-qb-access-token',
      refreshToken: 'mock-qb-refresh-token',
      expiresIn: 3600
    }))
  },
  QUICKBOOKS_SCOPES: ['com.intuit.quickbooks.accounting']
}))

// eslint-disable-next-line @typescript-eslint/no-var-requires
const emailMock = require('../../shared/utils/email')
import { signIntegrationState } from '../../shared/utils/jwt'
import { HubSpotService } from './service/hubspot.service'
import { SalesforceService } from './service/salesforce.service'
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
    expect(res1.headers.location).toContain('/dashboard?status=success')

    // Reconnecting the same org to the same hub_id must still succeed (not a collision).
    const res2 = await request(app).get(`/api/v1/integrations/hubspot/callback?code=abc2&state=${state}`)
    expect(res2.status).toBe(302)
    expect(res2.headers.location).toContain('/dashboard?status=success')
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
    expect(res2.headers.location).toContain('/dashboard?status=success')
  })
})

describe('Salesforce collision detection', () => {
  it('allows connecting the same Salesforce org id twice for the same org (reconnect), stored in that org tenant db', async () => {
    const loginRes = await signupVerifyLogin('sfowner1@example.com', 'SF Org One')
    const orgId = loginRes.body.data.organization.id
    const userId = userIdFromAccessToken(loginRes.body.data.accessToken)
    const state = signIntegrationState({ userId, orgId, provider: 'salesforce', codeVerifier: 'mock-verifier' })

    const res1 = await request(app).get(`/api/v1/integrations/salesforce/callback?code=abc&state=${state}`)
    expect(res1.status).toBe(302)
    expect(res1.headers.location).toContain('/dashboard?status=success')

    const res2 = await request(app).get(`/api/v1/integrations/salesforce/callback?code=abc2&state=${state}`)
    expect(res2.status).toBe(302)
    expect(res2.headers.location).toContain('/dashboard?status=success')
  })

  it('blocks connecting a Salesforce org already claimed by another org the user belongs to, offering a switch', async () => {
    const loginRes = await signupVerifyLogin('sfowner2@example.com', 'SF Org Two')
    const accessToken = loginRes.body.data.accessToken
    const orgAId = loginRes.body.data.organization.id
    const userId = userIdFromAccessToken(accessToken)

    const stateA = signIntegrationState({ userId, orgId: orgAId, provider: 'salesforce', codeVerifier: 'mock-verifier' })
    await request(app).get(`/api/v1/integrations/salesforce/callback?code=abc&state=${stateA}`).expect(302)

    const createRes = await request(app)
      .post('/api/v1/organizations')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ name: 'SF Org Three' })
      .expect(201)
    const orgBId = createRes.body.data.organization.id

    const stateB = signIntegrationState({ userId, orgId: orgBId, provider: 'salesforce', codeVerifier: 'mock-verifier' })
    const res = await request(app).get(`/api/v1/integrations/salesforce/callback?code=abc&state=${stateB}`)
    expect(res.status).toBe(302)
    expect(res.headers.location).toContain('reason=already_connected_switch')
    expect(res.headers.location).toContain('SF+Org+Two')
  })

  it('permanently locks an org to its first Salesforce org id: disconnecting and reconnecting a different one is blocked', async () => {
    const loginRes = await signupVerifyLogin('sfowner3@example.com', 'SF Org Four')
    const accessToken = loginRes.body.data.accessToken
    const orgId = loginRes.body.data.organization.id
    const userId = userIdFromAccessToken(accessToken)

    const state1 = signIntegrationState({ userId, orgId, provider: 'salesforce', codeVerifier: 'mock-verifier' })
    await request(app).get(`/api/v1/integrations/salesforce/callback?code=abc&state=${state1}`).expect(302)

    await request(app)
      .delete('/api/v1/integrations/salesforce/disconnect')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200)

    ;(SalesforceService.exchangeCodeForToken as jest.Mock).mockResolvedValueOnce({
      accessToken: 'mock-sf-access-token-2',
      refreshToken: 'mock-sf-refresh-token-2',
      instanceUrl: 'https://different-org.my.salesforce.com',
      externalAccountId: 'different-org-000000000002',
      scope: ['api', 'refresh_token'],
      expiresIn: 7200
    })

    const state2 = signIntegrationState({ userId, orgId, provider: 'salesforce', codeVerifier: 'mock-verifier' })
    const res = await request(app).get(`/api/v1/integrations/salesforce/callback?code=xyz&state=${state2}`)
    expect(res.status).toBe(302)
    expect(res.headers.location).toContain('reason=org_locked_to_account')

    const state3 = signIntegrationState({ userId, orgId, provider: 'salesforce', codeVerifier: 'mock-verifier' })
    const res2 = await request(app).get(`/api/v1/integrations/salesforce/callback?code=abc3&state=${state3}`)
    expect(res2.status).toBe(302)
    expect(res2.headers.location).toContain('/dashboard?status=success')
  })

  it('rejects a Salesforce callback whose state is missing the PKCE code verifier', async () => {
    const loginRes = await signupVerifyLogin('sfowner4@example.com', 'SF Org Five')
    const orgId = loginRes.body.data.organization.id
    const userId = userIdFromAccessToken(loginRes.body.data.accessToken)
    const state = signIntegrationState({ userId, orgId, provider: 'salesforce' })

    const res = await request(app).get(`/api/v1/integrations/salesforce/callback?code=abc&state=${state}`)
    expect(res.status).toBe(302)
    expect(res.headers.location).toContain('/connect?provider=salesforce&status=error')
  })
})

describe('QuickBooks collision detection (connect-only, no sync)', () => {
  it('allows connecting the same QuickBooks realmId twice for the same org (reconnect), stored in that org tenant db', async () => {
    const loginRes = await signupVerifyLogin('qbowner1@example.com', 'QB Org One')
    const orgId = loginRes.body.data.organization.id
    const userId = userIdFromAccessToken(loginRes.body.data.accessToken)
    const state = signIntegrationState({ userId, orgId, provider: 'quickbooks' })

    const res1 = await request(app).get(`/api/v1/integrations/quickbooks/callback?code=abc&state=${state}&realmId=shared-realm-001`)
    expect(res1.status).toBe(302)
    expect(res1.headers.location).toContain('/dashboard?status=success')

    const res2 = await request(app).get(`/api/v1/integrations/quickbooks/callback?code=abc2&state=${state}&realmId=shared-realm-001`)
    expect(res2.status).toBe(302)
    expect(res2.headers.location).toContain('/dashboard?status=success')
  })

  it('blocks connecting a QuickBooks company already claimed by another org the user belongs to, offering a switch', async () => {
    const loginRes = await signupVerifyLogin('qbowner2@example.com', 'QB Org Two')
    const accessToken = loginRes.body.data.accessToken
    const orgAId = loginRes.body.data.organization.id
    const userId = userIdFromAccessToken(accessToken)

    const stateA = signIntegrationState({ userId, orgId: orgAId, provider: 'quickbooks' })
    await request(app).get(`/api/v1/integrations/quickbooks/callback?code=abc&state=${stateA}&realmId=shared-realm-002`).expect(302)

    const createRes = await request(app)
      .post('/api/v1/organizations')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ name: 'QB Org Three' })
      .expect(201)
    const orgBId = createRes.body.data.organization.id

    const stateB = signIntegrationState({ userId, orgId: orgBId, provider: 'quickbooks' })
    const res = await request(app).get(`/api/v1/integrations/quickbooks/callback?code=abc&state=${stateB}&realmId=shared-realm-002`)
    expect(res.status).toBe(302)
    expect(res.headers.location).toContain('reason=already_connected_switch')
    expect(res.headers.location).toContain('QB+Org+Two')
  })

  it('permanently locks an org to its first QuickBooks realmId: disconnecting and reconnecting a different one is blocked', async () => {
    const loginRes = await signupVerifyLogin('qbowner3@example.com', 'QB Org Four')
    const accessToken = loginRes.body.data.accessToken
    const orgId = loginRes.body.data.organization.id
    const userId = userIdFromAccessToken(accessToken)

    const state1 = signIntegrationState({ userId, orgId, provider: 'quickbooks' })
    await request(app).get(`/api/v1/integrations/quickbooks/callback?code=abc&state=${state1}&realmId=realm-original`).expect(302)

    await request(app)
      .delete('/api/v1/integrations/quickbooks/disconnect')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200)

    const state2 = signIntegrationState({ userId, orgId, provider: 'quickbooks' })
    const res = await request(app).get(`/api/v1/integrations/quickbooks/callback?code=xyz&state=${state2}&realmId=realm-different`)
    expect(res.status).toBe(302)
    expect(res.headers.location).toContain('reason=org_locked_to_account')

    const state3 = signIntegrationState({ userId, orgId, provider: 'quickbooks' })
    const res2 = await request(app).get(`/api/v1/integrations/quickbooks/callback?code=abc3&state=${state3}&realmId=realm-original`)
    expect(res2.status).toBe(302)
    expect(res2.headers.location).toContain('/dashboard?status=success')
  })

  it('rejects a QuickBooks callback missing realmId', async () => {
    const loginRes = await signupVerifyLogin('qbowner4@example.com', 'QB Org Five')
    const orgId = loginRes.body.data.organization.id
    const userId = userIdFromAccessToken(loginRes.body.data.accessToken)
    const state = signIntegrationState({ userId, orgId, provider: 'quickbooks' })

    const res = await request(app).get(`/api/v1/integrations/quickbooks/callback?code=abc&state=${state}`)
    expect(res.status).toBe(302)
    expect(res.headers.location).toContain('/connect?provider=quickbooks&status=error')
  })
})
