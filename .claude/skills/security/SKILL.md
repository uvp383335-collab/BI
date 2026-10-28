---
name: security
description: Design, implement, review, and harden security for the React + TypeScript + Node.js + MongoDB multi-tenant SaaS application. Use this skill whenever working on authentication, authorization, tenant isolation, sessions, JWTs, OAuth, passwords, API security, input validation, NoSQL injection, XSS, CSRF, CORS, secrets, encryption, file uploads, webhooks, rate limiting, logging, dependencies, infrastructure, or security reviews.
---

# Security Development Standards

## 1. Core Security Principles

Security is a system-wide responsibility.

Always prioritize:

1. Authentication
2. Authorization
3. Tenant isolation
4. Input validation
5. Data protection
6. Secret management
7. Secure API design
8. Secure frontend behavior
9. Dependency security
10. Logging and monitoring

Never rely on frontend behavior as a security boundary.

Never trust client-provided identity, organization, role, permission, or ownership information.

The backend must independently enforce security.

---

# 2. Security Model

The application's security flow should conceptually be:

Request
  ↓
HTTPS
  ↓
Authentication
  ↓
User Identity
  ↓
Tenant Membership
  ↓
Tenant Context
  ↓
Permission
  ↓
Resource Ownership
  ↓
Business Logic
  ↓
Tenant-Scoped Database Access

Every protected request should pass through the appropriate parts of this flow.

---

# 3. Authentication vs Authorization

Keep authentication and authorization separate.

Authentication answers:

"Who is this user?"

Authorization answers:

"What is this user allowed to do?"

A valid access token does not automatically mean the user can access every organization or resource.

---

# 4. Authentication

Authentication must:

- Verify credentials.
- Verify token signatures.
- Verify expiration.
- Validate issuer/audience where applicable.
- Establish trusted user identity.
- Establish appropriate session state.
- Handle logout/revocation according to the authentication architecture.

Never trust decoded JWT payloads without signature verification.

---

# 5. JWT

If JWT is used:

Verify:

- Signature
- Algorithm
- Expiration
- Issuer
- Audience
- Required claims

Do not use:

jwt.decode()

as a substitute for:

jwt.verify()

Do not accept arbitrary signing algorithms.

Do not blindly trust:

userId
organizationId
role
permissions

from a token without considering whether the claims are still authoritative.

---

# 6. JWT Claims

Keep tokens minimal.

Only include claims that are genuinely required.

Avoid putting large authorization objects into tokens.

Remember:

JWT contents are encoded, not inherently secret.

Do not store sensitive information in JWT payloads merely because the token is signed.

---

# 7. Token Expiration

Access tokens should have appropriate expiration.

Short-lived access tokens generally reduce the impact of token theft.

Refresh tokens should have their own lifecycle.

The exact expiration should follow the application's security and product requirements.

Do not create extremely long-lived access tokens without a clear security justification.

---

# 8. Refresh Tokens

Refresh tokens require stronger protection than access tokens.

Consider:

- Secure storage
- Rotation
- Expiration
- Revocation
- Reuse detection
- Device/session tracking

Never log refresh tokens.

Do not expose refresh tokens unnecessarily to JavaScript.

---

# 9. Token Storage

Choose token storage based on the application's threat model.

For browser applications, consider secure cookie-based authentication where appropriate.

If tokens are stored in browser-accessible storage, understand the XSS implications.

Never store:

- Passwords
- Client secrets
- Private keys

in browser storage.

---

# 10. Cookies

If authentication uses cookies, configure appropriate attributes.

Consider:

HttpOnly
Secure
SameSite

Example conceptual configuration:

{
  httpOnly: true,
  secure: true,
  sameSite: "lax"
}

The correct `SameSite` policy depends on the application's architecture.

---

# 11. CSRF

If authentication relies on cookies, consider CSRF protection.

Potential protections include:

- SameSite cookies
- CSRF tokens
- Origin validation
- Referer validation where appropriate

Do not assume CORS alone prevents CSRF.

---

# 12. CORS

CORS controls browser cross-origin behavior.

It is not an authentication mechanism.

Avoid production configurations such as:

Access-Control-Allow-Origin: *

for authenticated applications unless there is a deliberate reason.

Prefer explicitly allowed origins.

Do not reflect arbitrary origins back to clients.

---

# 13. HTTPS

Sensitive traffic must use HTTPS.

Protect:

- Login
- Signup
- Password reset
- API requests
- OAuth callbacks
- Token exchange
- Webhooks
- File uploads

Never send authentication credentials over plain HTTP in production.

---

# 14. HSTS

Consider HTTP Strict Transport Security for production applications.

HSTS helps browsers prefer HTTPS after receiving the policy.

Configure it carefully, especially when subdomains and preload requirements are involved.

---

# 15. Password Storage

Never store plaintext passwords.

Never encrypt passwords as a replacement for hashing.

Use a reputable password hashing algorithm/library.

Examples include:

Argon2id
bcrypt

Use a library maintained by the ecosystem.

Do not implement password hashing yourself.

---

# 16. Password Policy

Password requirements should balance security and usability.

Consider:

- Minimum length
- Compromised-password checks
- Rate limiting
- Password reset
- Account lockout/risk controls

Do not rely solely on arbitrary complexity requirements.

---

# 17. Password Reset

Password reset tokens must be:

- Cryptographically random
- Expiring
- Single-use
- Stored securely
- Invalidated after use

Do not use predictable values.

Do not include passwords in reset URLs or logs.

Avoid revealing whether an email address exists.

---

# 18. Account Enumeration

Be careful with responses such as:

"This email does not exist."

For authentication-related operations, prefer generic responses such as:

"If an account exists, we have sent instructions."

This reduces account enumeration.

---

# 19. Brute Force Protection

Protect:

- Login
- Password reset
- OTP
- Invitation acceptance
- OAuth initiation where appropriate

Use:

- Rate limiting
- Progressive delays
- Temporary lockouts where appropriate
- Risk-based controls

Avoid permanent lockouts that can be abused for denial of service.

---

# 20. Multi-Tenant Security

Tenant isolation is a critical security boundary.

For every tenant-owned operation:

Authentication
  ↓
Organization membership
  ↓
Permission
  ↓
Tenant-scoped resource access

Never trust:

req.body.organizationId
req.query.organizationId
req.params.organizationId
localStorage.organizationId

as proof of authorization.

---

# 21. Tenant IDOR Prevention

Prevent insecure direct object reference vulnerabilities.

Unsafe:

GET /reports/:reportId

with:

Report.findById(reportId)

when reports belong to tenants.

Prefer:

Report.findOne({
  _id: reportId,
  organizationId
})

The same principle applies to:

- Users
- Projects
- Reports
- Dashboards
- Files
- Integrations
- Memberships
- Exports

---

# 22. Authorization

Authorization should verify:

- User identity
- Tenant membership
- Membership status
- Role/permission
- Resource ownership
- Requested operation

Do not assume that being authenticated means being authorized.

---

# 23. RBAC

Use role-based access control where appropriate.

Example:

Owner
Admin
Member
Viewer

Roles should map to permissions.

Avoid scattering role checks across the application.

---

# 24. Permission-Based Authorization

Prefer explicit permissions for sensitive operations.

Examples:

reports:read
reports:create
reports:update
reports:delete

members:invite
members:update
members:remove

integrations:manage

This makes authorization easier to reason about.

---

# 25. Backend Authorization

The backend must enforce authorization.

Frontend code such as:

if (hasPermission("reports:delete")) {
  showDeleteButton();
}

only controls UI behavior.

A malicious client can call:

DELETE /api/reports/123

directly.

The backend must reject unauthorized requests.

---

# 26. Resource Ownership

Authorization should validate the resource relationship.

Example:

User belongs to Organization A.

Report belongs to Organization B.

Even if the user has:

reports:read

they must not be able to read Organization B's report.

Permission and resource ownership are separate checks.

---

# 27. Mass Assignment

Never blindly persist request bodies.

Unsafe:

Model.create(req.body);

Unsafe:

Model.updateOne(
  filter,
  req.body
);

Attackers may attempt to modify:

role
organizationId
ownerId
permissions
isAdmin
subscription
status

Explicitly map allowed fields.

---

# 28. Input Validation

Validate every untrusted input.

Validate:

- Request body
- Query parameters
- Path parameters
- Headers
- Cookies
- File metadata
- Webhook payloads
- External API responses

Use schema validation.

---

# 29. NoSQL Injection

Never allow arbitrary MongoDB operators from users.

Be especially careful with:

$gt
$gte
$lt
$lte
$ne
$in
$nin
$regex
$where
$expr

Unsafe:

Model.find({
  email: req.body.email
});

if arbitrary objects can reach the query.

Transform and validate user input before constructing MongoDB queries.

---

# 30. Query Allowlisting

Only expose supported filters.

Example:

Allowed:

status
createdFrom
createdTo

Do not allow:

- Arbitrary MongoDB field names
- Arbitrary operators
- Arbitrary aggregation stages

This significantly reduces attack surface.

---

# 31. Prototype Pollution

Be careful with untrusted objects and deep merges.

Avoid blindly merging:

req.body

into internal objects.

Be particularly careful with:

__proto__
constructor
prototype

Use well-maintained validation and object-handling libraries.

---

# 32. XSS

React escapes normal JSX output by default.

Still avoid:

dangerouslySetInnerHTML

unless required.

If raw HTML must be rendered:

1. Sanitize it.
2. Restrict allowed tags/attributes.
3. Validate the source.
4. Avoid script-capable content.

Never render arbitrary user HTML.

---

# 33. Stored XSS

User-generated content stored in MongoDB can become dangerous when rendered later.

Examples:

- Organization descriptions
- Report names
- Comments
- Notes
- Dashboard content

Validate/sanitize appropriately at the rendering boundary.

Do not assume stored data is safe simply because it came from your database.

---

# 34. Reflected XSS

Do not insert query parameters directly into HTML.

Be careful with:

- Search terms
- URL parameters
- Error messages
- Redirect parameters

React's standard rendering is safer than raw HTML manipulation.

---

# 35. DOM-Based XSS

Avoid unsafe DOM APIs such as:

element.innerHTML = userInput

unless content is properly sanitized.

Prefer React rendering and safe DOM APIs.

---

# 36. Content Security Policy

Consider Content Security Policy for production web applications.

CSP can reduce the impact of certain XSS vulnerabilities.

Start with a policy compatible with the application's architecture.

Do not deploy an overly restrictive CSP without testing legitimate scripts, styles, fonts, analytics, and integrations.

---

# 37. Security Headers

Consider appropriate security headers such as:

- Content-Security-Policy
- Strict-Transport-Security
- X-Content-Type-Options
- Referrer-Policy
- Permissions-Policy
- frame-ancestors through CSP

Use the project's existing security middleware where available.

---

# 38. Clickjacking

Prevent unauthorized embedding where appropriate.

Use:

CSP frame-ancestors

or:

X-Frame-Options

depending on browser/application requirements.

Do not break legitimate iframe integrations accidentally.

---

# 39. Open Redirects

Do not blindly redirect users to arbitrary URLs supplied by the client.

Unsafe:

res.redirect(req.query.redirect);

Prefer allowlisted destinations or validated relative paths.

---

# 40. SSRF

If the backend fetches URLs supplied by users, protect against SSRF.

Potential dangerous targets include:

- localhost
- Internal network addresses
- Cloud metadata services
- Private IP ranges
- Internal service hostnames

Validate:

- Protocol
- Host
- DNS resolution
- Redirect destinations

Do not allow arbitrary server-side URL fetching unless required.

---

# 41. File Upload Security

Treat uploaded files as untrusted.

Validate:

- Size
- MIME type
- Extension
- File signature where appropriate
- Filename
- Storage path

Do not execute uploaded files.

Do not use user-controlled filenames directly as filesystem paths.

---

# 42. Path Traversal

Never allow user input to construct arbitrary filesystem paths.

Dangerous examples:

../
..\\
absolute paths

Prefer generated storage identifiers.

Example:

uploads/{generatedFileId}

instead of:

uploads/{userProvidedFilename}

---

# 43. File Download Authorization

Before returning a tenant-specific file:

1. Authenticate.
2. Authorize.
3. Verify tenant ownership.
4. Verify file ownership.
5. Return the file or secure signed URL.

Never rely only on an unguessable filename for authorization.

---

# 44. OAuth Security

For OAuth flows:

- Validate redirect URIs.
- Use state.
- Use PKCE where appropriate.
- Protect client secrets.
- Validate callback parameters.
- Avoid token leakage.
- Store tokens securely.

Never trust arbitrary redirect URLs supplied by users.

---

# 45. OAuth State

Use a cryptographically secure state value.

The state protects against login CSRF and authorization response injection.

Validate it when the OAuth callback is received.

Do not simply generate state and ignore it afterward.

---

# 46. PKCE

Use PKCE for public clients and where appropriate for OAuth authorization-code flows.

PKCE helps protect authorization codes from interception.

Use the provider's recommended OAuth security flow.

---

# 47. OAuth Tokens

Never log:

access_token
refresh_token
client_secret

Do not return provider refresh tokens to React unless absolutely required.

Encrypt or otherwise securely protect long-lived integration credentials at rest according to the application's security architecture.

---

# 48. Webhook Security

Webhook endpoints must verify provider authenticity.

Use:

- Signature verification
- Timestamp validation where supported
- Event ID deduplication
- Payload validation

Do not trust:

organizationId

inside an incoming webhook until the webhook has been mapped to a trusted integration/tenant.

---

# 49. Webhook Replay Protection

Where providers provide event IDs or timestamps:

- Track processed event IDs.
- Reject or ignore duplicates.
- Validate timestamps where supported.

Do not process the same state-changing webhook multiple times.

---

# 50. Idempotency

Use idempotency for security-sensitive or state-changing operations.

Examples:

- Payments
- Organization creation
- Invitations
- Webhooks
- External synchronization
- Job processing

A retry should not unexpectedly create duplicate resources.

---

# 51. API Rate Limiting

Rate-limit sensitive endpoints.

Examples:

POST /login
POST /password-reset
POST /invitations
POST /oauth
POST /exports

Also consider rate limiting expensive:

- Analytics
- Search
- File processing
- External integration calls

---

# 52. Distributed Rate Limiting

If the application runs multiple Node.js instances, process-local rate limiting may be insufficient.

Consider shared rate-limit storage when required.

Do not assume:

Instance A rate limit
+
Instance B rate limit

equals a global rate limit.

---

# 53. Denial of Service

Protect against resource exhaustion.

Consider limits for:

- Request body size
- File uploads
- Pagination limits
- Query complexity
- Regex queries
- Analytics date ranges
- Export sizes
- Job concurrency
- API rate

Never allow clients to request unlimited data.

---

# 54. Regex Security

User-provided regular expressions can cause expensive processing.

Avoid accepting arbitrary regex patterns.

If regex search is required:

- Validate patterns.
- Limit complexity.
- Prefer indexed search where possible.
- Apply length limits.
- Consider alternative search mechanisms.

---

# 55. API Pagination Security

Always enforce server-side maximum limits.

Unsafe:

limit = req.query.limit

Preferred:

limit = Math.min(validatedLimit, MAX_LIMIT)

Do not allow:

limit = 10000000

to trigger huge database operations.

---

# 56. Sensitive Data Exposure

Do not return unnecessary sensitive fields.

Potentially sensitive fields include:

- Password hashes
- Refresh tokens
- OAuth tokens
- Internal IDs
- Security metadata
- Private integration configuration

Use DTOs and projections.

---

# 57. Database Security

Protect MongoDB with:

- Authentication
- Network restrictions
- TLS where appropriate
- Least-privilege database users
- Secure credentials
- Backups
- Monitoring

Never expose MongoDB directly to the public internet unnecessarily.

---

# 58. Database Credentials

Database credentials must not be:

- Hardcoded
- Committed to Git
- Sent to React
- Logged

Use environment variables or a secrets-management system.

---

# 59. Least Privilege

Apply least privilege to:

- Database users
- Cloud roles
- API credentials
- OAuth scopes
- Service accounts
- Application permissions

Do not request or grant permissions that the feature does not need.

---

# 60. OAuth Scopes

Request only required scopes.

Avoid broad access when a narrower scope is sufficient.

For example:

crm.objects.contacts.read

is preferable to broader write/admin access when read access is sufficient.

---

# 61. API Keys

If third-party API keys are used:

- Store them server-side.
- Never expose them to React.
- Rotate them when compromised.
- Scope them where supported.
- Monitor usage.

---

# 62. Environment Variables

Frontend environment variables are not secrets.

Anything shipped to the browser can be inspected.

Never put:

DATABASE_URL
JWT_SECRET
PRIVATE_KEY
CLIENT_SECRET

into frontend environment variables.

---

# 63. Secrets Management

Use an appropriate secrets-management mechanism.

Examples:

- Environment variables
- Cloud secret managers
- Vault-like systems

Do not create custom secret-storage mechanisms without a strong reason.

---

# 64. Encryption in Transit

Use TLS for:

- Browser → API
- API → MongoDB where required
- API → external providers
- Workers → APIs
- Internal services where appropriate

Do not disable certificate verification in production.

Avoid:

rejectUnauthorized: false

unless there is a very specific controlled reason.

---

# 65. Encryption at Rest

Protect sensitive data at rest according to infrastructure capabilities.

Potentially sensitive data includes:

- OAuth tokens
- Personal information
- Integration credentials
- Security tokens

Do not implement custom encryption without expert review.

Use established cryptographic libraries and key-management practices.

---

# 66. Cryptography

Never implement custom cryptographic algorithms.

Use established primitives and libraries.

Do not use:

Math.random()

for security-sensitive tokens.

Use cryptographically secure random generation.

---

# 67. Random Tokens

For:

- Password resets
- Email verification
- Invitations
- OAuth state
- Session identifiers

use cryptographically secure random generation.

Tokens must have sufficient entropy.

---

# 68. Timing Attacks

For security-sensitive secret comparisons, use constant-time comparison mechanisms where appropriate.

Do not compare cryptographic secrets using naive string comparison when timing resistance matters.

---

# 69. Session Security

Sessions should have:

- Expiration
- Revocation capability
- Secure storage
- Appropriate cookie settings
- Session rotation where appropriate

Consider invalidating sessions after:

- Password changes
- Account compromise
- Security-sensitive changes

according to the application's requirements.

---

# 70. Logout

Logout should invalidate the appropriate session/token state.

Do not treat:

localStorage.clear()

as universal server-side logout.

If refresh tokens/sessions exist server-side, revoke them according to the architecture.

---

# 71. Account Security

Security-sensitive account changes may require re-authentication.

Examples:

- Change password
- Change email
- Change MFA
- Transfer organization ownership
- Create integration credentials

Consider requiring recent authentication.

---

# 72. MFA

For sensitive SaaS applications, consider multi-factor authentication.

Potential methods:

- TOTP
- WebAuthn/passkeys
- Hardware-backed authentication

Do not implement custom MFA cryptography.

---

# 73. Organization Ownership

Changing organization ownership is security-sensitive.

Require appropriate:

- Authorization
- Confirmation
- Audit logging
- Possibly recent authentication

Do not allow a normal profile update endpoint to modify organization ownership.

---

# 74. Role Changes

Role changes must be server-authorized.

Prevent users from modifying:

role
permissions
isAdmin

through ordinary profile updates.

Audit important role changes.

---

# 75. Membership Management

Membership operations must validate:

- Current user's permission
- Target organization
- Target membership
- Membership status

A user in Organization A must not be able to modify Organization B memberships by changing an ID in the request.

---

# 76. Tenant Isolation in Background Jobs

Background jobs must preserve tenant context.

Example:

{
  organizationId,
  resourceId
}

Worker:

1. Validate organization context.
2. Query tenant-scoped resource.
3. Process data.
4. Write tenant-scoped results.

Do not allow jobs to operate only on arbitrary resource IDs without tenant validation.

---

# 77. Tenant Isolation in Caches

Tenant-specific cache keys must include tenant context.

Prefer:

organization:{organizationId}:dashboard:{dashboardId}

instead of:

dashboard:{dashboardId}

A cache hit must never return another tenant's data.

---

# 78. Tenant Isolation in Analytics

All analytics queries must be tenant-scoped.

Review:

- Counts
- Aggregations
- Search
- Exports
- Charts
- Reports

A cross-tenant analytics query is a critical security issue.

---

# 79. Tenant Isolation in Files

Files must have tenant-aware authorization.

Do not rely solely on:

organizationId in path

as authorization.

The backend must validate access before returning a file or signed URL.

---

# 80. Error Messages

Error responses should not reveal sensitive internal information.

Avoid exposing:

- Database errors
- Stack traces
- Internal hostnames
- Infrastructure details
- Tokens
- Secrets

Use safe application-level errors.

---

# 81. Security Logging

Log security-relevant events such as:

- Login failures
- Successful authentication
- Password changes
- Password reset
- Role changes
- Membership changes
- Ownership changes
- Integration creation
- Security-sensitive configuration changes

Do not log credentials or tokens.

---

# 82. Audit Logging

For important tenant actions, consider audit records:

{
  organizationId,
  userId,
  action,
  resourceType,
  resourceId,
  timestamp
}

Audit logs should themselves be protected from unauthorized access.

---

# 83. Dependency Security

Regularly review dependencies for vulnerabilities.

Use the package manager's audit capabilities.

For npm:

```bash
npm audit

Also review:

npm outdated

Do not blindly apply all security updates without reviewing compatibility.

84. Dependency Lockfiles

Commit the appropriate lockfile.

Examples:

package-lock.json
yarn.lock
pnpm-lock.yaml

This improves reproducibility.

85. Supply Chain Security

Before adding dependencies:

Check package reputation.
Check maintenance.
Check download/source authenticity.
Review permissions.
Check known vulnerabilities.
Avoid unnecessary packages.

Do not install packages simply because an AI-generated solution suggested them.

86. CI Security

CI pipelines should protect:

Secrets
Deployment credentials
Tokens
Environment variables

Avoid printing secrets in logs.

Use least-privilege CI credentials.

Protect production deployment workflows.

87. Git Security

Before committing:

git status
git diff

Look for:

API keys
Tokens
Passwords
Certificates
.env files
Private keys

Never commit secrets.

If a secret is accidentally committed:

Revoke/rotate it.
Remove it from the repository.
Assess Git history exposure.
Replace the credential.

Deleting it from the latest commit is not necessarily enough.

88. Security Testing

Security tests should include:

Unauthenticated access
Unauthorized access
Cross-tenant access
Invalid tokens
Expired tokens
Revoked membership
Role escalation attempts
Mass assignment
NoSQL injection
XSS payloads
Rate limits
Invalid input
File upload abuse
Webhook replay
OAuth state failures
89. Cross-Tenant Security Tests

At minimum test:

Same tenant

User A
↓
Organization A
↓
Resource A

Expected:

Allowed.

Different tenant

User A
↓
Organization A

tries:

Resource B
↓
Organization B

Expected:

Denied.

No membership

User A

tries:

Organization B

Expected:

Denied.

Revoked membership

Previously authorized user

Membership revoked

Expected:

Denied.

90. Security Review Severity

Use:

CRITICAL
Authentication bypass
Cross-tenant data exposure
Remote code execution
Credential exposure
Privilege escalation
Destructive unauthorized access
HIGH
Authorization bypass
SQL/NoSQL injection
Stored XSS
SSRF
Sensitive data exposure
Broken OAuth security
Insecure file access
MEDIUM
Missing rate limit
Weak validation
Excessive permissions
Security-relevant logging gaps
Session-management weaknesses
LOW
Minor hardening
Non-sensitive header improvements
Low-risk configuration improvements
91. Security Finding Format

Use:

HIGH — Cross-Tenant Report Access

Location:

src/repositories/report.repository.ts

Problem:

The report is queried only by _id without organization scope.

Impact:

A user who knows another organization's report ID may access that report.

Recommendation:

Scope the query with the authenticated organization ID and add a cross-tenant regression test.

92. Security Review Workflow

When reviewing a feature:

Step 1 — Identify assets

What sensitive data or capability does this feature expose?

Step 2 — Identify trust boundaries

Where does data enter the system?

Step 3 — Authentication

Who is the caller?

Step 4 — Authorization

What are they allowed to do?

Step 5 — Tenant isolation

Which organization owns the data?

Step 6 — Input validation

Can user input manipulate queries or behavior?

Step 7 — Data exposure

Could sensitive information leak?

Step 8 — Abuse cases

Could the endpoint be abused?

Step 9 — Dependencies

Are external services handled securely?

Step 10 — Logging

Are security events observable without exposing secrets?

93. Security Threat Modeling

For important features, consider:

Spoofing
Tampering
Repudiation
Information disclosure
Denial of service
Elevation of privilege

Pay particular attention to:

Authentication
Authorization
Tenant boundaries
External integrations
File uploads
Webhooks
Administrative functions
94. Secure API Checklist

For every protected API:

 HTTPS
 Authentication
 Authorization
 Tenant validation
 Input validation
 Mass-assignment protection
 NoSQL injection protection
 Rate limiting where required
 Request size limits
 Safe errors
 Sensitive response fields removed
 Logging without secrets
 Appropriate HTTP status codes
 Idempotency where required
95. Secure React Checklist
 No secrets in frontend
 Backend authorization remains authoritative
 Tenant switching is validated
 Tenant cache/state is isolated
 XSS risks reviewed
 dangerouslySetInnerHTML avoided or sanitized
 Untrusted URLs validated
 Authentication state handled safely
 Sensitive browser storage minimized
 API errors do not expose sensitive information
96. Secure Node.js Checklist
 Authentication verified
 Authorization verified
 Tenant context trusted
 Input validated
 MongoDB queries scoped
 Mass assignment prevented
 NoSQL injection prevented
 Errors centralized
 Secrets protected
 External calls have timeouts
 Webhooks verified
 Rate limits considered
 Request limits configured
 Security headers configured
 Graceful shutdown handled
97. Secure MongoDB Checklist
 Authentication enabled
 Network access restricted
 TLS used where appropriate
 Least-privilege DB user
 Tenant filters enforced
 No untrusted MongoDB operators
 Sensitive fields protected
 Unique constraints appropriate
 Indexes reviewed
 Audit data protected
 Backups configured
 Production access restricted
98. Production Security Checklist

Before production release:

 No secrets in Git
 Secrets rotated where necessary
 HTTPS enforced
 Authentication tested
 Authorization tested
 Cross-tenant access tested
 Password reset tested
 Token expiration tested
 Logout/revocation tested
 Rate limiting configured
 Input validation verified
 NoSQL injection tested
 XSS reviewed
 CSRF reviewed where applicable
 CORS reviewed
 Security headers reviewed
 File upload security reviewed
 OAuth flows reviewed
 Webhooks verified
 Dependency vulnerabilities reviewed
 Logging reviewed
 Audit logging reviewed
 Database access restricted
 Backups verified
99. Final Security Principles

For every feature, ask:

Who is the user?
How was their identity verified?
Which organization are they accessing?
How was membership verified?
What permission do they have?
Does the resource belong to that organization?
Can client input manipulate the query?
Can sensitive data leak?
Can the operation be abused?
Can it be replayed?
Are secrets protected?
Are external integrations verified?
Are errors safe?
Is the operation logged appropriately?
Are cross-tenant security tests present?

The most important rule is:

Never trust the client.

React controls the user experience.

Node.js enforces security.

MongoDB enforces tenant-scoped data access.

For this SaaS application, any possibility of cross-tenant data access, privilege escalation, authentication bypass, or credential exposure must be treated as a security defect and addressed before production.