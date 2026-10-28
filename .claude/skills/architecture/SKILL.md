---
name: architecture
description: Design, implement, review, and improve the architecture of the React + TypeScript + Node.js + TypeScript + MongoDB multi-tenant SaaS application. Use this skill whenever introducing new features, modules, services, APIs, database access, authentication, authorization, integrations, background jobs, or significant structural changes.
---

# Architecture Standards

## 1. Core Principles

Follow these principles throughout the application:

- Prefer simple, maintainable architecture over unnecessary complexity.
- Follow the existing project architecture before introducing new patterns.
- Keep responsibilities clearly separated.
- Apply separation of concerns.
- Follow SOLID principles where they improve maintainability.
- Keep dependencies flowing in a controlled direction.
- Avoid tight coupling between unrelated modules.
- Prefer composition over inheritance.
- Keep business logic independent from infrastructure where practical.
- Avoid premature abstraction.
- Avoid premature optimization.
- Do not introduce a new library, framework, architectural pattern, or infrastructure component without a clear reason.
- Do not refactor unrelated parts of the application while implementing a feature.
- Prefer incremental architectural improvements over large rewrites.

---

## 2. Application Architecture

Use clear boundaries between major application responsibilities.

A recommended backend structure is:

src/
├── config/
├── controllers/
├── routes/
├── services/
├── repositories/
├── models/
├── schemas/
├── middleware/
├── validators/
├── types/
├── utils/
├── integrations/
├── jobs/
└── app/

The exact structure may differ depending on the existing project.

Do not force this structure into an existing project if another well-designed structure is already established.

The key requirement is separation of responsibilities, not the exact folder names.

---

## 3. Recommended Backend Dependency Flow

Prefer:

Route
  ↓
Controller
  ↓
Service
  ↓
Repository
  ↓
MongoDB

With supporting concerns:

Middleware
  ↓
Authentication / Authorization

Validation
  ↓
Controller

Service
  ↓
External Integrations

Repository
  ↓
Database

Do not allow controllers to contain substantial business logic.

Avoid:

Controller
  ↓
MongoDB directly

when the project uses a service/repository architecture.

---

## 4. Routes

Routes should primarily define:

- HTTP method
- URL
- Middleware
- Validation
- Controller

Example:

router.post(
  "/users",
  authenticate,
  authorize("users:create"),
  validate(createUserSchema),
  userController.create
);

Routes should not contain business logic.

Avoid large inline route handlers.

---

## 5. Controllers

Controllers are responsible for translating HTTP requests into application operations.

Controllers should:

- Read validated input.
- Read authenticated user context.
- Read tenant context.
- Call the appropriate service.
- Return the appropriate HTTP response.
- Delegate errors to centralized error handling.

Controllers should not:

- Contain complex business logic.
- Build complicated MongoDB queries.
- Implement authorization rules repeatedly.
- Call multiple unrelated external services directly.
- Contain large validation implementations.
- Contain transaction orchestration unless the project explicitly uses controller-level orchestration.

Keep controllers thin.

---

## 6. Services

Services contain business/application logic.

Services should:

- Implement business rules.
- Coordinate repositories.
- Coordinate external integrations.
- Enforce business-level authorization where required.
- Manage transactions when appropriate.
- Coordinate multiple related operations.

Example:

createReport()
  ↓
validate business rules
  ↓
check organization permissions
  ↓
save report
  ↓
create audit record
  ↓
return result

Services should not depend directly on HTTP-specific objects when avoidable.

Avoid putting:

req
res
next

inside domain/business logic.

---

## 7. Repositories / Data Access

Repositories or data-access modules should encapsulate database operations where the project architecture uses this pattern.

Responsibilities:

- Query MongoDB.
- Persist documents.
- Update documents.
- Delete documents.
- Perform database-specific operations.
- Encapsulate database query implementation.

Repositories should not contain HTTP logic.

Repositories should not decide whether a user has permission to perform an operation.

Prefer:

Service
  ↓
Repository
  ↓
MongoDB

Avoid:

Controller
  ↓
MongoDB
  ↓
Business logic
  ↓
HTTP response

---

## 8. Domain Logic

Business rules should live in appropriate domain/application services rather than UI components, controllers, or database models.

Examples:

- Subscription rules
- Organization membership
- Report access
- User permissions
- Billing rules
- Data access policies
- Workflow transitions

The same business rule should not be duplicated across:

- React
- Controllers
- Services
- Repositories

The backend should remain the authoritative location for security-sensitive business rules.

---

## 9. React Architecture

The frontend should separate presentation from business/data concerns.

A recommended conceptual structure:

React Components
      ↓
Hooks / Application State
      ↓
API Client
      ↓
Backend APIs

Avoid putting large API calls and business workflows directly into UI components.

Prefer reusable hooks/services where appropriate.

Example:

Component
  ↓
useUsers()
  ↓
userService
  ↓
API client
  ↓
Backend API

Components should primarily handle:

- Presentation
- User interaction
- UI state
- Rendering

They should not become large containers for unrelated business logic.

---

## 10. React Components

Prefer:

- Small focused components.
- Reusable components.
- Composition.
- Explicit props.
- Strong TypeScript types.
- Predictable state management.

Avoid:

- Huge components.
- Excessive prop drilling when a better established pattern exists.
- Duplicate UI logic.
- Duplicate API logic.
- Business rules embedded in presentation code.

Do not create abstractions simply because two components share a few lines of code.

Extract a component when the shared behavior has meaningful reuse or improves maintainability.

---

## 11. State Management

Use the simplest state mechanism appropriate for the problem.

Prefer:

Local component state
  ↓
when state is local.

Context
  ↓
when state is shared within a logical application boundary.

Existing state-management solution
  ↓
when application-wide state requires it.

Do not introduce Redux, Zustand, MobX, or another state library unless there is a clear requirement and the project does not already have an established solution.

Avoid duplicating the same state across multiple stores.

Prefer derived state over duplicated state.

---

## 12. API Client Architecture

Frontend API calls should be centralized where practical.

Prefer:

React component
  ↓
Hook
  ↓
API service/client
  ↓
HTTP client
  ↓
Backend

Avoid scattering:

fetch(...)
axios(...)
  
through dozens of components.

The API client should centralize:

- Base URL
- Authentication headers
- Token handling
- Error normalization
- Request configuration
- Response parsing
- Retry behavior where appropriate

Follow the existing project implementation before introducing a new API client abstraction.

---

## 13. Authentication Architecture

Authentication should be separated from authorization.

Authentication answers:

"Who is the user?"

Authorization answers:

"What is this user allowed to do?"

Recommended flow:

Request
  ↓
Authentication middleware
  ↓
Verify credentials/token/session
  ↓
Build authenticated user context
  ↓
Authorization
  ↓
Controller
  ↓
Service

Do not put authorization logic only in the React frontend.

Frontend route protection improves UX.

Backend authorization provides actual security.

---

## 14. Multi-Tenant Architecture

This application is a multi-tenant SaaS system.

Tenant isolation is a fundamental architectural requirement.

Conceptually:

User
  ↓
Membership
  ↓
Organization / Tenant
  ↓
Tenant Resources

A user may belong to:

- One organization
- Multiple organizations

depending on the application's business requirements.

Do not assume:

User = Organization

unless the domain explicitly defines that relationship.

---

## 15. Tenant Context

Tenant context must be established server-side.

Preferred:

Authentication
  ↓
User identity
  ↓
Determine organization membership
  ↓
Establish tenant context
  ↓
Authorization
  ↓
Tenant-scoped service
  ↓
Tenant-scoped repository
  ↓
MongoDB

Never trust tenant identity supplied by the frontend as an authorization mechanism.

For example, do not rely solely on:

req.body.organizationId

or:

req.query.organizationId

for access control.

---

## 16. Tenant Isolation

Every tenant-owned resource must be scoped to the tenant.

Example:

{
  _id: reportId,
  organizationId: authenticatedOrganizationId
}

Avoid:

{
  _id: reportId
}

when the resource belongs to a tenant.

Tenant isolation should be enforced as close to the data-access boundary as practical.

Do not rely solely on developers remembering to add tenant filters to every query.

Where appropriate, create reusable tenant-aware repository patterns.

---

## 17. Authorization Architecture

Authorization should be centralized and consistent.

A recommended flow:

Authentication
  ↓
User
  ↓
Organization membership
  ↓
Role
  ↓
Permission
  ↓
Resource-level authorization
  ↓
Operation

Examples:

users:read
users:create
users:update
users:delete

reports:read
reports:create
reports:update
reports:delete

organization:manage

Do not scatter permission strings and authorization logic randomly across controllers.

---

## 18. Database Architecture

MongoDB is the persistence layer.

Application architecture should not expose MongoDB implementation details throughout the entire application.

Prefer:

Service
  ↓
Repository
  ↓
Mongoose / MongoDB
  ↓
Database

Keep MongoDB-specific concerns in the data layer where practical.

Examples:

- MongoDB queries
- Aggregation pipelines
- Indexes
- ObjectId conversion
- Mongoose-specific behavior

Business logic should not depend unnecessarily on MongoDB implementation details.

---

## 19. MongoDB Schema Design

Design schemas around actual application access patterns.

Consider:

- Document ownership
- Embedding vs referencing
- Query frequency
- Document size
- Index requirements
- Update patterns
- Transaction requirements
- Tenant isolation

Do not blindly normalize every MongoDB document like a relational database.

Do not blindly embed everything either.

Choose embedding or referencing based on access patterns and consistency requirements.

---

## 20. MongoDB Indexes

Indexes are part of application architecture.

For important queries:

1. Identify query patterns.
2. Determine required indexes.
3. Consider compound indexes.
4. Consider tenant-aware indexes.
5. Validate query performance.

For multi-tenant applications, frequently queried tenant resources may require indexes such as:

{
  organizationId: 1,
  createdAt: -1
}

Do not create indexes blindly.

Each index has:

- Storage cost
- Write overhead
- Maintenance cost

---

## 21. External Integrations

External APIs should be isolated behind integration/service modules.

Prefer:

Application Service
  ↓
Integration Service
  ↓
External API

Avoid calling third-party APIs directly from controllers or React components.

Integrations should handle:

- Authentication
- Request construction
- Response validation
- Error mapping
- Retries
- Timeouts
- Rate limits
- Logging

Examples:

integrations/
├── hubspot/
├── salesforce/
├── stripe/
└── email/

Use the existing project structure if integrations are already organized differently.

---

## 22. External API Failures

External systems are unreliable.

Architecture should account for:

- Timeout
- Rate limit
- Authentication failure
- Network failure
- Invalid response
- Temporary service outage

Do not let external integration errors crash unrelated application functionality.

Map external errors into application-level errors.

Do not expose raw third-party API responses to clients unless intentionally designed.

---

## 23. Background Jobs

Use background jobs for operations that do not need to block an HTTP request.

Examples:

- Large report generation
- Data synchronization
- Email sending
- Third-party data imports
- Analytics processing
- Scheduled cleanup
- Notifications

Preferred:

HTTP Request
  ↓
Create Job
  ↓
Queue
  ↓
Worker
  ↓
Process
  ↓
Update Status

Do not perform expensive long-running work synchronously inside a request handler unless the operation is guaranteed to be small and fast.

---

## 24. Transactions

Use transactions when multiple changes must succeed or fail together.

Example:

Create organization
  ↓
Create owner membership
  ↓
Create default settings

If these operations must be atomic, consider a transaction.

Do not introduce transactions automatically.

Understand:

- MongoDB deployment requirements
- Transaction cost
- Failure behavior
- Concurrency

---

## 25. Error Architecture

Use centralized error handling.

Preferred flow:

Service throws application error
        ↓
Controller/async middleware
        ↓
Central error handler
        ↓
HTTP response

Define application-level error types where appropriate.

Examples:

ValidationError
UnauthorizedError
ForbiddenError
NotFoundError
ConflictError
ExternalServiceError

Do not duplicate error formatting in every controller.

Never expose stack traces or internal database errors in production responses.

---

## 26. Configuration

Centralize application configuration.

Configuration should handle:

- Environment variables
- Database connection
- API configuration
- Authentication configuration
- External services
- Feature flags
- Logging configuration

Do not access environment variables randomly throughout the application.

Prefer:

config
  ↓
application components

Validate required environment variables during startup.

Never commit secrets.

---

## 27. Secrets

Never store secrets in:

- Source code
- Git
- Frontend bundles
- API responses
- Logs
- Client-side local storage unless specifically required and understood

Use environment variables or an appropriate secrets-management system.

Examples:

DATABASE_URL
JWT_SECRET
OAUTH_CLIENT_SECRET
API_KEY

Frontend-exposed environment variables must never contain server-only secrets.

---

## 28. Dependency Management

Before adding a dependency:

1. Check whether the project already has an equivalent.
2. Check whether the functionality can be implemented simply without it.
3. Consider maintenance and security.
4. Consider bundle/server impact.
5. Follow the existing dependency conventions.

Do not add libraries simply because they are popular.

Do not replace existing libraries without a clear reason.

---

## 29. Cross-Cutting Concerns

Keep cross-cutting concerns centralized where appropriate.

Examples:

- Authentication
- Authorization
- Logging
- Error handling
- Validation
- Metrics
- Rate limiting
- Request IDs
- Configuration

Avoid implementing these independently in every module.

---

## 30. Module Boundaries

Organize modules around business capabilities where practical.

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

A module should ideally own its:

- Routes
- Controllers
- Services
- Validation
- Types
- Repository/data-access logic

Do not create modules solely based on technical terminology if business boundaries provide clearer separation.

---

## 31. Dependency Direction

Prefer dependencies flowing toward stable business logic.

Example:

React UI
  ↓
Application/API layer
  ↓
Business logic
  ↓
Data/infrastructure

Infrastructure should not force business logic to depend on infrastructure-specific implementation details unnecessarily.

Avoid circular dependencies.

If:

A → B
and
B → A

exists, reconsider the design.

---

## 32. Interfaces and Abstractions

Use interfaces/types when they provide meaningful architectural value.

Good use cases:

- External integrations
- Replaceable infrastructure
- Complex services
- Testing boundaries
- Domain contracts

Avoid creating an interface for every class automatically.

Do not create abstractions only because SOLID suggests abstraction.

The abstraction should solve a real problem.

---

## 33. Dependency Injection

Use dependency injection where it improves testability and separation of concerns.

Prefer:

Service
  ↓
Repository dependency

rather than tightly coupling services to concrete implementations everywhere.

Follow the project's existing dependency injection strategy.

Do not introduce a dependency injection framework just because one is available.

---

## 34. Caching

Introduce caching only when there is a demonstrated need.

Potential caching locations:

- HTTP
- Application service
- Redis
- Database query layer
- CDN

Always consider cache invalidation and tenant isolation.

Never allow cached tenant-specific data to be returned to another tenant.

Cache keys must include relevant tenant/resource context.

---

## 35. Performance Architecture

Consider performance during design.

Frontend:

- Code splitting
- Lazy loading
- Rendering performance
- API request duplication
- Large lists
- Bundle size

Backend:

- Async operations
- Database query efficiency
- Connection pooling
- Payload size
- Caching
- Background jobs

MongoDB:

- Indexes
- Query patterns
- Projection
- Aggregation efficiency
- Pagination

Do not optimize without understanding the actual bottleneck.

---

## 36. Observability

Production architecture should support:

- Structured logs
- Metrics
- Request IDs
- Error tracking
- Performance monitoring
- Health checks

At minimum, important backend operations should be traceable through logs.

Do not log sensitive information.

---

## 37. Health Checks

Provide health checks where appropriate.

Separate:

Liveness
  ↓
Is the application process running?

Readiness
  ↓
Can the application handle requests and required dependencies?

Health checks should not expose sensitive infrastructure details.

---

## 38. Feature Flags

Use feature flags when gradual rollout is required.

Examples:

- New dashboard
- New analytics engine
- New authentication flow
- Experimental AI feature

Do not scatter raw feature-flag checks throughout the application.

Centralize feature configuration where practical.

---

## 39. Backward Compatibility

Before changing an existing module/API:

1. Identify consumers.
2. Identify dependencies.
3. Determine whether the change is breaking.
4. Prefer backward-compatible changes.
5. Add migration logic if necessary.
6. Update tests.
7. Update documentation.

Do not perform broad breaking refactors as part of a small feature.

---

## 40. Refactoring Rules

When refactoring:

- Preserve existing behavior unless change is intentional.
- Make small, verifiable changes.
- Run tests after meaningful changes.
- Avoid mixing refactoring with unrelated feature work.
- Remove dead code only when confident it is unused.
- Do not rename large portions of the codebase unnecessarily.
- Do not change architecture without identifying the problem being solved.

Before a large refactor, explain:

- Current problem
- Proposed architecture
- Benefits
- Risks
- Migration strategy

---

## 41. New Feature Workflow

When implementing a significant feature:

1. Understand the business requirement.
2. Inspect existing architecture.
3. Identify affected modules.
4. Identify domain entities.
5. Identify API changes.
6. Identify database changes.
7. Identify authentication/authorization requirements.
8. Identify tenant-isolation requirements.
9. Identify external integrations.
10. Identify frontend changes.
11. Identify background processing requirements.
12. Define boundaries.
13. Implement incrementally.
14. Add tests.
15. Run type checking.
16. Run linting.
17. Run relevant tests.
18. Review security.
19. Review architecture.
20. Review performance.
21. Update documentation.

Do not immediately create new folders or abstractions before inspecting the existing project.

---

## 42. Architecture Review Checklist

When reviewing architecture, verify:

- [ ] Clear separation of concerns
- [ ] Controllers/routes are thin
- [ ] Business logic is in appropriate services
- [ ] Database access is isolated appropriately
- [ ] React components are not overloaded with business logic
- [ ] API calls are appropriately centralized
- [ ] Authentication is separated from authorization
- [ ] Authorization is enforced server-side
- [ ] Tenant isolation is enforced
- [ ] Tenant context is not trusted from the client
- [ ] RBAC/permissions are consistently enforced
- [ ] External integrations are isolated
- [ ] Long-running work uses background jobs where appropriate
- [ ] Configuration is centralized
- [ ] Secrets are protected
- [ ] Error handling is centralized
- [ ] Logging is consistent
- [ ] Dependencies flow in a controlled direction
- [ ] Circular dependencies are avoided
- [ ] Abstractions are justified
- [ ] MongoDB access patterns are appropriate
- [ ] Indexes support important queries
- [ ] APIs remain backward compatible where possible
- [ ] Performance implications are considered
- [ ] Tests cover important behavior
- [ ] Architecture is understandable to new developers

---

## 43. Decision Framework

When deciding between architectural approaches:

1. Understand the actual problem.
2. Inspect the existing architecture.
3. Prefer the simplest solution that satisfies the requirement.
4. Consider maintainability.
5. Consider security.
6. Consider scalability.
7. Consider testability.
8. Consider performance.
9. Consider operational complexity.
10. Consider migration cost.
11. Avoid introducing infrastructure without a clear need.
12. Prefer consistency with existing patterns.

Do not choose an architecture merely because it is considered "modern."

Choose the architecture that best fits the application's current and reasonably expected requirements.

---

## 44. SaaS Architecture Rules

This application is a multi-tenant SaaS platform.

The following rules are mandatory:

- Authentication must identify the user.
- Authorization must determine what the user can access.
- Organization/tenant membership must be validated server-side.
- Tenant-owned resources must be tenant-scoped.
- Tenant IDs must not be trusted from client input for authorization.
- Users may belong to multiple organizations if supported by the domain.
- Organization-level permissions must be separate from global user identity.
- Never assume that a user has access to every organization they can identify.
- Never expose another tenant's data.
- Background jobs must preserve tenant context.
- Cached data must preserve tenant isolation.
- External integrations must be associated with the correct tenant.
- Audit records should include tenant context where applicable.
- Analytics and reporting queries must respect tenant boundaries.

---

## 45. Final Architecture Rule

Before making a structural change, ask:

1. What problem does this solve?
2. Does the existing architecture already solve it?
3. Where should this responsibility live?
4. What module owns the behavior?
5. Does this introduce unnecessary coupling?
6. Does this affect tenant isolation?
7. Does this affect authentication or authorization?
8. Does this affect existing API contracts?
9. Does this affect database performance?
10. Can the change be tested independently?
11. Can the change be implemented more simply?

If the answer indicates that the existing architecture is sufficient, prefer using the existing architecture instead of introducing a new pattern.
:::