# Performance Skill

```text
---
name: performance
description: Analyze, design, review, diagnose, and optimize performance for the React + TypeScript + Node.js + MongoDB multi-tenant SaaS application. Use this skill whenever investigating slow pages, slow APIs, high CPU or memory usage, database performance, unnecessary React renders, large payloads, expensive analytics queries, background jobs, caching, bundle size, latency, scalability, or production performance issues.
---

# Performance Standards

## 1. Core Principle

Performance optimization must be evidence-driven.

Do not optimize based only on assumptions.

Before making a significant optimization:

1. Identify the actual bottleneck.
2. Measure the current behavior.
3. Understand the root cause.
4. Make the smallest appropriate change.
5. Measure again.
6. Verify correctness was not affected.

Prefer:

Measure
  ↓
Identify bottleneck
  ↓
Optimize
  ↓
Measure again

Do not optimize code simply because it "looks slow."

---

# 2. Performance Priorities

Prioritize performance work in this order:

1. Correctness
2. Security
3. Tenant isolation
4. Database efficiency
5. API latency
6. Backend throughput
7. Frontend rendering
8. Network payload
9. Bundle size
10. Micro-optimizations

Never sacrifice correctness or tenant isolation for performance.

---

# 3. Performance Areas

Review performance across:

Frontend
  ↓
Network
  ↓
API
  ↓
Business logic
  ↓
Database
  ↓
External integrations

Also review:

- Background jobs
- Queues
- Caching
- Memory
- CPU
- Scalability
- Infrastructure

Do not optimize only one layer while ignoring the actual bottleneck.

---

# 4. Performance Baseline

Before optimization, establish a baseline where possible.

Measure:

- API response time
- Database query time
- Frontend load time
- Time to interactive
- Bundle size
- Memory usage
- CPU usage
- Request count
- Database operations
- External API latency

Record:

Before
  ↓
Optimization
  ↓
After

Do not claim an optimization improved performance unless there is evidence.

---

# 5. Performance Budgets

Define reasonable budgets where appropriate.

Examples:

- API response latency
- Initial JavaScript bundle size
- Page load time
- Database query duration
- Memory usage
- Background job duration

The exact values should depend on the application's requirements.

Do not create arbitrary budgets without understanding user and business expectations.

---

# 6. React Performance

Review React applications for:

- Unnecessary renders
- Large component trees
- Excessive state updates
- Expensive calculations
- Duplicate API requests
- Large lists
- Large bundles
- Unnecessary effects
- Excessive context updates

Do not optimize every component.

Focus on meaningful bottlenecks.

---

# 7. React State

Avoid duplicated state.

Bad:

const [filteredUsers, setFilteredUsers] = useState([]);

when filteredUsers can be derived from:

users
+
filters

Prefer derived values when the calculation is cheap.

Duplicated state can cause:

- Synchronization bugs
- Extra renders
- Extra updates

---

# 8. React Re-renders

Identify unnecessary renders caused by:

- Parent state changes
- Context updates
- Unstable props
- Inline objects/functions
- Excessive global state
- Incorrect state ownership

Do not automatically add:

React.memo
useMemo
useCallback

to everything.

Measure first.

---

# 9. React.memo

Use `React.memo` when:

- A component renders frequently.
- Its props are usually unchanged.
- Rendering is sufficiently expensive.
- Profiling demonstrates a benefit.

Do not use it everywhere.

Memoization has its own overhead and complexity.

---

# 10. useMemo

Use `useMemo` for expensive derived calculations when recalculation is demonstrably expensive.

Example:

const filteredReports = useMemo(
  () => expensiveFilter(reports, filters),
  [reports, filters]
);

Do not use `useMemo` for trivial calculations.

---

# 11. useCallback

Use `useCallback` when stable function identity provides a meaningful benefit.

Typical case:

- Passing callbacks to memoized children.
- Preventing unnecessary effect execution.
- Avoiding expensive child rerenders.

Do not wrap every event handler in `useCallback`.

---

# 12. useEffect

Review effects for:

- Unnecessary execution
- Incorrect dependencies
- Duplicate API calls
- Infinite loops
- Race conditions
- Missing cleanup

Do not use `useEffect` for calculations that can be derived during render.

---

# 13. API Request Duplication

Look for:

Component A
  ↓
GET /reports

Component B
  ↓
GET /reports

Component C
  ↓
GET /reports

when the same data could be shared.

Consider an appropriate data-fetching/state strategy.

Do not introduce global caching merely to avoid a few requests.

---

# 14. Request Waterfalls

Identify:

Request A
  ↓
Request B
  ↓
Request C
  ↓
Request D

when requests could safely execute concurrently.

Prefer:

Promise.all([
  requestA(),
  requestB(),
  requestC()
]);

when operations are independent.

Do not parallelize operations that depend on one another.

---

# 15. Frontend Data Fetching

Optimize:

- Duplicate requests
- Request waterfalls
- Large payloads
- Missing caching
- Refetch frequency
- Stale data
- Pagination

Use the application's established data-fetching solution.

Do not introduce a new state/data-fetching library without a clear reason.

---

# 16. Large Lists

Large lists can cause:

- Slow rendering
- High memory usage
- Long DOM trees
- Slow scrolling

Use:

- Pagination
- Virtualization
- Incremental loading

where appropriate.

Do not render thousands of rows when the user only needs a small visible subset.

---

# 17. Tables

For BI dashboards and data-heavy tables:

Prefer:

- Server-side pagination
- Server-side filtering
- Server-side sorting
- Virtualized rows
- Limited columns
- Incremental loading

Avoid loading the entire dataset into React unnecessarily.

---

# 18. Charts

Charts can become expensive when rendering large datasets.

Consider:

- Aggregating data server-side
- Downsampling
- Limiting points
- Lazy rendering
- Memoization
- Avoiding unnecessary chart redraws

Do not send millions of raw points to the browser for a chart that displays a few hundred pixels.

---

# 19. Bundle Size

Review frontend bundle size.

Look for:

- Large dependencies
- Duplicate libraries
- Unused packages
- Large icon libraries
- Heavy date libraries
- Large charting libraries
- Unnecessary polyfills

Prefer tree-shaking-compatible imports where appropriate.

---

# 20. Code Splitting

Use lazy loading for large application areas where appropriate.

Example:

Dashboard
  ↓
Load dashboard code

Reports
  ↓
Load reports code

Admin
  ↓
Load admin code

Do not lazy-load tiny components merely to increase complexity.

---

# 21. Network Performance

Review:

- Number of requests
- Request size
- Response size
- Compression
- Caching
- API waterfalls
- Duplicate requests

Avoid sending data the client does not need.

Use DTOs/projections where appropriate.

---

# 22. API Payload Size

Do not return entire MongoDB documents when the client only needs a few fields.

Prefer:

{
  id,
  name,
  status
}

instead of returning a large object containing:

- Internal metadata
- Large nested objects
- Sensitive fields
- Unused fields

Smaller responses improve:

- Network latency
- Serialization
- Browser memory
- React rendering

---

# 23. Pagination

Any endpoint with potentially large result sets should be paginated.

Avoid:

GET /reports

returning every report for a large organization.

Prefer:

GET /reports?page=1&limit=25

or cursor-based pagination.

Always enforce a maximum limit.

---

# 24. Cursor Pagination

For large datasets, consider cursor pagination.

Example:

GET /reports?cursor=<cursor>&limit=25

Cursor pagination can perform better than large offsets because:

skip(100000)

can become expensive for large datasets.

Use a stable sort order.

---

# 25. Backend Performance

Node.js performance depends heavily on avoiding blocking operations.

Avoid expensive synchronous operations in request handlers.

Bad examples:

fs.readFileSync(...)
large CPU loops
large synchronous JSON processing

Use asynchronous APIs where appropriate.

---

# 26. Event Loop

Do not block the Node.js event loop.

If CPU-intensive work is unavoidable, consider:

- Worker threads
- Background workers
- Queues
- Separate services

depending on workload.

Monitor event-loop latency when diagnosing production performance issues.

---

# 27. Database Performance

MongoDB is often one of the most important backend performance bottlenecks.

Review:

- Query patterns
- Indexes
- Collection scans
- Aggregations
- Population
- N+1 queries
- Projection
- Pagination

Do not optimize Node.js code when the database query is responsible for most of the latency.

---

# 28. MongoDB Indexes

Indexes should support actual query patterns.

Example:

Query:

{
  organizationId,
  status
}

Sort:

{
  createdAt: -1
}

Potential index:

{
  organizationId: 1,
  status: 1,
  createdAt: -1
}

Validate using actual workload and explain plans.

Do not create an index for every field.

---

# 29. Query Explain Plans

Use:

explain("executionStats")

when investigating slow queries.

Review:

- Execution time
- Winning plan
- Collection scan
- Index scan
- Keys examined
- Documents examined
- Documents returned

A query that examines 1,000,000 documents to return 20 records should be investigated.

---

# 30. Tenant-Aware Query Performance

Every tenant query should preserve tenant isolation.

Example:

{
  organizationId,
  status
}

If this is a common access pattern, consider an appropriate tenant-aware index.

Never remove tenant filtering to improve query performance.

Optimize the tenant-scoped query instead.

---

# 31. N+1 Queries

Identify:

One query
  ↓
Loop
  ↓
N additional queries

Example:

const users = await User.find({
  organizationId
});

for (const user of users) {
  await Report.find({
    organizationId,
    userId: user._id
  });
}

Consider:

- `$in`
- Aggregation
- Batch queries
- Data-model changes

Do not blindly use `Promise.all` for N queries if that simply creates a database overload.

---

# 32. Aggregation Performance

For aggregation pipelines:

- `$match` early
- Reduce unnecessary fields
- Avoid unnecessary `$lookup`
- Avoid unnecessary `$unwind`
- Limit results
- Use indexes where appropriate
- Review explain plans

For BI analytics, consider whether repeated expensive aggregations should be:

- Cached
- Pre-aggregated
- Materialized
- Processed asynchronously

Only introduce these techniques when justified by workload.

---

# 33. MongoDB Projection

Retrieve only fields needed by the operation.

Example:

Model.find(
  {
    organizationId
  },
  {
    name: 1,
    status: 1,
    createdAt: 1
  }
);

This reduces:

- Database transfer
- Node.js memory
- Serialization
- Network payload

---

# 34. Mongoose lean()

For read-only queries, consider:

Model.find(query).lean();

This can reduce Mongoose document overhead.

Do not use `.lean()` if the application relies on document methods or other Mongoose document behavior.

Measure when the difference matters.

---

# 35. Connection Pooling

Use shared MongoDB connections/pools.

Do not create a new connection per request.

Review:

- maxPoolSize
- minPoolSize
- connection timeout
- server selection timeout

Do not increase pool sizes blindly.

Too many connections can overload MongoDB.

---

# 36. External API Performance

External integrations can dominate request latency.

Example:

API
  ↓
HubSpot
  ↓
Salesforce
  ↓
Database

Review:

- Number of external calls
- Sequential calls
- Timeouts
- Retries
- Rate limits
- Payload size

Parallelize independent calls when safe.

---

# 37. External API Batching

If a provider supports batch operations, prefer them when appropriate.

Instead of:

Request 1
Request 2
Request 3
...
Request 100

consider:

Batch request

when supported.

This can reduce:

- Network latency
- Rate-limit consumption
- Server overhead

---

# 38. External API Caching

Cache external data when:

- It changes infrequently.
- Requests are expensive.
- Slight staleness is acceptable.

Always consider:

- TTL
- Invalidation
- Tenant isolation
- Provider freshness requirements

Do not cache sensitive data without an appropriate security design.

---

# 39. External API Retries

Retries must use backoff.

Avoid:

retry immediately
retry immediately
retry immediately

Prefer exponential backoff with a maximum retry count.

Do not retry permanent errors.

---

# 40. Background Jobs

Move expensive work out of synchronous API requests.

Examples:

- Report generation
- Large analytics processing
- Data imports
- Data synchronization
- Email sending
- File generation

Preferred:

HTTP request
  ↓
Create job
  ↓
Return job ID
  ↓
Worker
  ↓
Process
  ↓
Update status

---

# 41. Job Idempotency

Background jobs may run more than once.

Design jobs to be idempotent where practical.

Example:

A data synchronization job should not create duplicate records if it is retried.

Use:

- Unique keys
- Upserts
- Provider IDs
- Idempotency keys

where appropriate.

---

# 42. Queue Concurrency

Do not process unlimited jobs concurrently.

Consider:

- Worker concurrency
- MongoDB connection limits
- External API rate limits
- CPU
- Memory

Too much concurrency can reduce performance instead of improving it.

---

# 43. Memory Usage

Monitor:

- Heap usage
- Heap growth
- Large arrays
- Large query results
- Large API payloads
- Caches
- Event listeners

Avoid:

const allReports = await Report.find(...);

for millions of records.

Use:

- Pagination
- Cursors
- Streaming
- Batch processing
- Background jobs

where appropriate.

---

# 44. Streaming

Use streams for large data where practical.

Examples:

- CSV export
- Large file download
- Large data processing

Avoid loading the entire dataset into memory.

---

# 45. Large Exports

Do not generate massive exports inside a normal HTTP request.

Prefer:

POST /exports
  ↓
Create export job
  ↓
Return job ID
  ↓
Background worker
  ↓
Generate file
  ↓
Store file
  ↓
Return download URL

Ensure export processing is tenant-scoped.

---

# 46. Caching Strategy

Caching can improve performance but introduces complexity.

For every cache:

1. Define cache key.
2. Define TTL.
3. Define invalidation.
4. Define stale-data tolerance.
5. Define tenant boundary.
6. Define memory/storage limits.

Never introduce caching without considering invalidation.

---

# 47. Tenant-Aware Cache Keys

Tenant-specific data must include tenant context in cache keys.

Prefer:

organization:{organizationId}:report:{reportId}

instead of:

report:{reportId}

when tenant isolation requires it.

A cache hit must never return another tenant's data.

---

# 48. Cache Invalidation

Review invalidation when data changes.

Example:

Update report
  ↓
Database updated
  ↓
Invalidate report cache

Do not allow stale data to persist indefinitely unless the business requirement permits it.

---

# 49. HTTP Caching

Use HTTP caching where appropriate.

Potential mechanisms:

- Cache-Control
- ETag
- Last-Modified

Do not cache personalized or tenant-sensitive responses publicly.

Be especially careful with:

Authorization
Tenant context
User-specific responses

---

# 50. CDN

Use CDN caching for appropriate static/public content.

Examples:

- JavaScript
- CSS
- Images
- Public assets

Do not publicly cache tenant-private data.

---

# 51. Compression

Consider HTTP compression for sufficiently large text responses.

Compression can reduce network transfer but consumes CPU.

Use appropriate server/platform support.

Do not compress tiny responses unnecessarily.

---

# 52. Response Compression

Good candidates:

- JSON
- HTML
- CSS
- JavaScript
- SVG

Already compressed formats such as:

- JPEG
- PNG
- ZIP
- PDF

may provide limited additional benefit.

---

# 53. Serialization

Large JSON serialization can become expensive.

Avoid returning huge objects.

Use:

- Projection
- DTOs
- Pagination
- Aggregation
- Streaming

where appropriate.

---

# 54. JSON Payload Design

Avoid deeply nested response objects when the client does not need them.

Large payloads increase:

- Server serialization
- Network transfer
- Browser parsing
- React rendering

Return the smallest useful representation.

---

# 55. API Latency

Break API latency into components:

Request
  ↓
Middleware
  ↓
Controller
  ↓
Service
  ↓
Database
  ↓
External APIs
  ↓
Serialization
  ↓
Response

Measure each component when diagnosing latency.

Do not assume the database is always the bottleneck.

---

# 56. Performance Instrumentation

Use appropriate instrumentation for:

- HTTP latency
- Database latency
- External API latency
- Queue processing
- Cache hit/miss
- Error rates
- CPU
- Memory

Do not add expensive instrumentation to every tiny function.

Focus on important boundaries.

---

# 57. Logging Performance

Avoid excessive logging in hot paths.

Bad:

Logging every database record in a large loop.

Prefer aggregated information:

{
  processed: 10000,
  durationMs: 5200
}

Do not log sensitive information.

---

# 58. Database Connection Metrics

Monitor:

- Active connections
- Pool saturation
- Query latency
- Timeout rates

If the application has slow queries and connection pool exhaustion, increasing pool size may not solve the root cause.

Fix inefficient queries first.

---

# 59. API Concurrency

Review concurrent request behavior.

Potential issues:

- Duplicate expensive requests
- Thundering herd
- Database overload
- External API rate limits
- Lock contention

Use:

- Caching
- Request coalescing
- Queues
- Rate limiting

when justified.

---

# 60. Thundering Herd

A common pattern:

Cache expires
  ↓
100 requests arrive
  ↓
100 database queries execute
  ↓
Cache rebuilt 100 times

Consider:

- Cache locking
- Request coalescing
- Background refresh
- Stale-while-revalidate

where appropriate.

Do not implement complex cache coordination unless the problem exists.

---

# 61. Frontend Caching

Cache appropriate server data to avoid unnecessary requests.

Potential strategies:

- Query cache
- HTTP cache
- Application state

Consider:

- Freshness
- Invalidations
- Tenant changes
- User changes
- Permissions

When the user switches organizations, tenant-specific cached data must not leak between organizations.

---

# 62. Tenant Switching and Cache

When switching:

Organization A
  ↓
Organization B

invalidate or correctly namespace tenant-specific frontend state.

Do not display Organization A data while Organization B is active.

This is both a correctness and security issue.

---

# 63. Browser Storage

Avoid storing large application datasets in:

- localStorage
- sessionStorage

Browser storage is not an efficient database for large datasets.

Do not store sensitive data unnecessarily.

---

# 64. React Context Performance

Large global contexts can cause broad rerenders.

Avoid placing frequently changing data into a context consumed by many components unless necessary.

Consider splitting contexts by responsibility.

Do not introduce complexity without measuring a real problem.

---

# 65. Component Boundaries

Component boundaries should prevent unnecessary rendering.

Examples:

App
  ↓
Dashboard
  ↓
ReportTable
  ↓
ReportRow

A change to unrelated dashboard state should not force thousands of rows to rerender unnecessarily.

Use profiling to identify actual issues.

---

# 66. React Keys

Use stable keys.

Prefer:

key={report.id}

Avoid:

key={index}

when list order can change.

Incorrect keys can cause:

- Unnecessary rerenders
- State bugs
- Incorrect component reuse

---

# 67. Images and Assets

Optimize:

- Image dimensions
- Image formats
- Lazy loading
- Compression
- Responsive images

Do not load huge images when a smaller version is sufficient.

---

# 68. Fonts

Avoid loading unnecessary font families and weights.

Too many fonts increase:

- Network requests
- Bundle/static asset size
- Rendering cost

Load only required variants.

---

# 69. Dependency Performance

Before adding a dependency:

1. Check its size.
2. Check whether the project already has an equivalent.
3. Check whether tree-shaking works.
4. Consider runtime overhead.
5. Consider maintenance.

Do not add a large library for a tiny feature.

---

# 70. Node.js Dependency Performance

Review dependencies that:

- Block the event loop
- Increase startup time
- Consume significant memory
- Perform heavy synchronous processing

Prefer lightweight dependencies where appropriate.

---

# 71. Startup Performance

Review backend startup time.

Potential causes:

- Large configuration loading
- Excessive database initialization
- Loading unnecessary modules
- Synchronous file operations
- Heavy initialization logic

Do not delay readiness until optional dependencies are available unless required.

---

# 72. Cold Starts

If deployed in serverless/container environments, consider:

- Bundle size
- Initialization time
- Database connection reuse
- Lazy initialization
- Dependency count

Do not optimize for cold starts if the application architecture does not use a cold-start-sensitive environment.

---

# 73. Horizontal Scaling

The Node.js application should be designed so multiple instances can run safely where required.

Avoid relying on:

- Process-local mutable state
- In-memory sessions without shared storage
- Process-local job state
- Process-local locks

Use shared infrastructure where necessary.

---

# 74. Stateless API Design

Prefer stateless HTTP APIs.

Request
  ↓
Authentication
  ↓
Tenant context
  ↓
Database/shared state

Avoid storing critical request state only in process memory.

This allows:

Instance A
Instance B
Instance C

to handle requests interchangeably.

---

# 75. In-Memory Cache

In-memory caching is instance-local.

If multiple Node.js instances are running:

Instance A cache
≠
Instance B cache

Do not use local memory caching for critical shared state.

Use distributed caching where shared consistency is required.

---

# 76. Database Scaling

When MongoDB performance becomes a bottleneck, consider in order:

1. Query optimization
2. Index optimization
3. Projection
4. Pagination
5. Data-model optimization
6. Caching
7. Aggregation optimization
8. Archival/retention
9. Pre-aggregation
10. Infrastructure scaling

Do not immediately scale infrastructure before fixing inefficient queries.

---

# 77. Analytics Scaling

BI workloads can be significantly heavier than transactional workloads.

If analytics queries become expensive:

Consider:

Operational MongoDB
  ↓
Pre-aggregation
  ↓
Analytics collections
  ↓
Dashboard

or another appropriate analytics architecture.

Do not run expensive unrestricted aggregation queries on every dashboard refresh.

---

# 78. Dashboard Performance

For dashboards:

- Avoid fetching every metric independently when possible.
- Batch related requests.
- Aggregate related metrics efficiently.
- Cache stable metrics where appropriate.
- Use date filters.
- Avoid huge raw datasets.
- Load expensive sections lazily.

Do not sacrifice data correctness for dashboard speed.

---

# 79. Performance and Freshness

Performance optimizations may introduce stale data.

For every cache or pre-aggregation, define:

- Freshness requirement
- Maximum acceptable staleness
- Invalidation behavior
- Refresh strategy

Example:

Real-time dashboard metric:
Low cache tolerance.

Daily analytics:
Higher cache tolerance.

Choose based on business requirements.

---

# 80. Performance Testing

Use appropriate tests for important workloads.

Consider:

- Unit tests
- Integration tests
- Load tests
- Stress tests
- Endurance tests

Measure:

- Throughput
- Latency
- Error rate
- CPU
- Memory
- Database load

Do not run heavy load tests against production without explicit authorization.

---

# 81. Load Testing

Load tests should represent realistic behavior.

Test:

- Typical user
- Peak user
- Large tenant
- Small tenant
- Large datasets
- Concurrent requests
- Expensive analytics
- External integrations

Do not test only an empty development database.

---

# 82. Large Tenant Testing

Multi-tenant applications should consider tenants with very different sizes.

Example:

Tenant A:
100 records

Tenant B:
10 million records

A query that is fast for Tenant A may become extremely slow for Tenant B.

Performance testing should include realistic large-tenant scenarios.

---

# 83. Performance Regression

When fixing performance:

Add a regression test or benchmark when practical.

Example:

Before:
2.5 seconds

After:
300 ms

The goal is not to hardcode a specific machine-dependent timing unless the benchmark is designed for it.

Instead, protect the architectural behavior that caused the improvement.

---

# 84. Avoid Premature Optimization

Do not introduce:

- Redis
- Complex caching
- Worker threads
- Microservices
- Database sharding
- Pre-aggregation
- Event-driven architecture

merely because they might improve future performance.

Introduce infrastructure when the workload demonstrates the need.

---

# 85. Performance Review Workflow

When reviewing a performance-related change:

### Step 1 — Identify the bottleneck

Determine:

- Frontend
- Network
- API
- Database
- External API
- CPU
- Memory

### Step 2 — Measure

Collect relevant metrics.

### Step 3 — Understand

Determine the root cause.

### Step 4 — Optimize

Make the smallest appropriate change.

### Step 5 — Verify

Run tests.

### Step 6 — Measure again

Compare before and after.

### Step 7 — Check correctness

Ensure:

- Tenant isolation
- Authorization
- Data correctness
- API behavior

remain unchanged.

---

# 86. Performance Review Checklist

## Frontend

- [ ] Unnecessary renders reviewed
- [ ] State design reviewed
- [ ] Effects reviewed
- [ ] Large lists reviewed
- [ ] Tables virtualized/paginated where appropriate
- [ ] Bundle size reviewed
- [ ] Code splitting considered
- [ ] Duplicate requests reviewed
- [ ] Request waterfalls reviewed
- [ ] Images/assets optimized
- [ ] Tenant switching cache/state reviewed

## Backend

- [ ] Event-loop blocking reviewed
- [ ] Async behavior reviewed
- [ ] API latency reviewed
- [ ] Response payload reviewed
- [ ] Pagination reviewed
- [ ] External API calls reviewed
- [ ] Timeouts reviewed
- [ ] Retries reviewed
- [ ] Background jobs reviewed
- [ ] Memory usage considered
- [ ] Logging overhead considered

## MongoDB

- [ ] Query patterns reviewed
- [ ] Indexes reviewed
- [ ] Explain plans considered
- [ ] Collection scans reviewed
- [ ] N+1 queries reviewed
- [ ] Aggregations reviewed
- [ ] Projection reviewed
- [ ] Population reviewed
- [ ] Pagination reviewed
- [ ] Tenant filtering preserved

## Infrastructure

- [ ] Connection pooling reviewed
- [ ] Cache strategy reviewed
- [ ] Queue concurrency reviewed
- [ ] Horizontal scaling considered
- [ ] Statelessness reviewed
- [ ] CPU usage considered
- [ ] Memory usage considered

---

# 87. Performance Finding Format

When reviewing performance, use:

### [SEVERITY] — [Performance issue]

**Location:**

`path/to/file.ts`

**Observation:**

Describe what is happening.

**Evidence:**

Describe the measurement or query behavior when available.

**Impact:**

Explain the likely production impact.

**Recommendation:**

Provide the smallest appropriate improvement.

Example:

### HIGH — Unbounded Report Query

**Location:**

`report.repository.ts`

**Observation:**

The endpoint retrieves all reports for an organization without pagination.

**Impact:**

Response size and MongoDB memory usage will grow with tenant size.

**Recommendation:**

Add server-side pagination with a maximum page size and an appropriate index.

---

# 88. Avoid Speculative Performance Findings

Do not say:

"This is slow."

without evidence when the performance impact is uncertain.

Prefer:

"This query may become expensive as the collection grows because it does not have an apparent supporting index. Verify with `explain("executionStats")`."

Performance reviews should distinguish:

Confirmed bottleneck

from:

Potential scalability concern.

---

# 89. Final Performance Principles

For every optimization, ask:

1. What is the bottleneck?
2. How was it measured?
3. What is causing it?
4. What is the simplest effective solution?
5. Does the solution preserve correctness?
6. Does it preserve tenant isolation?
7. Does it increase operational complexity?
8. Does it introduce stale data?
9. Does it increase memory or infrastructure usage?
10. Can the improvement be measured afterward?

The most important rule is:

**Do not optimize what has not been measured.**

For this multi-tenant SaaS application, performance improvements must never weaken:

- Authentication
- Authorization
- Tenant isolation
- Data integrity
- API correctness

Optimize the system from the actual bottleneck outward:

Frontend
→ Network
→ Node.js
→ External APIs
→ MongoDB
→ Infrastructure

rather than adding complexity prematurely.
```
