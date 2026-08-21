# Multi-Tenancy Skill

```text
---
name: multi-tenancy
description: Design, implement, review, and secure multi-tenant SaaS functionality for the React + TypeScript + Node.js + MongoDB application. Use this skill whenever working on organizations, tenants, users, memberships, invitations, roles, permissions, authentication, authorization, tenant-scoped APIs, MongoDB queries, background jobs, integrations, caching, analytics, billing, or any feature that can access tenant-owned data.
---

# Multi-Tenancy Standards

## 1. Core Principle

This application is a multi-tenant SaaS platform.

Tenant isolation is a fundamental security requirement.

The application must ensure that:

- Users can only access organizations they are authorized to access.
- Tenant-owned resources cannot be accessed by users from another tenant.
- Tenant identity is established server-side.
- Client-provided tenant identifiers are never trusted as proof of authorization.
- Every tenant-scoped database operation enforces tenant isolation.
- Background jobs preserve tenant context.
- External integrations preserve tenant context.
- Caches preserve tenant isolation.
- Analytics and reporting preserve tenant isolation.
- Authorization is enforced on the backend.

A feature is not considered complete if it works functionally but introduces a cross-tenant access path.

---

# 2. Terminology

Use consistent terminology throughout the application.

Recommended:

User
Organization / Tenant
Membership
Role
Permission
Resource

Conceptually:

User
  ↓
Membership
  ↓
Organization / Tenant
  ↓
Tenant-owned Resources

Do not use `tenant`, `organization`, `company`, and `workspace` interchangeably unless the domain explicitly defines them as different concepts.

Choose the terminology already established by the application and follow it consistently.

---

# 3. User vs Tenant

Do not assume:

User = Tenant

A user represents an identity.

An organization/tenant represents an isolated business/customer boundary.

A user may belong to:

- One organization
- Multiple organizations

depending on the application's business requirements.

The architecture must support the actual domain relationship rather than assuming one user always belongs to exactly one organization.

---

# 4. Organization/Tenant

An organization represents the tenant boundary.

Example:

{
  "_id": "...",
  "name": "ABC Logistics",
  "createdAt": "...",
  "updatedAt": "..."
}

Tenant-owned resources should reference the organization.

Example:

{
  "_id": "...",
  "organizationId": "...",
  "name": "Sales Dashboard"
}

Use the project's established field name consistently.

Do not introduce both:

organizationId
tenantId

for the same relationship.

---

# 5. Membership

Users should be associated with organizations through a membership relationship when the domain supports users belonging to multiple organizations.

Conceptually:

User
  ↓
Membership
  ↓
Organization

Example:

{
  "_id": "...",
  "userId": "...",
  "organizationId": "...",
  "role": "admin",
  "status": "active"
}

A membership can contain:

- userId
- organizationId
- role
- status
- invitedAt
- joinedAt
- createdAt
- updatedAt

Only include fields required by the domain.

---

# 6. Membership Status

If memberships have lifecycle states, use explicit states.

Examples:

pending
active
suspended
revoked

Do not rely on the absence/presence of fields to infer membership state when an explicit state improves correctness.

Authorization must consider membership status.

For example:

A pending membership should not automatically have the same access as an active membership.

---

# 7. Tenant Context

Every authenticated request that accesses tenant-owned resources must have a trusted tenant context.

Recommended conceptual flow:

Request
  ↓
Authentication
  ↓
Identify User
  ↓
Determine Organization
  ↓
Validate Membership
  ↓
Establish Tenant Context
  ↓
Authorization
  ↓
Business Logic
  ↓
Tenant-scoped Database Access

Tenant context should contain only trusted server-side information.

Example:

{
  userId,
  organizationId,
  membershipId,
  role
}

Do not populate this context directly from arbitrary request parameters.

---

# 8. Never Trust Client Tenant IDs

Do not treat these as trusted authorization information:

req.body.organizationId
req.query.organizationId
req.params.organizationId
frontend organization state
localStorage organization ID

A client may provide an organization ID as part of navigation or selection.

The backend must independently verify that the authenticated user has access to that organization.

---

# 9. Tenant Resolution

If the application supports multiple organizations per user, tenant resolution should be explicit.

Possible sources include:

- Authenticated session
- Verified JWT claim
- Explicit organization selection
- Organization membership
- Subdomain
- Domain
- Route parameter

Regardless of the source, the server must validate that the user has access to the resolved organization.

Do not assume that:

organizationId from URL
=
authorized organization

until membership/authorization has been verified.

---

# 10. Organization Switching

If users can belong to multiple organizations, organization switching must be authorized.

Example:

User
  ↓
Organization A
  ↓
Switch to Organization B
  ↓
Server verifies membership
  ↓
New tenant context
  ↓
Subsequent requests use Organization B

Never allow:

POST /switch-organization

to simply accept any organization ID and switch context without membership validation.

---

# 11. Authentication vs Authorization

Keep these concepts separate.

Authentication:

"Who is the user?"

Authorization:

"Can this user access this organization/resource?"

Example:

Valid JWT
  ↓
User identified
  ↓
Membership checked
  ↓
Permission checked
  ↓
Resource access granted

A valid authentication token does not automatically grant access to every tenant.

---

# 12. Tenant Authorization

For tenant-owned operations, verify:

1. User is authenticated.
2. Organization exists where required.
3. User has an active membership.
4. User has the required permission.
5. Resource belongs to the organization.
6. Requested operation is allowed.

Do not stop authorization after checking the user's identity.

---

# 13. Roles

Use roles for groups of permissions.

Example:

Owner
Admin
Member
Viewer

The actual role names should follow the application domain.

Avoid hardcoding role behavior in dozens of unrelated files.

Prefer centralized authorization rules.

---

# 14. Permissions

Permissions should represent explicit capabilities.

Examples:

organization:read
organization:update

members:read
members:invite
members:update
members:remove

reports:read
reports:create
reports:update
reports:delete

analytics:read

integrations:read
integrations:manage

Use the project's established permission naming convention.

Do not rely on frontend visibility as permission enforcement.

---

# 15. Owner Permissions

Organization ownership should be explicitly modeled.

Do not assume:

first user = owner

unless the business logic explicitly defines this.

If the organization has an owner:

- Store the relationship clearly.
- Protect ownership changes.
- Require appropriate authorization.
- Audit ownership changes where appropriate.

Do not allow ordinary member update endpoints to modify ownership.

---

# 16. Authorization Location

Backend authorization is authoritative.

The React frontend may:

- Hide navigation.
- Disable buttons.
- Restrict routes.
- Improve user experience.

But the backend must enforce:

- Organization access
- Role access
- Permission access
- Resource ownership

Never rely on:

if (user.role === "admin")

in React as the security boundary.

---

# 17. Tenant-Owned Resources

Every tenant-owned resource must have an explicit relationship with the tenant.

Examples:

Report
  organizationId

Dashboard
  organizationId

Integration
  organizationId

Project
  organizationId

Membership
  organizationId

AuditLog
  organizationId

The exact data model can differ, but tenant ownership must be unambiguous.

---

# 18. Global Resources

Not every resource necessarily belongs to a tenant.

Examples may include:

- System configuration
- Public metadata
- Global feature definitions
- Application-wide permissions
- Global plans

Clearly distinguish:

Global resources

from:

Tenant-owned resources

Do not accidentally apply tenant filters to global data.

Do not accidentally expose tenant-specific data through global resources.

---

# 19. MongoDB Tenant Scoping

Tenant-owned MongoDB queries must include tenant scope.

Preferred:

const report = await Report.findOne({
  _id: reportId,
  organizationId
});

Avoid:

const report = await Report.findById(reportId);

unless tenant authorization is enforced safely elsewhere.

For collections:

const reports = await Report.find({
  organizationId,
  status: "active"
});

Never assume a resource ID is sufficient for tenant isolation.

---

# 20. Tenant-Safe Updates

Updates must include tenant scope.

Preferred:

await Report.updateOne(
  {
    _id: reportId,
    organizationId
  },
  {
    $set: {
      name: validatedName
    }
  }
);

Avoid:

await Report.updateOne(
  {
    _id: reportId
  },
  update
);

for tenant-owned resources unless equivalent tenant isolation is guaranteed elsewhere.

---

# 21. Tenant-Safe Deletes

Deletes must also be tenant-scoped.

Preferred:

await Report.deleteOne({
  _id: reportId,
  organizationId
});

Avoid unscoped deletion of tenant resources.

Never allow a user to delete another tenant's resource by knowing its ID.

---

# 22. Tenant-Safe Aggregations

Aggregation pipelines must be tenant-scoped.

Preferred:

[
  {
    $match: {
      organizationId
    }
  },
  ...
]

Apply tenant filtering as early as practical.

Do not:

MongoDB
  ↓
All tenant data
  ↓
Node.js filtering

Prefer:

MongoDB
  ↓
Tenant-scoped aggregation
  ↓
Application

---

# 23. Tenant-Safe Counts

Counts must also be tenant-scoped.

Unsafe:

await Report.countDocuments({
  status: "active"
});

Preferred:

await Report.countDocuments({
  organizationId,
  status: "active"
});

Otherwise dashboards and analytics may expose cross-tenant totals.

---

# 24. Tenant-Safe Search

Search operations must include tenant scope.

Example:

await Report.find({
  organizationId,
  $text: {
    $search: searchTerm
  }
});

Do not search the entire collection and filter results afterward.

---

# 25. Tenant-Safe Pagination

Pagination queries must preserve tenant scope.

Example:

await Report.find({
  organizationId
})
.sort({
  createdAt: -1
})
.limit(limit);

Tenant filtering must occur before pagination.

Do not:

1. Fetch global records.
2. Paginate.
3. Filter by tenant.

That can produce incorrect results and potentially expose data.

---

# 26. Tenant-Aware Indexes

Tenant-scoped query patterns should be considered when designing indexes.

Examples:

{
  organizationId: 1,
  createdAt: -1
}

or:

{
  organizationId: 1,
  status: 1,
  createdAt: -1
}

Do not blindly put `organizationId` into every index.

Design indexes according to actual query patterns.

---

# 27. Tenant-Specific Uniqueness

Determine whether uniqueness is:

Global

or:

Tenant-specific.

Example:

If each organization can have its own report named "Sales Dashboard", then global uniqueness is incorrect.

Potential index:

{
  organizationId: 1,
  name: 1
}

with:

unique: true

Only use this if the business rule requires uniqueness within an organization.

---

# 28. Cross-Tenant Access Prevention

Every resource lookup should answer:

"Does this resource belong to the organization the user is currently authorized to access?"

Example:

User belongs to:

Organization A

Request:

GET /reports/report-from-organization-B

The request must not return Organization B's report.

Depending on the application's security policy, return an appropriate not-found or forbidden response.

Do not reveal unnecessary information about the existence of resources belonging to another tenant.

---

# 29. Resource Ownership

Tenant membership alone may not be sufficient.

Some resources may have additional ownership rules.

Example:

Organization
  ↓
Project
  ↓
Report
  ↓
Dashboard

A user may belong to the organization but still require:

- Project membership
- Role
- Permission
- Resource ownership

Authorization should reflect the actual business rules.

---

# 30. Nested Resources

For nested APIs:

GET /organizations/:organizationId/projects/:projectId

do not assume that the organization ID in the URL is trusted.

Verify:

1. Authenticated user has organization membership.
2. Project belongs to that organization.
3. User has permission to access the project.

Preferred conceptual query:

{
  _id: projectId,
  organizationId: authorizedOrganizationId
}

Do not trust the relationship merely because both IDs came from the URL.

---

# 31. Invitations

Invitation flows must be tenant-safe.

An invitation should contain enough information to identify:

- Target organization
- Invited email/user
- Invitation state
- Expiration
- Inviter
- Invitation token/reference

Invitation tokens must be:

- Unpredictable
- Expiring
- Single-use where appropriate
- Stored/handled securely

Never allow an invitation token to grant unrestricted access.

---

# 32. Invitation Acceptance

When accepting an invitation:

1. Validate invitation token.
2. Verify token expiration.
3. Verify invitation status.
4. Identify target organization.
5. Identify authenticated user.
6. Validate that the invitation is intended for that user/email according to the business rules.
7. Create or activate membership.
8. Mark invitation as accepted.
9. Prevent duplicate acceptance.

If multiple operations must be atomic, consider a transaction.

---

# 33. Signup

For organization creation:

User signup
  ↓
Create user
  ↓
Create organization
  ↓
Create owner membership
  ↓
Create default organization settings

If these operations must be atomic, use an appropriate transaction strategy.

Do not create an organization and leave it without a valid owner due to partial failure.

---

# 34. Existing Organization

Do not automatically allow a user to recreate an existing organization simply because the name is available.

Determine uniqueness rules explicitly.

Organization names may or may not need to be globally unique.

Prefer immutable identifiers such as:

organizationId

or:

organization slug

according to the application's requirements.

Do not use organization display names as security identifiers.

---

# 35. Multiple Organizations per User

If supported:

User
  ├── Membership → Organization A
  ├── Membership → Organization B
  └── Membership → Organization C

The active organization is contextual.

Do not store a single organization ID on the user if the domain allows multiple memberships unless that field represents something different, such as a default organization.

---

# 36. Default Organization

If users can belong to multiple organizations, a default organization can be useful.

However:

Default organization
≠
Only authorized organization

The user must still be able to switch only to organizations for which they have valid membership.

---

# 37. Authentication Tokens and Tenant Context

If tenant context is stored in a token:

- Treat it as a context hint, not an unconditional authorization decision.
- Validate membership according to the application's security requirements.
- Handle membership revocation.
- Consider token lifetime and stale authorization.

Do not assume a long-lived token guarantees current organization access.

Authorization state can change after token issuance.

---

# 38. Refresh Tokens

Refresh-token architecture must account for organization membership changes.

If a user is removed from an organization:

- Their access to that organization must stop.
- Long-lived authentication must not bypass current authorization.
- Organization membership should be checked when required.

Do not use token claims as a permanent substitute for authorization state.

---

# 39. Tenant Context in Services

Services should receive trusted tenant context.

Preferred:

await reportService.getReport({
  organizationId,
  userId,
  reportId
});

Avoid services directly reading:

req.body.organizationId

or:

req.query.organizationId

Business logic should operate on trusted application context.

---

# 40. Tenant Context in Repositories

Repositories should make tenant scope explicit.

Example:

await reportRepository.findById({
  organizationId,
  reportId
});

This makes it harder to accidentally perform an unscoped query.

For highly security-sensitive applications, consider designing repository APIs so tenant context is required by default.

---

# 41. Background Jobs

Every tenant-aware background job must preserve tenant context.

Example:

{
  organizationId,
  reportId,
  requestedBy
}

When the worker executes:

1. Validate tenant context.
2. Validate resource ownership.
3. Perform tenant-scoped queries.
4. Write tenant-scoped results.

Never create a generic worker that accepts only:

resourceId

when tenant context is required for authorization.

---

# 42. Scheduled Jobs

Scheduled jobs must distinguish:

Global jobs

from:

Tenant jobs.

Global:

Cleanup expired system records.

Tenant:

Generate monthly analytics for Organization A.

Tenant jobs must carry organization context.

Do not iterate over all tenants without controlling:

- Authorization
- Failure handling
- Rate limits
- Resource consumption
- Tenant isolation

---

# 43. External Integrations

Third-party integrations must belong to the correct tenant.

Example:

Organization A
  ↓
HubSpot connection A

Organization B
  ↓
HubSpot connection B

Never use a global integration token for tenant-specific data unless the architecture explicitly requires and securely isolates it.

Store integration credentials with clear tenant ownership.

---

# 44. OAuth Integrations

OAuth credentials should be associated with the correct organization/integration.

Example:

{
  organizationId,
  provider: "hubspot",
  accessToken: ...,
  refreshToken: ...
}

Protect credentials appropriately.

Never return provider access/refresh tokens to React unless explicitly required by the architecture.

Never log OAuth tokens.

---

# 45. Tenant-Specific Webhooks

Webhook events must be mapped to the correct tenant.

Do not assume:

incoming event
=
safe tenant context.

Validate:

- Provider signature
- Event identity
- Integration identity
- Organization ownership
- Event type

Then process the event within the correct tenant context.

---

# 46. Caching

Tenant-specific cache entries must contain tenant context.

Bad:

report:123

Potentially safer:

organization:456:report:123

The exact cache-key format depends on the application.

Never allow:

Tenant A cached response
  ↓
Tenant B request
  ↓
Tenant A data

Cache invalidation must also preserve tenant boundaries.

---

# 47. React Tenant State

Frontend tenant state can be used for UI behavior but must not be treated as a security boundary.

Examples:

- Current organization
- Current workspace
- Selected project

The frontend may send a tenant identifier as context.

The backend must verify it.

Never assume:

localStorage.organizationId

is authoritative.

---

# 48. Frontend Route Protection

React route protection should improve UX.

Example:

/organizations/:organizationId/reports

The frontend can prevent navigation when the user does not have access.

However, backend APIs must independently verify:

- User authentication
- Organization membership
- Permission
- Resource ownership

Never rely on React route guards for security.

---

# 49. Analytics

Analytics must always be tenant-scoped.

Example:

Organization A dashboard:

Total Reports
Active Users
Revenue
Pipeline

must not accidentally include:

Organization B

data.

Every aggregation should explicitly consider tenant scope.

---

# 50. BI Queries

BI/reporting queries are high-risk because they often aggregate large datasets.

For every BI query:

1. Determine tenant context.
2. Apply tenant filter.
3. Apply date filters where appropriate.
4. Use appropriate indexes.
5. Limit result size.
6. Review aggregation performance.

Never create a generic analytics endpoint that can query arbitrary organizations.

---

# 51. Exports

Data exports must be tenant-scoped.

Examples:

CSV
Excel
PDF
JSON

Before generating an export:

- Verify organization membership.
- Verify permission.
- Scope all queries.
- Prevent cross-tenant joins.
- Preserve tenant context throughout asynchronous export processing.

---

# 52. File Storage

Tenant-specific files must also preserve tenant isolation.

Prefer a structure such as:

organizations/{organizationId}/reports/{reportId}/file.pdf

or another equivalent isolation strategy.

Do not expose predictable global file paths without authorization.

Signed URLs must be scoped appropriately.

---

# 53. Notifications

Notifications should belong to the appropriate:

- User
- Organization
- Resource

Do not accidentally deliver another tenant's notification.

Background notification jobs must preserve tenant context.

---

# 54. Audit Logs

Audit logs should include tenant context where applicable.

Example:

{
  organizationId,
  userId,
  action,
  resourceType,
  resourceId,
  createdAt
}

Audit logs should themselves be protected from cross-tenant access.

Do not allow an ordinary tenant user to query global audit logs.

---

# 55. Billing and Subscription

If billing is tenant-level:

Organization
  ↓
Subscription
  ↓
Plan
  ↓
Entitlements

Billing state must be associated with the correct organization.

Do not determine subscription status from frontend state.

The backend should be authoritative.

---

# 56. Feature Entitlements

Tenant-specific features should be evaluated server-side where they affect protected functionality.

Example:

Organization A:
plan = enterprise

Organization B:
plan = free

Backend must enforce feature access.

Frontend checks should only improve UX.

---

# 57. Rate Limiting

Consider tenant-aware rate limits where appropriate.

Potential dimensions:

- IP
- User
- Organization
- API key
- Endpoint

For expensive BI/analytics operations, tenant-level limits may be useful to prevent one organization from consuming disproportionate resources.

---

# 58. Resource Limits

SaaS applications may have tenant-level limits.

Examples:

- Maximum users
- Maximum projects
- Maximum reports
- API requests
- Storage
- Data ingestion
- Analytics processing

Enforce limits server-side.

Do not rely solely on UI disabling buttons.

---

# 59. Data Leakage Through Errors

Do not expose another tenant's data through errors.

Avoid messages such as:

"Report exists but belongs to Organization B."

Prefer a safe response according to the application's security policy.

Error messages should not reveal unnecessary information about resources the caller is not authorized to access.

---

# 60. Data Leakage Through Counts

Be careful with:

countDocuments
aggregate
distinct
search
autocomplete

A count can itself reveal information about another tenant.

Every tenant-sensitive count/search must be scoped.

---

# 61. Data Leakage Through Sorting and Pagination

Incorrect tenant filtering before pagination can produce:

- Missing records
- Incorrect totals
- Cross-tenant results
- Incorrect page counts

Always scope the query first.

Conceptually:

Tenant filter
  ↓
Business filters
  ↓
Sort
  ↓
Pagination

---

# 62. Tenant Isolation Testing

Every tenant-aware feature should include tests for:

### Same tenant

User A
  ↓
Organization A
  ↓
Resource A

Expected:

Access allowed.

### Different tenant

User A
  ↓
Organization A

tries:

Resource B
  ↓
Organization B

Expected:

Access denied.

### No membership

User A
  ↓
No membership in Organization B

Expected:

Access denied.

### Revoked membership

User previously had access.

Membership revoked.

Expected:

Access denied.

---

# 63. Tenant Security Test Matrix

Test:

- GET
- POST
- PUT
- PATCH
- DELETE
- Search
- Filtering
- Sorting
- Pagination
- Aggregation
- Export
- Background jobs
- Integrations
- Webhooks
- File access
- Notifications

Do not test only GET endpoints.

---

# 64. Cross-Tenant Security Review

When reviewing code, explicitly ask:

1. Can the user choose another organization ID?
2. Can the user manipulate a resource ID?
3. Does the database query include tenant scope?
4. Does the aggregation include tenant scope?
5. Does the update include tenant scope?
6. Does the delete include tenant scope?
7. Does the background job include tenant context?
8. Does the cache include tenant context?
9. Does the external integration include tenant context?
10. Does the export include tenant context?

If any answer is unclear, investigate before approving.

---

# 65. Multi-Tenant Architecture Review

Recommended flow:

React
  ↓
API Request
  ↓
Authentication
  ↓
User Context
  ↓
Organization Context
  ↓
Membership Validation
  ↓
Permission Check
  ↓
Controller
  ↓
Service
  ↓
Tenant-Aware Repository
  ↓
MongoDB
  ↓
Tenant-Scoped Data

The exact implementation may differ, but the security guarantees must remain.

---

# 66. Common Anti-Patterns

Avoid:

### Client-controlled tenant authorization

const organizationId = req.body.organizationId;

### Unscoped resource lookup

Model.findById(resourceId);

### Unscoped update

Model.updateOne(
  { _id: resourceId },
  update
);

### Unscoped delete

Model.deleteOne({
  _id: resourceId
});

### Cross-tenant aggregation

Model.aggregate([
  ...
]);

without tenant filtering.

### Frontend-only authorization

if (user.role === "admin") {
  showDeleteButton();
}

This improves UX but does not provide security.

### Global cache key for tenant data

cache.set(`report:${reportId}`, data);

when the same resource ID/cache namespace could cause tenant leakage.

---

# 67. Safe Tenant-Aware Patterns

Prefer:

const tenantContext = {
  organizationId,
  userId,
  role
};

Then:

service.getReport({
  tenantContext,
  reportId
});

Then:

repository.findReport({
  organizationId: tenantContext.organizationId,
  reportId
});

This makes tenant context explicit throughout the request lifecycle.

---

# 68. Tenant Context Should Not Become Global Mutable State

Avoid using a mutable global variable for current tenant.

Bad:

currentOrganizationId = ...

This can cause serious concurrency and request-isolation problems in Node.js.

Tenant context should be associated with the individual request/job execution.

Use request-scoped mechanisms or explicit parameters according to the application's architecture.

---

# 69. Tenant Context in Async Operations

Ensure tenant context is preserved across:

- Promise chains
- Background jobs
- Event handlers
- Queue workers
- Scheduled tasks
- Webhooks

Do not assume an asynchronous operation automatically knows the original tenant.

Pass or establish the tenant context explicitly.

---

# 70. Tenant Isolation and Transactions

Transactions involving tenant-owned data must ensure all operations belong to the same tenant context.

Example:

Organization A
  ↓
Create project
  ↓
Create default report
  ↓
Create audit log

All operations must use Organization A.

Do not accidentally create one record without tenant context.

---

# 71. Tenant-Aware Event Design

If using events:

Include tenant context where required.

Example:

{
  event: "REPORT_CREATED",
  organizationId,
  userId,
  resourceId
}

Consumers must validate and preserve tenant context.

Do not create generic events that lose ownership information.

---

# 72. Tenant-Aware Queue Design

Jobs should contain sufficient context.

Example:

{
  type: "GENERATE_REPORT",
  organizationId,
  reportId,
  requestedBy
}

Worker:

1. Validate organization.
2. Validate resource.
3. Validate authorization where required.
4. Query tenant-scoped data.
5. Process job.
6. Store tenant-scoped result.

---

# 73. Tenant Data Deletion

When an organization is deleted:

Determine the lifecycle of:

- Users/memberships
- Reports
- Dashboards
- Integrations
- Audit logs
- Files
- Analytics
- Background jobs
- Billing
- External provider data

Do not implement organization deletion as:

deleteOne({ _id: organizationId })

without understanding dependent data.

Deletion should be deliberate and auditable.

---

# 74. Tenant Suspension

If an organization can be suspended:

All relevant access paths should respect the organization state.

For example:

Organization
  ↓
status = suspended

may prevent:

- Login into tenant
- API access
- Data modification
- Background processing
- Integrations

depending on the business requirements.

Do not implement suspension only in the frontend.

---

# 75. Tenant Isolation and Caching

When caching tenant-specific data:

Cache key should include tenant identity where required.

Example:

organization:{organizationId}:dashboard:{dashboardId}

Do not use:

dashboard:{dashboardId}

if IDs are not globally unique or if tenant context is required for isolation.

Review cache invalidation when organization membership or permissions change.

---

# 76. Tenant Isolation and Search Indexes

If using search infrastructure:

- Include organizationId/tenantId in indexed data where appropriate.
- Apply tenant filters to searches.
- Do not index tenant data into a globally searchable namespace without tenant filtering.

Search infrastructure must preserve the same isolation guarantees as MongoDB.

---

# 77. Tenant Isolation and Object Storage

For S3 or equivalent storage:

- Use tenant-aware object paths.
- Validate ownership before generating signed URLs.
- Do not expose raw storage credentials.
- Do not rely only on object naming for authorization.

Example:

organizations/{organizationId}/...

The server must still verify the user's organization access.

---

# 78. Multi-Tenant Code Review Checklist

Before approving tenant-related code:

- [ ] User identity is authenticated
- [ ] Organization context is trusted
- [ ] Membership is validated
- [ ] Role is validated
- [ ] Permission is validated
- [ ] Resource ownership is validated
- [ ] MongoDB query is tenant-scoped
- [ ] MongoDB update is tenant-scoped
- [ ] MongoDB delete is tenant-scoped
- [ ] Aggregations are tenant-scoped
- [ ] Counts are tenant-scoped
- [ ] Search is tenant-scoped
- [ ] Pagination is tenant-scoped
- [ ] Background jobs preserve tenant context
- [ ] Queues preserve tenant context
- [ ] Events preserve tenant context
- [ ] Cache keys preserve tenant context
- [ ] Files preserve tenant context
- [ ] External integrations preserve tenant context
- [ ] Exports preserve tenant context
- [ ] Analytics preserve tenant context
- [ ] Errors do not leak tenant information
- [ ] Cross-tenant tests exist
- [ ] Revoked-membership tests exist
- [ ] Unauthorized-access tests exist

---

# 79. New Multi-Tenant Feature Workflow

When implementing a new tenant-aware feature:

1. Determine whether the feature is global or tenant-owned.
2. Identify the tenant boundary.
3. Identify the resource owner.
4. Define the data relationship.
5. Define membership requirements.
6. Define required permissions.
7. Establish tenant context.
8. Define API authorization.
9. Define tenant-scoped database queries.
10. Define tenant-aware indexes.
11. Define background-job behavior if applicable.
12. Define integration behavior if applicable.
13. Define cache behavior if applicable.
14. Add same-tenant tests.
15. Add cross-tenant access tests.
16. Add revoked-membership tests.
17. Review error leakage.
18. Review performance.
19. Review security.
20. Verify the entire request lifecycle.

---

# 80. Final Multi-Tenancy Principle

For every tenant-aware feature, ask:

"Can a user from Organization A access, modify, delete, search, aggregate, export, cache, or otherwise influence data belonging to Organization B?"

If the answer can be "yes", the implementation is not production-ready.

The following security boundary must remain intact:

Authentication
  ↓
User
  ↓
Organization Membership
  ↓
Role / Permission
  ↓
Resource Ownership
  ↓
Tenant-Scoped Data Access

Tenant isolation must be enforced server-side and must not depend on frontend behavior.

A functionally correct feature with broken tenant isolation is a security defect, not an architectural tradeoff.
```
