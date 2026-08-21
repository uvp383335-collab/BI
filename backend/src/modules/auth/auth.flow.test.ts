import request from 'supertest'
import { createApp } from '../../app'
import { UserModel } from '../../modules/users/model/User.model'
import { MembershipModel } from '../../modules/organizations/model/Membership.model'

jest.mock('../../shared/utils/email', () => ({
  sendVerificationEmail: jest.fn(),
  sendInvitationEmail: jest.fn(),
  sendPasswordResetEmail: jest.fn()
}))

// eslint-disable-next-line @typescript-eslint/no-var-requires
const emailMock = require('../../shared/utils/email')

const app = createApp()

function authHeader(accessToken: string): string {
  return ['Bearer', accessToken].join(' ')
}

async function signupAndGetVerificationToken(
  email: string,
  password = 'Password123',
  organizationName = 'Acme Inc'
) {
  await request(app)
    .post('/api/v1/auth/signup')
    .send({ name: 'Test User', email, password, organizationName })
    .expect(201)
  const call = emailMock.sendVerificationEmail.mock.calls.find((c: string[]) => c[0] === email)
  return call[1] as string
}

async function verifyAndLogin(email: string, password: string) {
  const token = await signupAndGetVerificationToken(email, password)
  await request(app).get(`/api/v1/auth/verify-email?token=${token}`).expect(200)
  return request(app).post('/api/v1/auth/login').send({ email, password }).expect(200)
}

beforeEach(() => {
  emailMock.sendVerificationEmail.mockClear()
  emailMock.sendInvitationEmail.mockClear()
  emailMock.sendPasswordResetEmail.mockClear()
})

describe('Auth flows', () => {
  it('signs up a user and creates an org with owner membership', async () => {
    const res = await request(app)
      .post('/api/v1/auth/signup')
      .send({ name: 'Alice', email: 'alice@example.com', password: 'Password123', organizationName: 'Acme Inc' })
      .expect(201)

    expect(res.body.success).toBe(true)
    const user = await UserModel.findOne({ email: 'alice@example.com' })
    expect(user).not.toBeNull()
    expect(user!.status).toBe('pending_verification')

    const membership = await MembershipModel.findOne({ userId: user!._id })
    expect(membership).not.toBeNull()
    expect(membership!.role).toBe('owner')
    expect(emailMock.sendVerificationEmail).toHaveBeenCalledWith('alice@example.com', expect.any(String))
  })

  it('rejects signup with an already-registered email', async () => {
    await request(app)
      .post('/api/v1/auth/signup')
      .send({ name: 'Bob', email: 'bob@example.com', password: 'Password123', organizationName: 'Org A' })
      .expect(201)

    const res = await request(app)
      .post('/api/v1/auth/signup')
      .send({ name: 'Bob2', email: 'bob@example.com', password: 'Password123', organizationName: 'Org B' })
      .expect(409)
    expect(res.body.error.code).toBe('EMAIL_TAKEN')
  })

  it('blocks login before email verification', async () => {
    await request(app)
      .post('/api/v1/auth/signup')
      .send({ name: 'Carl', email: 'carl@example.com', password: 'Password123', organizationName: 'Org C' })
      .expect(201)

    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'carl@example.com', password: 'Password123' })
      .expect(403)
    expect(res.body.error.code).toBe('EMAIL_NOT_VERIFIED')
  })

  it('verifies email via token and allows login for a single org', async () => {
    const loginRes = await verifyAndLogin('dana@example.com', 'Password123')
    expect(loginRes.body.data.accessToken).toBeDefined()
    expect(loginRes.body.data.organization.role).toBe('owner')
  })

  it('rejects login with wrong password', async () => {
    await request(app)
      .post('/api/v1/auth/signup')
      .send({ name: 'Eve', email: 'eve@example.com', password: 'Password123', organizationName: 'Org E' })
      .expect(201)
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'eve@example.com', password: 'WrongPass123' })
      .expect(401)
    expect(res.body.error.code).toBe('INVALID_CREDENTIALS')
  })

  it('rejects verify-email with an invalid token', async () => {
    const res = await request(app).get('/api/v1/auth/verify-email?token=not-a-real-token').expect(400)
    expect(res.body.error.code).toBe('INVALID_TOKEN')
  })

  it('creates and accepts an invitation for a new user, joining the org', async () => {
    const loginRes = await verifyAndLogin('owner@example.com', 'Password123')
    const accessToken = loginRes.body.data.accessToken

    const inviteRes = await request(app)
      .post('/api/v1/invitations')
      .set('Authorization', authHeader(accessToken))
      .send({ email: 'newmember@example.com', role: 'member' })
      .expect(201)
    expect(inviteRes.body.data.invitationId).toBeDefined()

    const inviteCall = emailMock.sendInvitationEmail.mock.calls.find(
      (c: string[]) => c[0] === 'newmember@example.com'
    )
    const inviteToken = inviteCall[1] as string

    const previewRes = await request(app).get(`/api/v1/invitations/${inviteToken}`).expect(200)
    expect(previewRes.body.data.hasExistingAccount).toBe(false)

    const acceptRes = await request(app)
      .post(`/api/v1/invitations/${inviteToken}/accept`)
      .send({ password: 'NewMemberPass123', name: 'New Member' })
      .expect(200)
    expect(acceptRes.body.data.organizationId).toBeDefined()

    const newUser = await UserModel.findOne({ email: 'newmember@example.com' })
    expect(newUser).not.toBeNull()
    expect(newUser!.emailVerifiedAt).not.toBeNull()

    const membership = await MembershipModel.findOne({ userId: newUser!._id })
    expect(membership!.role).toBe('member')

    // New member can now log in directly (already verified via invitation).
    await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'newmember@example.com', password: 'NewMemberPass123' })
      .expect(200)
  })

  it('rejects accepting invitation for existing user with wrong password', async () => {
    const loginRes = await verifyAndLogin('owner2@example.com', 'Password123')

    // Existing second user account (identity check happens on password, regardless of verification).
    await request(app)
      .post('/api/v1/auth/signup')
      .send({
        name: 'Existing',
        email: 'existing@example.com',
        password: 'ExistingPass123',
        organizationName: 'OtherOrg'
      })
      .expect(201)

    await request(app)
      .post('/api/v1/invitations')
      .set('Authorization', authHeader(loginRes.body.data.accessToken))
      .send({ email: 'existing@example.com', role: 'admin' })
      .expect(201)

    const inviteCall = emailMock.sendInvitationEmail.mock.calls.find(
      (c: string[]) => c[0] === 'existing@example.com'
    )
    const inviteToken = inviteCall[1] as string

    const res = await request(app)
      .post(`/api/v1/invitations/${inviteToken}/accept`)
      .send({ password: 'WrongPassword1' })
      .expect(401)
    expect(res.body.error.code).toBe('INVALID_CREDENTIALS')
  })

  it('forgot/reset password flow updates the password and old password stops working', async () => {
    await verifyAndLogin('fiona@example.com', 'Password123')

    await request(app).post('/api/v1/auth/forgot-password').send({ email: 'fiona@example.com' }).expect(200)

    const resetCall = emailMock.sendPasswordResetEmail.mock.calls.find(
      (c: string[]) => c[0] === 'fiona@example.com'
    )
    const resetToken = resetCall[1] as string

    await request(app)
      .post('/api/v1/auth/reset-password')
      .send({ token: resetToken, password: 'BrandNewPass123' })
      .expect(200)

    await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'fiona@example.com', password: 'BrandNewPass123' })
      .expect(200)

    await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'fiona@example.com', password: 'Password123' })
      .expect(401)
  })

  it('rejects reset-password with an invalid/expired token', async () => {
    const res = await request(app)
      .post('/api/v1/auth/reset-password')
      .send({ token: 'bogus-token', password: 'SomeNewPass123' })
      .expect(400)
    expect(res.body.error.code).toBe('INVALID_TOKEN')
  })
})
