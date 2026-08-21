# Node.js Skill

```text
---
name: nodejs
description: Develop, review, optimize, and maintain production-grade Node.js + TypeScript backend applications for the React + Node.js + MongoDB multi-tenant SaaS platform. Use this skill whenever implementing APIs, services, middleware, authentication, authorization, repositories, integrations, background jobs, queues, error handling, logging, configuration, performance improvements, or backend refactoring.
---

# Node.js Development Standards

## 1. Core Principles

Follow these principles for all Node.js backend development:

- Use TypeScript throughout the backend.
- Prefer asynchronous, non-blocking APIs.
- Keep controllers thin.
- Keep business logic in services.
- Keep database access in repositories/data-access modules.
- Keep external integrations isolated.
- Validate all untrusted input.
- Centralize error handling.
- Enforce authentication and authorization server-side.
- Preserve multi-tenant isolation.
- Never expose secrets.
- Avoid unnecessary dependencies.
- Avoid premature abstraction.
- Avoid premature optimization.
- Follow existing project conventions before introducing new patterns.
- Prefer simple, readable, testable code.

---

# 2. Recommended Backend Architecture

Prefer:

Request
  ↓
Middleware
  ↓
Route
  ↓
Controller
  ↓
Service
  ↓
Repository
  ↓
MongoDB

Supporting layers:

Authentication
Authorization
Validation
Logging
Configuration
External Integrations
Background Jobs

Conceptually:

src/
├── app/
├── config/
├── routes/
├── controllers/
├── services/
├── repositories/
├── models/
├── schemas/
├── middleware/
├── validators/
├── integrations/
├── jobs/
├── queues/
├── types/
├── errors/
├── utils/
└── server.ts

The exact folder structure should follow the existing project.

Do not restructure an existing project merely to match this example.

---

# 3. TypeScript

Use TypeScript as the default implementation language.

Prefer explicit domain types.

Example:

interface User {
  id: string;
  organizationId: string;
  email: string;
}

Avoid unnecessary `any`.

Avoid:

const result: any = await service.getData();

Prefer a meaningful type.

---

# 4. Strict Type Safety

Prefer strict TypeScript configuration.

Where practical:

- strict
- noImplicitAny
- strictNullChecks
- noUnusedLocals
- noUnusedParameters

Follow the existing project's tsconfig.

Do not loosen compiler settings to make an implementation compile.

Fix the underlying type issue instead.

---

# 5. Runtime Validation

TypeScript types do not validate runtime data.

Validate:

- Request bodies
- Query parameters
- Path parameters
- Headers
- Environment variables
- External API responses
- Webhook payloads

Use the validation library already established by the project.

Do not introduce a new validation library without a reason.

---

# 6. HTTP Layer

The HTTP layer should primarily handle:

- Routing
- Authentication
- Authorization
- Validation
- Request parsing
- Calling services
- HTTP response formatting

Avoid placing business logic directly in route handlers.

Bad:

router.post("/users", async (req, res) => {
  // 100+ lines of business logic
});

Prefer:

router.post(
  "/users",
  authenticate,
  authorize("users:create"),
  validate(createUserSchema),
  userController.create
);

---

# 7. Controllers

Controllers should be thin.

Responsibilities:

- Read validated input.
- Read authenticated user context.
- Read tenant context.
- Call services.
- Map result to HTTP response.
- Pass errors to centralized error handling.

Avoid:

- Complex business logic
- MongoDB queries
- External API orchestration
- Permission logic repeated across endpoints
- Large data transformations

---

# 8. Services

Services contain application/business logic.

Example:

async createReport(context, input) {
  await authorizationService.assertCanCreateReport(context);

  const report = await reportRepository.create({
    organizationId: context.organizationId,
    ...input
  });

  return report;
}

Services should not depend directly on:

req
res
next

unless there is a specific reason.

Prefer application-level parameters.

---

# 9. Repositories

Repositories encapsulate database access.

Responsibilities:

- MongoDB queries
- Persistence
- Aggregation
- Updates
- Deletes
- Data retrieval

Repositories should not:

- Return HTTP responses.
- Read Express request objects.
- Decide HTTP status codes.
- Trust raw client input.

Prefer:

Service
  ↓
Repository
  ↓
MongoDB

---

# 10. Multi-Tenant Context

Tenant context is mandatory for tenant-owned operations.

Example:

interface TenantContext {
  userId: string;
  organizationId: string;
  membershipId: string;
  role: string;
}

The context must come from trusted server-side authentication and membership validation.

Never trust:

req.body.organizationId

as the sole source of authorization.

---

# 11. Tenant-Safe Queries

Tenant-owned database operations must include tenant scope.

Preferred:

await reportRepository.findOne({
  organizationId: context.organizationId,
  reportId
});

Avoid:

await Report.findById(reportId);

unless tenant authorization is safely enforced elsewhere.

Tenant isolation must apply to:

- Reads
- Writes
- Updates
- Deletes
- Aggregations
- Counts
- Exports
- Background jobs

---

# 12. Middleware

Use middleware for cross-cutting concerns.

Examples:

- Authentication
- Authorization
- Validation
- Rate limiting
- Request IDs
- Logging
- CORS
- Security headers

Do not put unrelated business logic into generic middleware.

---

# 13. Authentication Middleware

Authentication middleware should:

1. Extract credentials.
2. Validate credentials.
3. Verify token/session.
4. Identify the user.
5. Attach trusted authentication context.
6. Continue the request.

It should not automatically grant tenant access.

Authentication:

"Who are you?"

Authorization:

"What are you allowed to access?"

---

# 14. Authorization Middleware

Authorization should verify:

- User identity
- Organization membership
- Membership status
- Role
- Permission

Example:

authorize("reports:create")

Do not rely only on frontend permission checks.

Backend authorization is authoritative.

---

# 15. Request Context

Avoid passing raw Express request objects throughout the application.

Bad:

service.createReport(req);

Prefer:

service.createReport({
  userId,
  organizationId,
  input
});

This reduces coupling between business logic and HTTP infrastructure.

---

# 16. Async/Await

Prefer async/await for asynchronous operations.

Example:

const user = await userRepository.findById(userId);

Handle errors through the established error-handling mechanism.

Avoid unnecessary Promise chains when async/await is clearer.

---

# 17. Promise Handling

Never create unhandled promises.

Bad:

processData();

if `processData()` can reject and no handling exists.

Prefer:

await processData();

or intentionally handle the promise:

void processData().catch(handleError);

depending on the context.

---

# 18. Promise.all

Use `Promise.all` when operations are independent and can safely run concurrently.

Example:

const [user, settings] = await Promise.all([
  userService.getUser(userId),
  settingsService.getSettings(userId)
]);

Do not use `Promise.all` when:

- Operations depend on each other.
- Ordering matters.
- The operations must be transactional.
- Concurrency would overload an external service/database.

---

# 19. Sequential Operations

Use sequential execution when the second operation depends on the first.

Example:

const organization = await createOrganization();

await createOwnerMembership(
  organization.id,
  user.id
);

Do not artificially parallelize dependent operations.

---

# 20. Event Loop

Node.js uses an event-driven architecture.

Avoid blocking the event loop with expensive synchronous operations.

Avoid unnecessary:

fs.readFileSync()
crypto-heavy synchronous operations
large synchronous loops
CPU-intensive transformations

For CPU-heavy work, consider:

- Worker threads
- Background jobs
- Queue workers
- Separate services

depending on actual requirements.

---

# 21. CPU-Intensive Work

Do not perform expensive CPU work inside normal HTTP request handlers.

Examples:

- Large report generation
- Large file processing
- Complex analytics
- Heavy encryption
- Large data transformations

Prefer:

HTTP Request
  ↓
Create Job
  ↓
Queue
  ↓
Worker
  ↓
Process

---

# 22. Background Jobs

Use background jobs for long-running or asynchronous work.

Examples:

- Emails
- Report generation
- Data synchronization
- Analytics processing
- Third-party imports
- Notifications

Jobs should contain sufficient context.

For tenant-specific jobs:

{
  organizationId,
  userId,
  resourceId
}

Do not lose tenant context.

---

# 23. Queue Design

Queue jobs should be:

- Idempotent where practical.
- Retryable.
- Observable.
- Tenant-aware.
- Safe to execute more than once when possible.

Example:

{
  type: "SYNC_HUBSPOT",
  organizationId,
  integrationId
}

Workers should validate the context before processing.

---

# 24. Idempotency

Use idempotency for operations that may be retried.

Important examples:

- Payments
- Webhooks
- External API synchronization
- Job processing
- Resource creation

Avoid creating duplicate records because a request or webhook was delivered twice.

Possible strategy:

idempotencyKey
  ↓
unique database constraint
  ↓
existing result

Use the project's existing implementation if available.

---

# 25. Error Handling

Use centralized error handling.

Preferred:

Service
  ↓
throws ApplicationError
  ↓
Express error middleware
  ↓
HTTP response

Define meaningful error types where appropriate.

Examples:

ValidationError
UnauthorizedError
ForbiddenError
NotFoundError
ConflictError
ExternalServiceError

---

# 26. Error Response Format

Use a consistent API error structure.

Example:

{
  "error": {
    "code": "RESOURCE_NOT_FOUND",
    "message": "Resource not found"
  }
}

The exact response should follow the project's existing API contract.

Do not expose:

- Stack traces
- MongoDB errors
- Internal service details
- Secrets
- Tokens
- Infrastructure details

in production responses.

---

# 27. Error Classification

Distinguish between:

### Client errors

400
401
403
404
409
422

### Server errors

500
502
503
504

Use status codes consistently with the API design.

Do not return HTTP 200 for failed operations.

---

# 28. Error Logging

Unexpected errors should be logged.

Logs should include useful context such as:

- Request ID
- User ID where appropriate
- Organization ID where appropriate
- Endpoint
- Error code
- Stack trace

Do not log:

- Passwords
- Access tokens
- Refresh tokens
- API keys
- OAuth secrets
- Sensitive personal data unnecessarily

---

# 29. Logging

Use structured logging where practical.

Example:

{
  "level": "info",
  "event": "report.created",
  "organizationId": "...",
  "userId": "...",
  "reportId": "..."
}

Avoid scattered `console.log()` calls in production code.

Follow the existing logging framework.

---

# 30. Request IDs

Consider request IDs for production observability.

Conceptually:

Request
  ↓
Request ID
  ↓
Controller
  ↓
Service
  ↓
Repository
  ↓
Logs

This makes tracing failures easier.

---

# 31. Configuration

Centralize configuration.

Prefer:

config/
  application.ts
  database.ts
  auth.ts
  integrations.ts

or the existing project equivalent.

Do not access:

process.env.X

randomly throughout the codebase.

---

# 32. Environment Variables

Validate required environment variables during startup.

Examples:

DATABASE_URL
JWT_SECRET
OAUTH_CLIENT_ID
OAUTH_CLIENT_SECRET

If a required production setting is missing, fail fast rather than allowing the application to run in an invalid state.

---

# 33. Secrets

Never commit:

- Passwords
- JWT secrets
- API keys
- OAuth client secrets
- Private keys
- Database credentials

Never expose server secrets through React environment variables.

Never log secrets.

Use a secure environment/secrets-management system.

---

# 34. HTTP Security

Use appropriate security middleware according to the framework.

Consider:

- Security headers
- CORS
- Request size limits
- Rate limiting
- Input validation
- HTTPS
- Cookie configuration

Do not blindly enable permissive CORS such as:

Access-Control-Allow-Origin: *

for production authenticated APIs unless there is a deliberate reason.

---

# 35. CORS

CORS should explicitly allow intended frontend origins where appropriate.

Development may use:

http://localhost:3000

Production should use the actual application origins.

Do not use CORS as an authentication mechanism.

CORS does not prevent direct API calls from non-browser clients.

---

# 36. Request Body Limits

Configure request body limits.

Avoid accepting unnecessarily large request payloads.

Examples:

- JSON body size
- Multipart upload size
- File upload size

Large requests can cause memory pressure and denial-of-service risks.

---

# 37. Input Validation

Validate:

- body
- query
- params
- headers
- file metadata

Validation should occur before business logic.

Example:

POST /reports

Validate:

- name
- description
- filters
- dates

Do not assume frontend validation is sufficient.

---

# 38. Mass Assignment

Never blindly persist user input.

Avoid:

Model.create(req.body);

Avoid:

Model.updateOne(filter, req.body);

Explicitly map allowed fields.

This is particularly important for:

- role
- permissions
- organizationId
- ownerId
- account status
- subscription
- security settings

---

# 39. External APIs

External APIs should be isolated.

Prefer:

Service
  ↓
Integration
  ↓
External API

Integrations should handle:

- Authentication
- Request formatting
- Response validation
- Error mapping
- Retries
- Timeouts
- Rate limits

Do not call external APIs directly from React components.

---

# 40. External API Timeouts

Never assume external APIs always respond.

Configure appropriate timeouts.

Handle:

- Timeout
- Network error
- Rate limit
- Unauthorized
- Server error
- Invalid response

Do not allow one external service to indefinitely block an API request.

---

# 41. Retries

Retries should be selective.

Retry appropriate transient failures:

- Network failures
- Timeouts
- 429
- Some 5xx responses

Do not blindly retry:

- 400
- 401
- 403
- Invalid requests

Use exponential backoff where appropriate.

Avoid retry storms.

---

# 42. External API Idempotency

When retrying operations that modify external systems, ensure they are idempotent where possible.

Example:

Creating a HubSpot record.

A timeout does not necessarily mean the external operation failed.

Blindly retrying may create duplicates.

Use:

- Provider idempotency keys
- Request IDs
- Deduplication
- Status tracking

where supported.

---

# 43. Webhooks

Webhook endpoints should:

1. Verify provider signatures.
2. Validate payloads.
3. Identify the correct tenant/integration.
4. Prevent duplicate processing.
5. Process safely.
6. Return appropriate responses.

Never trust webhook payloads merely because they came from an HTTP endpoint.

---

# 44. Authentication Tokens

Token handling should follow the application's authentication architecture.

Check:

- Expiration
- Signature
- Refresh
- Revocation
- Storage
- Rotation

Do not expose tokens unnecessarily to the frontend.

Do not log tokens.

---

# 45. Password Authentication

If password authentication exists:

- Never store plaintext passwords.
- Use a reputable password hashing library.
- Use appropriate password policies.
- Rate-limit authentication attempts.
- Avoid account enumeration where appropriate.
- Do not log passwords.

Do not implement custom password hashing.

---

# 46. JWT

If JWT is used:

Verify:

- Signature
- Algorithm
- Expiration
- Issuer where applicable
- Audience where applicable

Do not trust a JWT simply because it can be decoded.

Decoding is not verification.

---

# 47. Refresh Tokens

If refresh tokens are used:

- Store them securely.
- Rotate where appropriate.
- Expire them.
- Revoke them when necessary.
- Do not log them.
- Do not return them unnecessarily.

If the user loses authorization to a tenant, token authentication must not bypass current tenant authorization.

---

# 48. MongoDB Integration

Use the application's established Mongoose/MongoDB architecture.

Keep database access in repositories/data-access modules where appropriate.

Do not place MongoDB queries throughout controllers.

Tenant-owned queries must be tenant-scoped.

---

# 49. Database Connections

Create and reuse a MongoDB connection/pool.

Do not create a new connection per request.

Handle:

- Startup failure
- Connection timeout
- Reconnection
- Graceful shutdown

Follow the MongoDB driver's recommended connection management strategy.

---

# 50. Graceful Shutdown

Handle process termination.

Conceptually:

SIGTERM
  ↓
Stop accepting new work
  ↓
Finish active requests where practical
  ↓
Stop workers
  ↓
Close MongoDB
  ↓
Exit

Do not abruptly terminate the application if graceful shutdown is feasible.

---

# 51. Process Errors

Handle:

- uncaughtException
- unhandledRejection

appropriately.

Do not simply ignore them.

For fatal process errors, log the error and use the deployment/runtime strategy to restart the application safely.

Do not continue running in an unknown corrupted state.

---

# 52. Health Endpoints

Consider:

GET /health

for liveness.

Consider:

GET /ready

for readiness.

Readiness may verify required dependencies such as MongoDB when appropriate.

Do not expose sensitive infrastructure details through health endpoints.

---

# 53. API Versioning

When APIs are externally consumed, consider versioning.

Example:

/api/v1/users

Follow the existing project convention.

Avoid breaking existing clients unnecessarily.

---

# 54. API Design

Follow consistent REST conventions.

Use appropriate:

- HTTP methods
- Status codes
- Request validation
- DTOs
- Pagination
- Filtering
- Sorting
- Error responses
- Authentication
- Authorization
- Idempotency

Do not mix multiple API styles without a reason.

---

# 55. DTOs

Use DTOs when they provide a useful boundary between:

- API input
- Internal domain models
- Database models
- API output

Do not expose Mongoose documents directly if doing so leaks internal fields or creates unstable contracts.

---

# 56. Response Mapping

Prefer explicit response mapping for sensitive/domain-heavy resources.

Example:

return {
  id: user._id,
  name: user.name,
  email: user.email
};

Do not accidentally return:

- passwordHash
- refreshToken
- OAuth tokens
- internal fields

---

# 57. API Pagination

Paginate endpoints that can return large datasets.

Always enforce a maximum page size.

Example:

const limit = Math.min(requestedLimit, MAX_PAGE_SIZE);

Never allow clients to request arbitrarily large result sets.

---

# 58. Caching

Use caching only when there is a clear benefit.

Consider:

- Cache key
- TTL
- Invalidation
- Tenant isolation
- Stale data
- Memory usage

Tenant-specific cache keys must preserve tenant boundaries.

---

# 59. Rate Limiting

Consider rate limiting for:

- Login
- Password reset
- Invitation
- Public APIs
- Expensive analytics
- External integrations
- Webhooks

Rate limits may be:

- IP-based
- User-based
- Organization-based
- API-key-based

Use the appropriate dimension for the endpoint.

---

# 60. File Uploads

If the application supports uploads:

Validate:

- File size
- File type
- File name
- Content where appropriate

Do not trust file extensions.

Do not store uploaded files using arbitrary user-controlled paths.

Use safe storage and tenant-aware authorization.

---

# 61. File Downloads

Before serving tenant-specific files:

1. Authenticate.
2. Authorize.
3. Verify tenant ownership.
4. Generate/return the file.

Do not allow direct predictable paths to bypass authorization.

---

# 62. Performance

Review:

- Database queries
- API latency
- External calls
- Serialization
- Large payloads
- Memory usage
- Event-loop blocking

Do not optimize without evidence when the optimization adds significant complexity.

---

# 63. Memory Management

Avoid retaining large objects unnecessarily.

Watch for:

- Large arrays
- Global caches
- Unbounded maps
- Event listeners
- Long-lived closures
- Large request bodies

Memory leaks in a long-running Node.js process can cause production instability.

---

# 64. Streams

Use streams for large data where appropriate.

Examples:

- Large file downloads
- Large exports
- Large data processing

Avoid loading unnecessarily large files or datasets entirely into memory.

---

# 65. Environment Separation

Keep development, testing, staging, and production configuration separate.

Never accidentally connect development code to production databases.

Use explicit environment configuration.

---

# 66. Testing

Backend tests should cover:

- Services
- Controllers/API
- Validation
- Authentication
- Authorization
- Tenant isolation
- Database behavior
- Integrations
- Error handling

Security-sensitive functionality should include negative tests.

---

# 67. Unit Tests

Unit tests should focus on business behavior.

Examples:

- Service logic
- Authorization rules
- Validation
- Data transformation

Avoid mocking everything to the point that tests no longer verify meaningful behavior.

---

# 68. Integration Tests

Integration tests should verify boundaries such as:

API
  ↓
Service
  ↓
MongoDB

Important scenarios:

- Authentication
- Tenant isolation
- CRUD
- Validation
- Database errors
- Authorization

---

# 69. External Integration Tests

External integrations should have:

- Unit tests for request construction.
- Mocked provider responses.
- Error scenarios.
- Timeout scenarios.
- Retry behavior.
- Authentication failure scenarios.

Avoid making production external API calls during normal automated tests.

---

# 70. Logging and Observability

Production Node.js applications should support:

- Structured logs
- Request IDs
- Error tracking
- Metrics
- Health checks

Important operations should be traceable.

Do not log sensitive credentials.

---

# 71. Dependency Management

Before adding a dependency:

1. Check existing dependencies.
2. Determine whether it is necessary.
3. Review maintenance status.
4. Consider security.
5. Consider bundle/server impact.
6. Follow project conventions.

Do not add a library simply because it is popular.

---

# 72. Dependency Updates

When updating dependencies:

- Review breaking changes.
- Update lockfile.
- Run tests.
- Run type checking.
- Run build.
- Review security impact.

Do not blindly upgrade major versions.

---

# 73. Node.js Version

Follow the project's required Node.js version.

Use:

- `.nvmrc`
- `package.json` engines
- CI configuration

when available.

Do not change the Node.js version as part of unrelated feature work.

---

# 74. Code Organization

Organize code around business responsibilities where practical.

Example:

modules/
├── auth/
├── users/
├── organizations/
├── memberships/
├── reports/
├── analytics/
├── integrations/
└── billing/

Each module may contain:

- routes
- controllers
- services
- repositories
- schemas
- types

Do not force this structure into an existing project if another clear architecture already exists.

---

# 75. Avoid God Services

Avoid services such as:

ApplicationService

containing:

- Authentication
- Billing
- Reports
- Organizations
- Integrations
- Analytics

Split services around business responsibilities.

---

# 76. Avoid God Controllers

Controllers should not become massive workflow managers.

If a controller contains:

- Multiple database operations
- Complex branching
- External API calls
- Business rules

move the logic into appropriate services.

---

# 77. Avoid Circular Dependencies

Avoid:

Service A
  ↓
Service B
  ↓
Service A

Circular dependencies make applications difficult to reason about and test.

Refactor shared behavior into:

- A lower-level service
- Utility
- Domain module
- Explicit coordinator

where appropriate.

---

# 78. Abstraction

Create abstractions when they solve a real problem.

Good reasons:

- Replaceable external providers
- Testability
- Clear domain boundaries
- Infrastructure isolation

Avoid interfaces/classes for every small function simply to appear "enterprise."

---

# 79. Dependency Injection

Use dependency injection where it improves:

- Testability
- Modularity
- Provider replacement

Example:

ReportService
  ↓
ReportRepository
  ↓
MongoDB

Do not introduce a dependency injection framework unless the project genuinely benefits from it.

---

# 80. Feature Flags

For gradual feature rollout:

Feature Flag
  ↓
Application behavior

Keep feature flags centralized.

Do not scatter arbitrary environment checks throughout business logic.

---

# 81. Security Checklist

Before completing a backend feature:

- [ ] Authentication verified
- [ ] Authorization verified
- [ ] Tenant isolation verified
- [ ] Input validation implemented
- [ ] NoSQL injection considered
- [ ] Mass assignment prevented
- [ ] Sensitive fields protected
- [ ] Secrets protected
- [ ] Rate limiting considered
- [ ] CORS configured appropriately
- [ ] Request size limits considered
- [ ] Error leakage prevented
- [ ] External APIs secured
- [ ] Webhooks verified
- [ ] File access authorized

---

# 82. Performance Checklist

Review:

- [ ] No unnecessary database calls
- [ ] No N+1 queries
- [ ] No blocking synchronous operations
- [ ] Large operations moved to background jobs
- [ ] API responses bounded
- [ ] Pagination implemented
- [ ] External API timeouts configured
- [ ] Retry behavior is safe
- [ ] Database indexes considered
- [ ] Large data uses streams where appropriate
- [ ] Memory usage considered

---

# 83. Production Readiness Checklist

Before considering backend code production-ready:

- [ ] TypeScript passes
- [ ] Lint passes
- [ ] Tests pass
- [ ] Build passes
- [ ] Environment variables validated
- [ ] Secrets protected
- [ ] Error handling centralized
- [ ] Logging implemented appropriately
- [ ] Health checks available
- [ ] Graceful shutdown implemented
- [ ] Database connection handled correctly
- [ ] Authentication verified
- [ ] Authorization verified
- [ ] Tenant isolation verified
- [ ] External integrations have timeouts
- [ ] Background jobs are safe
- [ ] APIs are backward-compatible where required
- [ ] No debug code remains
- [ ] No sensitive information is logged

---

# 84. Final Node.js Principles

For every backend implementation, ask:

1. Is the code asynchronous and non-blocking?
2. Is the controller thin?
3. Is business logic in the service layer?
4. Is database access isolated?
5. Is input validated?
6. Is authentication enforced?
7. Is authorization enforced?
8. Is tenant isolation enforced?
9. Are errors handled consistently?
10. Are secrets protected?
11. Are external dependencies protected with timeouts?
12. Are retries safe?
13. Are expensive operations moved out of HTTP requests?
14. Are database queries efficient?
15. Is the code testable?
16. Does the implementation follow the existing architecture?
17. Does the implementation add unnecessary complexity?

The most important rule is:

**A Node.js backend feature is not production-ready merely because the API returns the expected response. It must also correctly enforce authentication, authorization, tenant isolation, validation, error handling, data integrity, and operational safety.**
```
