---
name: api-design
description: Design, implement, review, and improve production-grade REST APIs for the React + Node.js + TypeScript + MongoDB SaaS application. Use this skill whenever creating or modifying API endpoints, request/response contracts, validation, pagination, filtering, sorting, authentication, authorization, error handling, API versioning, OpenAPI documentation, or API performance/security.
---

# API Design Standards

## 1. General Principles

- Follow REST principles consistently.
- Keep APIs predictable, consistent, and resource-oriented.
- Follow the existing project architecture and conventions before introducing new patterns.
- Do not introduce unnecessary abstractions.
- Keep controllers/routes thin.
- Business logic belongs in the service/application layer.
- Database access belongs in the repository/data-access layer when the project architecture uses one.
- Keep API contracts explicit and strongly typed.
- Never expose internal implementation details through API contracts.
- Prefer backward-compatible changes whenever possible.
- Do not modify unrelated APIs while implementing a feature.

---

## 2. REST API Design

Use resource-oriented URLs.

Preferred:

GET    /api/v1/users
GET    /api/v1/users/:id
POST   /api/v1/users
PATCH  /api/v1/users/:id
DELETE /api/v1/users/:id

Avoid action-oriented URLs when a standard HTTP method represents the operation.

Avoid:

POST /api/createUser
POST /api/deleteUser
POST /api/getUsers

Prefer:

POST   /api/v1/users
DELETE /api/v1/users/:id
GET    /api/v1/users

Use nouns for resources.

Prefer:

/users
/organizations
/members
/projects
/reports

Avoid:

/getUsers
/createUser
/manageUsers

Use plural resource names consistently unless the existing API convention explicitly differs.

---

## 3. HTTP Methods

Use HTTP methods according to their intended semantics.

GET:
- Retrieve resources.
- Must not modify server state.
- Should be safe and cacheable where appropriate.

POST:
- Create resources.
- Trigger operations that do not naturally map to resource replacement/update.
- Use for non-idempotent operations unless an idempotency mechanism is implemented.

PUT:
- Replace an entire resource.
- Use only when full replacement semantics are appropriate.

PATCH:
- Partially update a resource.
- Prefer PATCH when updating selected fields.

DELETE:
- Remove a resource.
- Follow the application's deletion/soft-deletion policy.

Do not use POST for every operation simply because it is convenient.

---

## 4. HTTP Status Codes

Use HTTP status codes consistently.

### Success

200 OK
- Successful GET.
- Successful update when a response body is returned.
- Successful operation with a response body.

201 Created
- Resource successfully created.

202 Accepted
- Request accepted for asynchronous processing.

204 No Content
- Successful operation with no response body.
- Commonly used for DELETE.

### Client Errors

400 Bad Request
- Malformed request.
- Invalid request structure.

401 Unauthorized
- Authentication is missing or invalid.

403 Forbidden
- User is authenticated but does not have permission.

404 Not Found
- Requested resource does not exist or is intentionally hidden.

409 Conflict
- Resource state conflicts with the requested operation.
- Duplicate unique resource where appropriate.

422 Unprocessable Entity
- Request structure is valid but semantic validation fails, if this convention is used consistently.

429 Too Many Requests
- Rate limit exceeded.

### Server Errors

500 Internal Server Error
- Unexpected server-side failure.

502 Bad Gateway
- Upstream service failure where applicable.

503 Service Unavailable
- Temporary service unavailability.

Do not return 200 for failed operations.

---

## 5. URL and Resource Conventions

Use lowercase URL paths.

Prefer:

/api/v1/users
/api/v1/organizations
/api/v1/reports

Avoid inconsistent casing:

/api/v1/UserList
/api/v1/User_List

Use path parameters for resource identity:

GET /api/v1/users/:userId

Use query parameters for filtering, sorting, pagination, and searching:

GET /api/v1/users?page=1&limit=20
GET /api/v1/users?status=active
GET /api/v1/users?sortBy=createdAt&sortOrder=desc

Do not put large collections of optional filters into the URL path.

---

## 6. Request Headers

Use standard headers appropriately.

Common headers include:

Authorization
Content-Type
Accept
If-Match
If-None-Match
Idempotency-Key
X-Request-ID or equivalent correlation identifier

Do not create custom headers when a standard HTTP header already solves the problem.

Never place access tokens in query parameters.

---

## 7. DTOs

Use DTOs or equivalent request/response types to define API contracts.

Do not expose database models directly unless the project architecture explicitly allows it.

Example:

User database model:

{
  _id,
  passwordHash,
  internalFields,
  createdAt
}

API response:

{
  id,
  name,
  email,
  createdAt
}

Never expose:

- password hashes
- refresh tokens
- internal secrets
- database implementation details
- internal authorization metadata
- sensitive fields that the client does not need

Keep request DTOs and response DTOs separate when their purposes differ.

---

## 8. Request Validation

Validate every external input.

Validate:

- Path parameters
- Query parameters
- Request body
- Headers when applicable
- File metadata
- Pagination values
- Sorting fields
- Filter values

Never trust frontend validation alone.

Frontend validation improves user experience.

Backend validation provides security and correctness.

Validate:

- Required fields
- Data types
- String length
- Numeric ranges
- Enum values
- Formats
- Object IDs
- Email addresses
- Dates
- Nested objects
- Arrays
- Business constraints

Reject invalid input before executing business logic.

Use the project's existing validation library and conventions.

Do not introduce a new validation library without justification.

---

## 9. Response Validation

API responses should follow consistent contracts.

Do not return different response shapes for the same endpoint depending on execution path.

Prefer a predictable structure.

Example:

{
  "success": true,
  "data": {
    "id": "123",
    "name": "Example"
  }
}

For collections:

{
  "success": true,
  "data": [],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 100,
    "totalPages": 5
  }
}

Follow the existing project's response envelope if one already exists.

Do not introduce a new response format into an existing API without a strong reason.

---

## 10. Error Responses

Use a consistent error format.

Preferred structure:

{
  "success": false,
  "error": {
    "code": "RESOURCE_NOT_FOUND",
    "message": "User not found",
    "details": {}
  }
}

Error responses should contain:

- Stable machine-readable error code.
- Safe human-readable message.
- Optional structured details.

Do not expose:

- Stack traces
- Database errors
- SQL/MongoDB internals
- Secrets
- Internal file paths
- Infrastructure details

Use stable error codes rather than forcing frontend applications to parse error messages.

Example:

RESOURCE_NOT_FOUND
VALIDATION_ERROR
UNAUTHORIZED
FORBIDDEN
DUPLICATE_RESOURCE
INVALID_TOKEN
TENANT_ACCESS_DENIED

---

## 11. Pagination

Any endpoint that can return a large collection must support pagination.

Do not return unbounded collections.

Preferred query parameters:

?page=1&limit=20

or cursor-based pagination where appropriate:

?cursor=abc123&limit=20

Validate pagination values.

Apply reasonable maximum limits.

Example:

page >= 1
limit >= 1
limit <= 100

Do not allow clients to request unlimited records through:

?limit=999999999

For large or frequently changing datasets, consider cursor-based pagination.

---

## 12. Filtering

Use query parameters for filtering.

Example:

GET /api/v1/users?status=active
GET /api/v1/orders?status=pending&customerId=123

Validate filter fields.

Do not allow arbitrary MongoDB operators from client input.

Never directly pass request query objects into MongoDB.

Bad:

Model.find(req.query)

Prefer explicitly mapped filters:

const filter = {
  status: validatedStatus,
  organizationId: organizationId
};

Only expose filters that the API intentionally supports.

---

## 13. Sorting

Use explicit allowed sorting fields.

Example:

?sortBy=createdAt&sortOrder=desc

Maintain an allowlist:

allowedSortFields = [
  "createdAt",
  "name",
  "updatedAt"
]

Never allow arbitrary client-controlled database field expressions.

Default to a deterministic sort order where appropriate.

---

## 14. Searching

Search should use explicitly supported fields.

Example:

GET /api/v1/users?search=john

Do not automatically search every database field.

For MongoDB text/search functionality, use the appropriate indexed/search mechanism.

Avoid unindexed regex queries against large collections.

Validate maximum search length.

---

## 15. Authentication

Authentication determines who the caller is.

Authentication must be handled server-side.

Do not rely on:

- User ID supplied by frontend.
- Tenant ID supplied by frontend.
- Role supplied by frontend.
- Permission supplied by frontend.

If using JWT:

- Validate signature.
- Validate expiration.
- Validate issuer/audience where applicable.
- Validate required claims.
- Do not trust decoded JWT payload until signature verification succeeds.

Never log access tokens or refresh tokens.

Do not place authentication tokens in URLs.

---

## 16. Authorization

Authentication and authorization are separate concerns.

Authentication:

"Who is this user?"

Authorization:

"Can this user perform this operation?"

Every protected endpoint must perform authorization where required.

Check:

- User identity
- Organization/tenant membership
- Role
- Permission
- Resource ownership
- Resource access rules

Do not assume that authenticated users can access every resource.

---

## 17. Multi-Tenant Authorization

This application is multi-tenant.

Tenant isolation is mandatory.

Never trust tenantId supplied directly by:

- Request body
- Query parameters
- URL parameters
- Frontend state

Tenant context should be derived from authenticated server-side identity and validated membership.

For every tenant-owned resource:

1. Authenticate the user.
2. Determine tenant context.
3. Verify the user belongs to the tenant.
4. Verify required role/permission.
5. Scope the database query to the tenant.
6. Perform the operation.

Example:

const filter = {
  _id: resourceId,
  organizationId: authenticatedOrganizationId
};

Do not do:

const filter = {
  _id: resourceId
};

if the resource is tenant-owned.

Never allow a user from Tenant A to access Tenant B resources by manipulating an ID.

Return an appropriate authorization/not-found response according to the application's security policy.

---

## 18. RBAC and Permissions

If the application uses roles and permissions:

- Keep authorization rules centralized.
- Avoid duplicating permission checks across controllers.
- Use explicit permission names.
- Do not rely solely on frontend route protection.
- Backend authorization is authoritative.

Example:

users:read
users:create
users:update
users:delete
reports:read
reports:create
organization:manage

The frontend may hide unauthorized UI elements, but the backend must enforce the permission.

---

## 19. Idempotency

Use idempotency for operations where duplicate requests could create serious side effects.

Typical examples:

- Payment creation
- Order creation
- External resource creation
- Long-running jobs
- Webhook processing

Use:

Idempotency-Key: <unique-key>

The server should safely recognize repeated requests using the same key.

Do not implement idempotency superficially.

Define:

- Key format
- Expiration
- Request matching
- Stored response
- Conflict behavior

---

## 20. API Versioning

Use the project's established versioning strategy.

Example:

/api/v1/users
/api/v2/users

Do not introduce API versioning inconsistently.

When introducing breaking changes:

- Create a new version when appropriate.
- Maintain backward compatibility where possible.
- Document deprecated endpoints.
- Define migration paths.

Avoid breaking existing consumers without explicit consideration.

---

## 21. OpenAPI

Document public APIs using OpenAPI/Swagger where the project supports it.

Document:

- Endpoint
- HTTP method
- Parameters
- Request body
- Response body
- Status codes
- Authentication
- Validation rules
- Error responses

Keep documentation synchronized with implementation.

Do not document behavior that the API does not actually implement.

---

## 22. Rate Limiting

Apply rate limiting where appropriate.

Especially consider:

- Login
- Signup
- Password reset
- OTP
- Token refresh
- Public APIs
- Expensive analytics endpoints

Return:

429 Too Many Requests

when limits are exceeded.

Do not use a single global limit for every API if different endpoints have significantly different risk profiles.

---

## 23. Caching

Use caching where it provides measurable benefit.

Consider:

- HTTP caching
- ETags
- Application caching
- Redis where appropriate
- CDN caching for suitable public resources

Do not cache sensitive or user-specific data without carefully defining cache keys and isolation.

Tenant-specific data must never leak through shared caches.

---

## 24. Request Timeouts

External service calls must have reasonable timeouts.

Do not allow API requests to hang indefinitely.

Handle:

- Database timeout
- External API timeout
- Network failure
- Retry behavior

Do not blindly retry non-idempotent operations.

---

## 25. External APIs

When calling external services:

- Validate responses.
- Handle timeouts.
- Handle rate limits.
- Handle authentication failures.
- Handle transient failures.
- Log useful diagnostic information without logging secrets.
- Use retries only where appropriate.
- Use idempotency where supported.

Do not assume external APIs always return valid or expected data.

---

## 26. Transactions and Consistency

Use database transactions when multiple related operations must succeed or fail together.

Do not use transactions automatically for every operation.

Consider:

- Atomicity
- Consistency
- Failure recovery
- Concurrency
- Performance

For MongoDB, follow the project's established transaction strategy.

Do not introduce transactions without understanding the deployment topology and database configuration.

---

## 27. Concurrency

Consider concurrent requests when modifying shared resources.

Examples:

- Updating account balances
- Changing subscription state
- Updating inventory
- Processing jobs
- Updating membership/roles

Consider:

- Optimistic concurrency
- Atomic MongoDB operations
- Transactions
- Version fields
- Conditional updates

Do not assume requests execute sequentially.

---

## 28. Logging

Use structured logging where possible.

Include:

- Request ID/correlation ID
- Endpoint
- HTTP method
- Status code
- Duration
- Relevant resource ID
- Tenant/organization identifier when safe
- Error code

Never log:

- Passwords
- Access tokens
- Refresh tokens
- API keys
- Secrets
- Sensitive personal data unnecessarily

Use appropriate log levels.

---

## 29. Correlation IDs

Support a request/correlation identifier for tracing requests across services.

Example:

X-Request-ID: abc123

If the client supplies one, validate it according to project policy.

Otherwise generate one server-side.

Include it in logs and error responses where appropriate.

---

## 30. Security

Follow OWASP API security principles.

Protect against:

- Broken authentication
- Broken authorization
- Object-level authorization failures
- NoSQL injection
- Excessive data exposure
- Mass assignment
- Rate-limit abuse
- SSRF
- XSS where applicable
- CSRF where applicable
- Malicious payloads

Never directly pass untrusted input into database queries.

Never dynamically construct database operators from raw client input.

Whitelist allowed fields, operators, and values.

---

## 31. Mass Assignment Protection

Never blindly assign request body fields to database models.

Avoid:

Object.assign(user, req.body)

unless the input has already been strictly validated and transformed.

Explicitly map allowed fields.

Example:

const update = {
  firstName: validated.firstName,
  lastName: validated.lastName
};

This prevents clients from modifying protected fields such as:

- role
- organizationId
- permissions
- accountStatus
- subscription
- security settings

---

## 32. MongoDB-Specific API Safety

The API layer must not expose MongoDB query syntax directly to clients.

Do not allow clients to submit arbitrary:

$where
$regex
$expr
$gt
$lt
$ne
$in

or other MongoDB operators unless explicitly supported and safely validated.

Do not directly use:

Model.find(req.query)

Always transform and validate API input before constructing MongoDB filters.

---

## 33. Performance

Avoid APIs that:

- Return unnecessary fields.
- Return huge payloads.
- Execute unnecessary database queries.
- Perform N+1 queries.
- Run unindexed database operations.
- Fetch data that the client does not need.

Use:

- Pagination
- Projection
- Appropriate indexes
- Efficient queries
- Caching where appropriate
- Aggregation where appropriate

Do not optimize prematurely.

Measure or identify a concrete performance issue before introducing complex optimizations.

---

## 34. Response Payloads

Return only data required by the consumer.

Avoid exposing entire database documents.

Prefer:

{
  "id": "...",
  "name": "...",
  "email": "..."
}

instead of returning every database field.

Be especially careful with:

- Authentication data
- Authorization data
- Internal IDs
- Secrets
- Internal metadata
- Audit information
- Sensitive personal information

---

## 35. File Uploads

For file upload APIs:

- Validate file type.
- Validate file size.
- Do not trust file extensions.
- Validate MIME type where appropriate.
- Generate safe storage names.
- Prevent path traversal.
- Scan files where required.
- Store files outside the application server when appropriate.
- Do not expose internal storage paths.

Do not allow unrestricted file uploads.

---

## 36. Webhooks

Webhook endpoints must:

- Authenticate/verify the sender.
- Validate payloads.
- Prevent replay attacks where applicable.
- Be idempotent.
- Handle duplicate delivery.
- Return appropriate status codes.
- Process asynchronously when appropriate.

Never assume a webhook is delivered exactly once.

---

## 37. API Testing

Every important API should have appropriate tests.

Test:

### Authentication

- Missing token
- Invalid token
- Expired token

### Authorization

- Unauthorized user
- Wrong tenant
- Missing permission
- Resource ownership

### Validation

- Missing required field
- Invalid type
- Invalid format
- Invalid enum
- Invalid ID

### Business logic

- Successful operation
- Expected failure
- Duplicate operation
- Concurrent operation where relevant

### Pagination

- Default pagination
- Maximum limit
- Invalid page
- Empty result

### Error handling

- 400
- 401
- 403
- 404
- 409
- 422
- 429
- 500

Do not remove or weaken tests simply to make the implementation pass.

---

## 38. API Changes

Before modifying an existing API:

1. Inspect all consumers.
2. Understand the existing contract.
3. Determine whether the change is breaking.
4. Prefer backward-compatible changes.
5. Update validation.
6. Update response types.
7. Update tests.
8. Update OpenAPI documentation.
9. Check frontend usage.
10. Check other services/integrations.

Do not silently change response fields or status codes.

---

## 39. Implementation Workflow

When implementing a new endpoint:

1. Understand the requirement.
2. Inspect existing API patterns.
3. Identify the resource.
4. Define request DTO.
5. Define response DTO.
6. Define validation rules.
7. Define authentication requirements.
8. Define authorization requirements.
9. Define tenant isolation requirements.
10. Define service/business logic.
11. Define database interaction.
12. Define error cases.
13. Implement the endpoint.
14. Add tests.
15. Run lint/type checking.
16. Run relevant tests.
17. Review security.
18. Review API consistency.
19. Update OpenAPI documentation if applicable.

Do not immediately start coding before understanding the existing API architecture.

---

## 40. API Review Checklist

When reviewing an API, check:

- [ ] REST principles followed
- [ ] Correct HTTP method
- [ ] Correct HTTP status codes
- [ ] Consistent URL naming
- [ ] Request DTO defined
- [ ] Response DTO defined
- [ ] Input validation implemented
- [ ] Output does not expose sensitive fields
- [ ] Authentication implemented where required
- [ ] Authorization implemented
- [ ] Tenant isolation enforced
- [ ] RBAC/permissions checked where required
- [ ] Pagination implemented for collections
- [ ] Filtering validated
- [ ] Sorting uses an allowlist
- [ ] Search is safely implemented
- [ ] Error response is consistent
- [ ] Stable error codes used
- [ ] Idempotency considered
- [ ] API versioning considered
- [ ] Rate limiting considered
- [ ] Request timeout considered
- [ ] Logging implemented safely
- [ ] Correlation ID supported where appropriate
- [ ] MongoDB queries do not use raw client input
- [ ] No mass assignment vulnerability
- [ ] Performance considered
- [ ] Tests added
- [ ] OpenAPI documentation updated

---

## 41. Decision Rule

When making API design decisions:

1. Follow existing project conventions first.
2. Prefer simple and predictable REST design.
3. Prefer backward compatibility.
4. Prefer explicit validation over implicit behavior.
5. Prefer server-side authorization.
6. Prefer tenant isolation by construction.
7. Prefer safe defaults.
8. Prefer consistent contracts.
9. Prefer measurable performance improvements.
10. Do not introduce complexity without a clear benefit.

If an existing project convention conflicts with these guidelines, inspect the existing architecture and explain the tradeoff before making a broad change.
:::