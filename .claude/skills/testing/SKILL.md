---
name: testing
description: Design, implement, review, and maintain production-grade testing for the React + TypeScript + Node.js + MongoDB multi-tenant SaaS application. Use this skill whenever writing unit tests, integration tests, API tests, component tests, end-to-end tests, authentication tests, authorization tests, multi-tenant isolation tests, database tests, mocking external services, regression tests, test fixtures, test coverage, or CI test pipelines.
---

# Testing Development Standards

## 1. Core Testing Principles

Testing should provide confidence in:

- Correctness
- Security
- Multi-tenant isolation
- Business rules
- API contracts
- Database behavior
- UI behavior
- Error handling
- Performance-sensitive behavior
- Regression prevention

Prefer testing behavior over implementation details.

Do not write tests merely to increase coverage numbers.

A test should answer:

> "What behavior are we protecting?"

---

## 2. Testing Pyramid

Prefer a balanced testing strategy:

```text
                E2E Tests
             /             \
        Integration       API Tests
       /                         \
    Component Tests          DB Tests
       \                         /
             Unit Tests
```

Use:

- Many focused unit tests
- A useful number of integration tests
- API/contract tests for important endpoints
- Component tests for important UI behavior
- A smaller number of critical E2E tests

Do not rely entirely on E2E tests.

Do not rely entirely on unit tests.

---

## 3. Test Categories

The application should consider:

### Unit Tests

Test isolated business logic.

### Integration Tests

Test interactions between application components.

### API Tests

Test HTTP endpoints and API contracts.

### Database Tests

Test MongoDB behavior and queries.

### Component Tests

Test React UI behavior.

### End-to-End Tests

Test important user workflows.

### Security Tests

Test authentication, authorization, and tenant isolation.

---

## 4. Test Behavior, Not Implementation

Prefer:

```text
User submits valid form
→ API request is made
→ success message appears
```

Instead of:

```text
setState() was called twice
```

Implementation details change frequently.

User-visible/application behavior should remain stable.

---

## 5. Arrange-Act-Assert

Prefer a clear test structure:

```text
Arrange
  ↓
Act
  ↓
Assert
```

Example:

```ts
it("creates a report for the organization", async () => {
  // Arrange

  // Act

  // Assert
});
```

Avoid tests containing multiple unrelated scenarios.

---

## 6. Test Naming

Test names should describe behavior.

Good:

```text
should reject a report belonging to another organization
```

Good:

```text
should return 403 when the user lacks report:create permission
```

Avoid vague names such as:

```text
testReportFunction
works correctly
```

---

## 7. Unit Testing

Use unit tests for:

- Business rules
- Validation
- Permission logic
- Data transformations
- Utility functions
- Calculations
- Service behavior

Keep unit tests fast.

Avoid unnecessary database/network dependencies in unit tests.

---

## 8. Service Tests

Services should be tested independently where practical.

Test:

- Successful operation
- Validation failure
- Authorization failure
- Resource not found
- Conflict
- External integration failure
- Database failure

---

## 9. Repository Tests

Repository tests should verify actual database behavior where appropriate.

Test:

- Correct filters
- Tenant scoping
- Sorting
- Pagination
- Updates
- Deletes
- Aggregations
- Unique constraints

Do not mock MongoDB for every repository test.

Actual database integration tests are valuable for database behavior.

---

## 10. MongoDB Testing

Database tests should verify:

```text
Organization A
  ↓
User A
  ↓
Resource A

Organization B
  ↓
User B
  ↓
Resource B
```

Then verify:

```text
User A → Resource A = Allowed

User A → Resource B = Denied
```

Tenant isolation must be explicitly tested.

---

## 11. Test Database

Do not run destructive automated tests against production MongoDB.

Use:

- Dedicated test database
- Ephemeral MongoDB
- Containerized MongoDB
- In-memory MongoDB where appropriate

The test database must be isolated from development and production data.

---

## 12. Test Data

Use predictable test fixtures.

Example:

```ts
const organization = createOrganizationFixture();

const user = createUserFixture({
  organizationId: organization.id
});
```

Avoid duplicating large object literals throughout tests.

---

## 13. Test Factories

Prefer factories for complex domain objects.

Examples:

```text
createUser()
createOrganization()
createMembership()
createReport()
createDashboard()
```

Allow overrides:

```ts
createUser({
  role: "viewer"
});
```

Factories should produce valid default objects.

---

## 14. Test Fixtures

Fixtures should be:

- Small
- Predictable
- Reusable
- Easy to override

Avoid fixtures containing unnecessary unrelated data.

---

## 15. Test Isolation

Each test should be independent.

Avoid:

```text
Test A creates data
↓
Test B depends on Test A
```

Prefer:

```text
Test A
  ↓
Own setup
  ↓
Own assertions
  ↓
Own cleanup

Test B
  ↓
Own setup
```

Tests should be safe to run independently.

---

## 16. Test Cleanup

Clean up test data after tests when using shared databases.

Consider:

- Transactions where supported
- Collection cleanup
- Database reset
- Ephemeral databases

Avoid cleanup that depends on test execution order.

---

## 17. Authentication Tests

Authentication tests should cover:

- Valid credentials
- Invalid credentials
- Missing credentials
- Expired tokens
- Invalid tokens
- Revoked sessions
- Invalid refresh tokens
- Refresh token rotation where applicable
- Logout

---

## 18. Authorization Tests

Authorization tests should cover:

- Authorized user
- Unauthorized user
- Missing permission
- Incorrect role
- Suspended membership
- Removed membership
- Resource ownership

Example:

```text
Viewer
  ↓
GET report
= Allowed

Viewer
  ↓
DELETE report
= Forbidden
```

---

## 19. Multi-Tenant Security Tests

Every tenant-owned resource should have cross-tenant tests.

Minimum scenarios:

### Same Tenant

```text
User A
Organization A
Resource A

Expected: Allowed
```

### Different Tenant

```text
User A
Organization A
Resource B
Organization B

Expected: Denied
```

### No Membership

```text
User A
Organization B

Expected: Denied
```

### Revoked Membership

```text
Previously authorized user
Membership revoked

Expected: Denied
```

---

## 20. IDOR Testing

Test for insecure direct object references.

Example:

```http
GET /api/reports/report-from-other-tenant
```

Expected:

```http
403
```

or:

```http
404
```

depending on the API security design.

Never allow an ID alone to bypass tenant authorization.

---

## 21. API Testing

Every important API should test:

- Valid request
- Invalid request
- Missing required fields
- Authentication
- Authorization
- Tenant isolation
- Not found
- Conflict
- Validation errors
- Server errors

---

## 22. HTTP Status Codes

Verify appropriate status codes.

Examples:

```text
200 OK
201 Created
204 No Content

400 Bad Request
401 Unauthorized
403 Forbidden
404 Not Found
409 Conflict
422 Unprocessable Entity

500 Internal Server Error
502 Bad Gateway
503 Service Unavailable
```

Do not make every failed request return `500`.

---

## 23. API Contract Tests

Verify that API responses match the expected contract.

Test:

- Response shape
- Required fields
- Field types
- Error format
- Pagination structure

This helps prevent frontend/backend contract drift.

---

## 24. Request Validation Tests

Test invalid:

- Body
- Query parameters
- Path parameters
- Headers

Examples:

```text
missing email
invalid email
invalid organizationId
negative limit
invalid date
unsupported sort field
```

---

## 25. Pagination Tests

Test:

- Default page size
- Custom page size
- Maximum page size
- Empty page
- Last page
- Cursor pagination
- Invalid cursor
- Tenant-scoped pagination

Ensure users cannot request unlimited data.

---

## 26. Filtering Tests

Test:

```text
status=active
```

and invalid filters.

Verify that unsupported fields cannot be used to manipulate database queries.

---

## 27. Sorting Tests

Test:

- Allowed sort fields
- Ascending order
- Descending order
- Invalid sort field

Do not allow arbitrary MongoDB expressions to become sort instructions.

---

## 28. NoSQL Injection Tests

Test malicious inputs such as:

```json
{
  "email": {
    "$ne": null
  }
}
```

and:

```json
{
  "email": {
    "$gt": ""
  }
}
```

The application should validate/reject them according to the API contract.

Never allow arbitrary MongoDB operators through user input.

---

## 29. Mass Assignment Tests

Attempt to modify protected fields:

```json
{
  "name": "User",
  "role": "admin",
  "organizationId": "another-org",
  "permissions": ["*"]
}
```

Verify protected fields remain unchanged.

---

## 30. XSS Tests

Test user-controlled fields with representative payloads.

Examples:

```html
<script>alert(1)</script>
```

and:

```html
<img src=x onerror=alert(1)>
```

Verify:

- Input is safely handled.
- HTML is escaped or sanitized.
- Dangerous content is not executed.

---

## 31. CSRF Tests

Where cookie-based authentication is used, test that state-changing requests cannot be executed without the required CSRF protections.

Test:

```text
Missing CSRF token
Invalid CSRF token
Valid CSRF token
```

---

## 32. CORS Tests

Verify:

### Allowed origin

Request is accepted.

### Unknown origin

Request is rejected or browser policy prevents access.

### Credentialed request

Verify cookie/authentication behavior is correct.

Do not treat CORS as authorization.

---

## 33. Rate Limit Tests

Test sensitive endpoints:

```text
/login
/password-reset
/invitations
/oauth
/exports
```

Verify excessive requests are rejected or delayed appropriately.

Do not make tests dependent on real production rate-limit infrastructure.

---

## 34. Idempotency Tests

For idempotent operations:

```text
Request
↓
Request repeated
```

Expected:

No unintended duplicate resource.

Test:

- Same idempotency key
- Different idempotency key
- Concurrent duplicate requests
- Failed request retry

---

## 35. Webhook Tests

Test:

- Valid signature
- Invalid signature
- Missing signature
- Invalid payload
- Duplicate event
- Replay
- Unknown event
- Wrong tenant/integration
- Provider failure

Never trust webhook payloads without verification.

---

## 36. OAuth Tests

Test:

- Valid authorization flow
- Invalid state
- Missing state
- Expired state
- Invalid callback
- Invalid authorization code
- Provider error
- Token exchange failure
- Refresh token failure

Do not use real production OAuth credentials in tests.

---

## 37. External API Tests

Mock external providers.

Test:

```text
Success
401
403
404
429
500
Timeout
Network failure
Invalid response
```

Also test retry behavior.

---

## 38. Retry Tests

Verify that retry logic:

- Has a maximum retry count.
- Uses appropriate backoff.
- Does not retry permanent errors.
- Does not duplicate non-idempotent operations.
- Handles provider rate limits correctly.

---

## 39. Timeout Tests

Simulate external APIs that never respond or respond too slowly.

Verify:

- Request eventually fails.
- Resources are released.
- Appropriate error is returned.
- Retry behavior is controlled.

---

## 40. React Component Testing

Test user-visible behavior.

Examples:

```text
User enters email
↓
Validation message appears
```

```text
User clicks Save
↓
Button becomes disabled
↓
Request is submitted
↓
Success message appears
```

Do not test implementation details unnecessarily.

---

## 41. React Form Tests

Test:

- Initial state
- Valid submission
- Invalid submission
- Required fields
- Field-level errors
- Server validation errors
- Loading state
- Duplicate submission prevention
- Successful submission

---

## 42. React Loading Tests

Test:

```text
Initial request
↓
Loading UI
↓
Response
↓
Content
```

Also test slow responses where appropriate.

---

## 43. React Error Tests

Test:

```text
API failure
↓
Error state
↓
User-friendly message
↓
Retry
```

Do not expose raw backend errors to users.

---

## 44. React Empty State Tests

Test:

```text
API success
↓
[]
↓
Empty state
```

Ensure empty data is not incorrectly treated as loading or an error.

---

## 45. Authorization UI Tests

Test:

```text
Admin
→ Delete button visible
```

```text
Viewer
→ Delete button hidden
```

But also test the backend:

```text
Viewer
→ DELETE API
→ 403
```

Frontend authorization is UX.

Backend authorization is security.

---

## 46. Organization Switching Tests

Test:

```text
Organization A selected
↓
A data displayed

Switch to Organization B
↓
A data cleared/invalidation occurs
↓
B data loaded
```

Verify no Organization A data remains visible under Organization B.

---

## 47. Authentication UI Tests

Test:

- Login success
- Login failure
- Logout
- Expired session
- Refresh flow
- Unauthorized response
- Forbidden response
- Protected route
- Public route

---

## 48. Protected Route Tests

Test:

```text
Authenticated user
→ Protected page
→ Allowed
```

```text
Unauthenticated user
→ Protected page
→ Redirect/login
```

Do not treat route protection as backend security.

---

## 49. Hook Testing

Test custom hooks when they contain meaningful logic.

Examples:

```text
useAuth()
useCurrentOrganization()
useReports()
usePagination()
usePermissions()
```

Focus on behavior.

Avoid testing React internals.

---

## 50. E2E Testing

E2E tests should cover critical workflows.

Examples:

```text
Signup
→ Verify account
→ Login
→ Create organization
→ Invite member
→ Login as invited user
→ Access organization
```

Other important workflows:

```text
Login
→ Dashboard
→ Reports
→ Create report
→ Edit report
→ Delete report
```

---

## 51. Multi-Tenant E2E Tests

Include at least one complete cross-tenant workflow.

Example:

```text
Create Organization A
Create User A

Create Organization B
Create User B

Login as User A

Attempt to access Organization B
→ Denied
```

This protects the most important SaaS security boundary.

---

## 52. E2E Test Data

E2E tests should create isolated test data.

Avoid depending on manually created records.

Prefer:

```text
Test starts
↓
Create required organization
↓
Create required user
↓
Run workflow
↓
Cleanup
```

---

## 53. Test Authentication in E2E

Do not bypass authentication for every E2E test.

Some tests may use authenticated state for efficiency, but maintain dedicated tests for the actual login flow.

Test both:

- Authentication mechanism
- Authenticated application behavior

---

## 54. Database Integration Tests

Test actual MongoDB behavior for important repositories.

Examples:

```text
create
find
update
delete
aggregate
pagination
tenant filtering
unique constraints
```

Do not rely exclusively on mocked database responses.

---

## 55. Database Constraint Tests

Test:

- Unique indexes
- Duplicate records
- Required fields
- Tenant-aware uniqueness
- Referential/application-level relationships

Example:

Two organizations may both have:

```text
admin@example.com
```

if the business model allows it.

Do not assume global uniqueness where tenant-scoped uniqueness is required.

---

## 56. Concurrent Operation Tests

Security-sensitive operations should consider concurrency.

Examples:

- Duplicate invitation
- Duplicate organization creation
- Concurrent role changes
- Duplicate webhook
- Duplicate payment request

Test that race conditions do not create invalid state.

---

## 57. Transaction Tests

Where MongoDB transactions are used, test:

### Success

All operations committed.

### Failure

All operations rolled back.

Example:

```text
Create Organization
↓
Create Owner Membership
↓
Create Subscription
```

If an operation fails, verify the expected rollback behavior.

---

## 58. Error Path Testing

Do not test only successful paths.

For each important operation, consider:

```text
Success
Validation failure
Unauthorized
Forbidden
Not found
Conflict
Database failure
External API failure
Timeout
Unexpected error
```

---

## 59. Boundary Testing

Test values at boundaries.

Examples:

```text
limit = 1
limit = MAX_LIMIT
limit = MAX_LIMIT + 1

empty string
maximum string length
maximum file size

date range = 1 day
date range = maximum allowed range
```

Boundary tests often find bugs missed by normal cases.

---

## 60. Property-Based Testing

Consider property-based testing for logic with many possible inputs.

Useful for:

- Validation
- Parsers
- Data transformations
- Calculations
- Filters

Do not introduce property-based testing everywhere.

Use it where it provides meaningful value.

---

## 61. Snapshot Tests

Use snapshots selectively.

Good candidates:

- Stable structured output
- Complex serialized UI
- Configuration output

Avoid snapshotting large components simply because it is easy.

Large snapshots become difficult to review and maintain.

---

## 62. Mocking Principles

Mock external boundaries when necessary.

Good candidates:

- External APIs
- Email providers
- Payment providers
- OAuth providers
- Cloud services

Avoid mocking the code under test.

Do not mock everything.

Over-mocking can make tests pass while the real system is broken.

---

## 63. Mock Database vs Real Database

Prefer:

```text
Unit tests:

Service
↓
Mock Repository
```

Integration tests:

```text
Service
↓
Real Repository
↓
Test MongoDB
```

Both are useful.

Do not replace integration tests with mocks entirely.

---

## 64. Test Doubles

Use:

- Mock
- Stub
- Spy
- Fake

intentionally.

Document unusual test doubles when their behavior is important.

---

## 65. Time-Dependent Tests

Avoid tests that depend on the real current time.

Prefer controllable clocks/fake timers when appropriate.

Test:

- Token expiration
- Password reset expiry
- Invitation expiry
- Session expiry
- Date filters
- Scheduled jobs

---

## 66. Randomness in Tests

Avoid uncontrolled randomness.

Use deterministic seeds or controlled random values where appropriate.

Security-sensitive randomness should still use secure random generation in production.

Tests may use deterministic fixtures for reproducibility.

---

## 67. Async Tests

Always properly await asynchronous operations.

Bad:

```ts
it("creates a report", () => {
  service.createReport();
  expect(...);
});
```

Prefer:

```ts
it("creates a report", async () => {
  await service.createReport();

  expect(...);
});
```

Unhandled asynchronous operations can cause false-positive tests.

---

## 68. Promise Rejection Tests

Explicitly test rejected promises.

Example:

```ts
await expect(
  service.createReport(input)
).rejects.toThrow();
```

Do not rely on unhandled rejection behavior.

---

## 69. Test Timeouts

Avoid unnecessarily large test timeouts.

A test that hangs for several minutes makes CI failures difficult to diagnose.

Use explicit timeouts only when the operation genuinely requires them.

---

## 70. Flaky Tests

A flaky test is a real engineering problem.

Common causes:

- Shared state
- Timing assumptions
- Network dependencies
- Random data
- Test ordering
- Race conditions
- Incomplete async handling

Do not simply increase the timeout to hide flakiness.

Find the root cause.

---

## 71. Parallel Tests

Tests should be safe to run in parallel where practical.

Avoid shared:

- Database records
- Files
- Ports
- Global state

Use unique test identifiers where necessary.

---

## 72. Test Naming Structure

Prefer:

```ts
describe("ReportService", () => {
  describe("createReport", () => {
    it("creates a report for an authorized organization member", () => {});
    it("rejects users without report:create permission", () => {});
    it("rejects resources belonging to another organization", () => {});
  });
});
```

This makes failures easier to understand.

---

## 73. Test Coverage

Coverage is useful as a signal.

It is not the goal.

High coverage does not guarantee:

- Correct security
- Correct business logic
- Correct tenant isolation
- Good UX

Prioritize important paths over arbitrary percentages.

---

## 74. Coverage Priorities

Prioritize coverage for:

- Authentication
- Authorization
- Tenant isolation
- Billing
- Organization management
- Membership management
- Data deletion
- External integrations
- Critical business rules

---

## 75. Security Coverage

Security tests should explicitly cover:

- Authentication bypass
- Authorization bypass
- Cross-tenant access
- Privilege escalation
- IDOR
- NoSQL injection
- Mass assignment
- XSS
- CSRF where applicable
- SSRF
- Rate limiting
- Secret exposure

---

## 76. Regression Tests

Whenever a bug is fixed:

1. Reproduce the bug.
2. Add a regression test.
3. Fix the bug.
4. Verify the test fails before the fix if practical.
5. Verify it passes after the fix.

Do not rely only on manual verification.

---

## 77. Bug Test Naming

Use the bug's behavior rather than ticket number when possible.

Good:

```text
should not allow a user to access reports from another organization
```

This remains understandable after the ticket is forgotten.

---

## 78. Performance Regression Tests

For known performance-sensitive operations, consider regression tests/benchmarks.

Examples:

- Large MongoDB queries
- Analytics aggregation
- Large report generation
- Large table rendering
- Data exports

Do not make tests dependent on exact machine-specific timings unless the benchmark environment is controlled.

---

## 79. Load Testing

Use load testing for important APIs.

Test:

- Normal traffic
- Peak traffic
- Concurrent users
- Large tenants
- Large datasets
- Expensive analytics

Measure:

- Latency
- Throughput
- Error rate
- CPU
- Memory
- MongoDB load

Never perform destructive load testing against production without explicit authorization.

---

## 80. Large Tenant Testing

Test at least one realistic large-tenant scenario.

Example:

```text
Tenant A
100 records

Tenant B
1,000,000 records
```

Verify:

- Queries remain tenant-scoped.
- Pagination works.
- API responses remain bounded.
- UI remains usable.
- Analytics do not accidentally load entire datasets.

---

## 81. Test Configuration

Separate:

```text
development
test
staging
production
```

Never allow automated tests to accidentally connect to production.

Fail fast if test configuration points to a production database.

---

## 82. CI Testing

CI should run appropriate checks such as:

```bash
npm ci
npm run lint
npm run typecheck
npm test
npm run build
```

If the project has additional test commands, use those instead.

Do not invent commands that do not exist in the project's `package.json`.

---

## 83. CI Test Order

A practical order:

```text
Install dependencies
↓
Lint
↓
Type check
↓
Unit tests
↓
Integration/API tests
↓
Build
↓
E2E tests
```

The exact order can depend on project requirements.

---

## 84. Pull Request Testing

Before creating a PR:

```bash
git status
git diff
```

Then run the relevant:

- Unit tests
- Integration tests
- API tests
- Component tests
- Build
- E2E tests when required

Do not claim tests passed unless they were actually executed.

---

## 85. Test Review Checklist

When reviewing tests:

- [ ] Test behavior rather than implementation
- [ ] Test names are meaningful
- [ ] Arrange/Act/Assert is clear
- [ ] Tests are independent
- [ ] Async operations are awaited
- [ ] Important error paths are tested
- [ ] Security paths are tested
- [ ] Cross-tenant isolation is tested
- [ ] External APIs are appropriately mocked
- [ ] Database behavior is tested realistically
- [ ] No unnecessary mocking
- [ ] No flaky timing assumptions
- [ ] Regression tests exist for important bugs

---

## 86. Test Quality Checklist

Before considering a feature sufficiently tested:

- [ ] Happy path tested
- [ ] Validation tested
- [ ] Authentication tested
- [ ] Authorization tested
- [ ] Tenant isolation tested
- [ ] Not-found behavior tested
- [ ] Conflict behavior tested
- [ ] Error handling tested
- [ ] Database behavior tested
- [ ] External integration behavior tested
- [ ] UI loading state tested
- [ ] UI empty state tested
- [ ] UI error state tested
- [ ] Critical E2E flow tested

---

## 87. Test Failure Investigation

When a test fails:

1. Read the complete error.
2. Identify the first meaningful failure.
3. Determine whether the failure is:
   - Code defect
   - Test defect
   - Environment issue
   - Data/setup issue
   - Dependency issue
4. Reproduce locally.
5. Fix the root cause.
6. Re-run the smallest relevant test.
7. Run the full relevant suite.

Do not modify assertions simply to make a failing test pass.

---

## 88. Avoid False Positives

A test is dangerous when it passes without actually verifying the intended behavior.

Avoid tests such as:

```ts
expect(true).toBe(true);
```

or:

```ts
expect(mockService).toHaveBeenCalled();
```

without verifying the actual result.

Tests should fail when the protected behavior breaks.

---

## 89. Avoid Over-Testing Implementation

Avoid tests tightly coupled to:

- Internal state names
- Private functions
- Exact component structure
- Number of internal function calls
- Internal hook implementation

unless the behavior itself requires that contract.

---

## 90. Testing Architecture

For this application:

```text
React
  ↓
Component Tests
  ↓
API Mocking
  ↓
Node.js API
  ↓
API/Integration Tests
  ↓
MongoDB Test Database
```

For security:

```text
User
  ↓
Authentication
  ↓
Authorization
  ↓
Tenant Context
  ↓
Resource
```

Each boundary should have tests.

---

## 91. Recommended Test Matrix

| Scenario | Expected |
|---|---|
| Authenticated + same tenant + permission | Allowed |
| Authenticated + same tenant + no permission | Denied |
| Authenticated + different tenant | Denied |
| Unauthenticated | Denied |
| Revoked membership | Denied |
| Resource does not exist | Not found |
| Invalid input | Validation error |
| Duplicate request | Idempotent/Conflict |
| Database failure | Safe server error |

---

## 92. Testing Principles for Multi-Tenant SaaS

Every new tenant-owned feature should answer:

1. Can a valid tenant member access it?
2. Can an invalid tenant member access it?
3. Can another tenant access it?
4. Can a user without the permission access it?
5. Can the user manipulate the tenant ID?
6. Can the user manipulate the resource ID?
7. Can the user modify protected fields?
8. Can duplicate requests create duplicate resources?
9. Does cached data remain tenant-specific?
10. Does background processing preserve tenant context?

If any answer is unclear, add tests before considering the feature complete.

---

## 93. Final Testing Principles

For every feature, ask:

1. What behavior are we protecting?
2. What is the happy path?
3. What can go wrong?
4. What happens when authentication fails?
5. What happens when authorization fails?
6. What happens across tenants?
7. What happens with invalid input?
8. What happens when the database fails?
9. What happens when an external service fails?
10. What happens when the request is repeated?
11. What happens under concurrency?
12. What happens with large data?
13. What happens in the UI while loading?
14. What happens when there is no data?
15. What happens when an error occurs?

The most important rule is:

**Tests should protect behavior, security boundaries, and business rules — not merely implementation details or code coverage numbers.**

For this multi-tenant SaaS application, every important feature must have explicit tests for:

- Authentication
- Authorization
- Tenant isolation
- Data validation
- Business logic
- API behavior
- Database behavior
- Error handling
- Critical user workflows
