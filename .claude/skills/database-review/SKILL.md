# Database Review Skill

```text id="dbrv82"
---
name: database-review
description: Perform production-grade database reviews for the React + TypeScript + Node.js + MongoDB multi-tenant SaaS application. Use this skill whenever reviewing MongoDB schemas, Mongoose models, queries, aggregation pipelines, indexes, migrations, database changes, repositories, data-access code, performance issues, transactions, concurrency, data integrity, or tenant isolation.
---

# Database Review Standards

## 1. Review Objective

The goal of the database review is to identify:

- Incorrect data modeling
- Cross-tenant data access
- Missing tenant isolation
- Missing or incorrect indexes
- Slow queries
- Unbounded queries
- Inefficient aggregation pipelines
- N+1 query problems
- Incorrect MongoDB operators
- NoSQL injection
- Mass assignment
- Data integrity problems
- Duplicate data
- Incorrect references
- Incorrect embedding
- Transaction problems
- Concurrency issues
- Migration risks
- Schema compatibility problems
- Excessive document size
- Unnecessary database operations
- Poor pagination
- Unsafe deletes or updates
- Sensitive data exposure

Prioritize:

1. Security
2. Tenant isolation
3. Data integrity
4. Correctness
5. Performance
6. Scalability
7. Maintainability

Do not focus only on whether the MongoDB query "works."

---

# 2. Review Existing Database Architecture First

Before reviewing database code:

1. Inspect the existing MongoDB architecture.
2. Inspect Mongoose models/schemas.
3. Inspect repositories/data-access modules.
4. Inspect existing indexes.
5. Inspect database configuration.
6. Inspect similar queries.
7. Inspect tenant/organization structure.
8. Inspect migrations or migration conventions.
9. Inspect relevant tests.
10. Inspect actual query patterns where available.

Follow the existing architecture unless it creates a meaningful problem.

Do not introduce a repository layer, ORM abstraction, or schema pattern merely because it is theoretically preferred.

---

# 3. Data Modeling

Review whether the data model correctly represents the business domain.

Consider:

- Entity ownership
- Relationships
- Embedding
- Referencing
- Cardinality
- Update frequency
- Read frequency
- Document size
- Consistency requirements
- Query patterns
- Tenant ownership

Do not automatically normalize MongoDB data like a relational database.

Do not automatically embed every related entity.

Choose embedding or referencing based on actual access patterns and consistency requirements.

---

# 4. Embedding vs Referencing

## Prefer embedding when:

- Related data is usually read together.
- The embedded data has a bounded size.
- The embedded data belongs strongly to the parent.
- The embedded data does not need independent querying.
- Updates are usually performed together.

## Prefer referencing when:

- Related data can grow without a practical bound.
- The entity has an independent lifecycle.
- The entity is shared by multiple documents.
- The entity is frequently queried independently.
- The relationship is many-to-many.
- Embedding would create very large documents.

Do not embed unbounded arrays.

Example risk:

{
  organizationId,
  members: [...]
}

If the members array can grow indefinitely, consider a separate membership collection.

---

# 5. Document Size

MongoDB documents have a maximum document size.

Review documents for:

- Large arrays
- Large nested objects
- Large embedded histories
- Large logs
- Large report results
- Large binary data

Avoid storing unbounded data inside a single document.

Examples of potentially dangerous patterns:

- Unlimited audit history inside a user document.
- Unlimited notifications inside an organization document.
- Unlimited transactions inside an account document.
- Unlimited report results inside a report document.

Use separate collections for unbounded data.

---

# 6. Tenant Isolation

This is a mandatory review area.

The application is a multi-tenant SaaS system.

Every tenant-owned document should have an explicit and reliable tenant relationship.

Example:

{
  _id,
  organizationId,
  name,
  createdAt
}

or another appropriate tenant reference based on the domain.

Never assume tenant isolation merely because the frontend sends the correct organization ID.

Tenant isolation must be enforced server-side.

---

# 7. Tenant-Scoped Queries

For tenant-owned data, queries must include tenant scope.

Preferred:

Model.find({
  organizationId: authenticatedOrganizationId,
  status: "active"
});

Potentially unsafe:

Model.find({
  status: "active"
});

if the collection contains multiple tenants.

For resource access:

Preferred:

Model.findOne({
  _id: resourceId,
  organizationId: authenticatedOrganizationId
});

Avoid:

Model.findById(resourceId);

unless tenant authorization is enforced elsewhere in a demonstrably safe way.

---

# 8. Tenant Isolation for Every Operation

Review all database operations:

- find
- findOne
- findById
- findOneAndUpdate
- findByIdAndUpdate
- updateOne
- updateMany
- findOneAndDelete
- findByIdAndDelete
- deleteOne
- deleteMany
- countDocuments
- estimatedDocumentCount
- distinct
- aggregate

Tenant filtering must also be applied to:

- Aggregation pipelines
- Background jobs
- Reports
- Analytics
- Exports
- Scheduled tasks
- Search
- Caches

Do not assume that only normal CRUD endpoints require tenant filtering.

---

# 9. Tenant-Aware Aggregations

Aggregation pipelines must preserve tenant isolation.

Preferred:

[
  {
    $match: {
      organizationId: authenticatedOrganizationId
    }
  },
  ...
]

The tenant filter should be applied as early as practical.

Do not run a large cross-tenant aggregation and filter the results later in application code.

Bad:

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
Node.js

---

# 10. Tenant Context

Do not trust:

req.body.organizationId
req.query.organizationId
req.params.organizationId

as the sole authorization mechanism.

Tenant context should come from authenticated server-side identity and validated membership.

The repository/data-access layer should receive a trusted tenant context.

Example:

repository.findReports({
  organizationId: authenticatedOrganizationId
});

not:

repository.findReports({
  organizationId: req.query.organizationId
});

---

# 11. Index Review

Every important query pattern should be evaluated for indexes.

Review:

- Equality filters
- Sort fields
- Range queries
- Compound filters
- Tenant-scoped queries
- Unique constraints
- Frequently accessed relationships

Example query:

{
  organizationId: 1,
  status: 1,
  createdAt: -1
}

may require an index such as:

{
  organizationId: 1,
  status: 1,
  createdAt: -1
}

But do not recommend an index blindly.

Validate the query pattern first.

---

# 12. Compound Indexes

Review field order in compound indexes.

Consider:

1. Equality fields
2. Sort fields
3. Range fields

For example, a query such as:

{
  organizationId,
  status,
  createdAt: { $gte: startDate }
}

with:

sort({ createdAt: -1 })

may benefit from an index designed around the actual access pattern.

Do not assume every field should be indexed independently.

---

# 13. Tenant-Aware Indexes

In multi-tenant applications, tenant ID is frequently part of query patterns.

Example:

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

Review whether important tenant-scoped queries can efficiently use an index.

Do not blindly place organizationId first in every index.

The correct order depends on actual query patterns and selectivity.

---

# 14. Unique Indexes

Review uniqueness requirements carefully.

For tenant-specific uniqueness, a global unique index may be incorrect.

Example:

Two organizations may both have:

email = user@example.com

if the application permits the same email across different organizations.

A compound unique index may be required:

{
  organizationId: 1,
  email: 1
}

The exact design depends on the domain.

Always determine whether uniqueness is:

- Global
- Tenant-specific
- Conditional

before creating a unique index.

---

# 15. Partial Indexes

Consider partial indexes when only a subset of documents needs to participate in uniqueness or query optimization.

Example:

Active records only.

Do not introduce partial indexes without understanding:

- Query patterns
- Index behavior
- Data lifecycle
- Maintenance implications

---

# 16. Index Overuse

Indexes improve reads but increase:

- Storage
- Write cost
- Memory usage
- Maintenance

Do not create indexes for every field.

Review whether each index supports a meaningful query.

Identify:

- Duplicate indexes
- Redundant indexes
- Unused indexes
- Overlapping indexes

---

# 17. Query Performance

Review queries for:

- Full collection scans
- Large result sets
- Unnecessary sorting
- Unindexed filters
- Large projections
- N+1 operations
- Excessive population
- Expensive regex
- Expensive aggregation

Use explain plans where available.

Prefer evidence over assumptions.

---

# 18. Query Explain Plans

For important or suspicious queries, use MongoDB explain information where available.

Consider:

- Winning plan
- Collection scan
- Index scan
- Number of documents examined
- Number of keys examined
- Number of documents returned

A query that returns 10 documents but examines millions should receive attention.

Do not optimize based solely on code appearance.

---

# 19. Unbounded Queries

Avoid:

Model.find({ ... });

when the result could grow significantly.

Use pagination.

Bad:

const users = await User.find({
  organizationId
});

Potentially better:

const users = await User.find({
  organizationId
})
.limit(limit)
.skip(skip);

For large collections, consider cursor-based pagination.

---

# 20. Pagination

Review:

- Default limit
- Maximum limit
- Sorting
- Stable ordering
- Cursor behavior
- Offset performance

Do not allow:

limit=1000000

or equivalent unbounded requests.

For large collections, offset pagination may become expensive.

Consider cursor-based pagination:

?cursor=<value>&limit=20

where appropriate.

---

# 21. Sorting

Sorting large datasets can be expensive.

Review:

- Sort fields
- Index support
- Stable ordering
- Client-controlled fields

Never allow arbitrary MongoDB fields to be used without validation.

Use an allowlist.

Example:

const allowedSortFields = [
  "createdAt",
  "name",
  "updatedAt"
];

---

# 22. Filtering

Never pass raw request query objects directly to MongoDB.

Avoid:

Model.find(req.query);

This can introduce:

- Security vulnerabilities
- Unexpected filters
- MongoDB operators
- Poor query performance

Instead:

1. Validate input.
2. Transform input.
3. Allow only supported filters.
4. Build the MongoDB query explicitly.

---

# 23. NoSQL Injection

Review user-controlled MongoDB input for operators such as:

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

Do not allow arbitrary operators unless intentionally supported and securely validated.

Treat all external input as untrusted.

---

# 24. Regular Expressions

Be careful with user-controlled regex.

Potential problems:

- Collection scans
- Expensive pattern matching
- ReDoS-like behavior
- Poor performance

Validate search terms.

Prefer indexed search mechanisms for large datasets.

Do not use unbounded case-insensitive regex queries against large collections without understanding their performance.

---

# 25. Projection

Do not retrieve fields that are unnecessary.

Avoid:

Model.find(query);

if the document contains large or sensitive fields that the caller does not need.

Consider projections:

Model.find(
  query,
  {
    name: 1,
    email: 1,
    createdAt: 1
  }
);

Never return:

- Password hashes
- Refresh tokens
- API secrets
- Internal credentials
- Sensitive internal metadata

unless explicitly required and secured.

---

# 26. Population

If using Mongoose `populate`, review:

- Number of relationships
- Result size
- Query count
- Selected fields
- Tenant isolation
- Performance

Do not populate large nested relationships automatically.

Avoid:

populate("everything")

when only a few fields are needed.

Consider explicit queries or aggregation when population becomes inefficient.

---

# 27. N+1 Queries

Look for patterns such as:

for (const user of users) {
  await Report.find({ userId: user._id });
}

This may generate:

1 query for users
+
N queries for reports

Consider:

- Aggregation
- `$in`
- Batch queries
- Proper data modeling

Do not blindly replace sequential queries with `Promise.all` if the resulting load is worse.

---

# 28. Aggregation Pipelines

Review:

- `$match`
- `$project`
- `$lookup`
- `$unwind`
- `$group`
- `$sort`
- `$limit`
- `$skip`

Apply restrictive `$match` stages as early as practical.

Avoid unnecessary `$lookup`.

Avoid grouping massive datasets when a more selective query is possible.

Use indexes where MongoDB can take advantage of them.

---

# 29. Aggregation Security

Ensure aggregation pipelines cannot be constructed directly from untrusted client input.

Do not allow clients to submit arbitrary MongoDB aggregation stages.

Explicitly construct allowed stages from validated input.

---

# 30. Updates

Review update operations carefully.

Avoid mass assignment:

Model.updateOne(
  { _id: id },
  req.body
);

Explicitly map allowed fields.

Protected fields may include:

- organizationId
- role
- permissions
- subscription
- accountStatus
- createdAt
- ownerId

Never allow a normal user to change ownership or tenant identity through a generic update endpoint.

---

# 31. Deletes

Review:

- Authorization
- Tenant scope
- Cascading behavior
- Related records
- Audit requirements
- Soft delete requirements
- Recovery requirements

Avoid:

Model.deleteOne({
  _id: id
});

for tenant-owned resources unless tenant isolation is enforced elsewhere.

Prefer:

Model.deleteOne({
  _id: id,
  organizationId
});

where appropriate.

---

# 32. Soft Delete

If the application uses soft deletion, review:

- deletedAt
- deletedBy
- Query filtering
- Unique indexes
- Restoration
- Reporting
- Background jobs

Ensure normal queries do not accidentally return deleted records.

Do not implement soft delete inconsistently across the same resource type.

---

# 33. Cascading Data

MongoDB does not automatically provide relational cascading behavior.

When deleting a parent resource, determine whether related data must be:

- Deleted
- Archived
- Detached
- Retained

Example:

Organization
  ↓
Memberships
  ↓
Projects
  ↓
Reports

Do not delete the organization without understanding what happens to its dependent data.

---

# 34. Referential Integrity

If using references, verify that referenced documents exist when required.

Example:

report.organizationId

must point to a valid organization.

Consider whether orphaned documents are possible.

Do not assume MongoDB automatically enforces relationships.

---

# 35. Transactions

Use MongoDB transactions when multiple operations must be atomic.

Example:

Create organization
+
Create owner membership
+
Create default settings

If one operation fails, the required atomicity may require a transaction.

Review:

- Transaction boundaries
- Retry behavior
- Error handling
- Transaction duration
- Deployment requirements
- Performance impact

Do not wrap every operation in a transaction.

---

# 36. Concurrency

Review concurrent updates.

Potential issues:

- Lost updates
- Duplicate records
- Race conditions
- Double processing
- Incorrect counters
- Duplicate webhook handling

Consider:

- Atomic MongoDB operators
- Transactions
- Unique indexes
- Optimistic concurrency
- Version fields

Prefer atomic database operations when they solve the problem safely.

---

# 37. Atomic Updates

Prefer atomic operations where appropriate.

Example:

$inc
$set
$unset
$push
$pull
$addToSet

Avoid:

Read
  ↓
Modify in Node.js
  ↓
Write

when multiple concurrent requests can modify the same document.

---

# 38. Unique Constraints and Race Conditions

Application-level checks are not enough for uniqueness.

Unsafe pattern:

1. Query if email exists.
2. If not, create user.

Two concurrent requests can both pass the check.

Use a unique index where appropriate.

Handle duplicate-key errors gracefully.

---

# 39. Schema Validation

Review Mongoose schema validation for:

- Required fields
- Types
- Enums
- Defaults
- Min/max
- String lengths
- Nested objects
- Arrays

Remember that Mongoose validation does not replace API validation.

API validation protects the boundary.

Database validation protects data integrity.

---

# 40. Schema Evolution

MongoDB collections may contain documents created by older application versions.

When changing schemas:

- Identify existing documents.
- Determine backward compatibility.
- Define migration requirements.
- Support transitional states if necessary.
- Avoid assuming every document is already migrated.

Do not deploy a schema change that breaks existing documents without a migration or compatibility strategy.

---

# 41. Migrations

For database migrations:

1. Understand existing data.
2. Make the migration idempotent where practical.
3. Test on representative data.
4. Back up important production data.
5. Consider rollback/recovery.
6. Consider migration duration.
7. Consider application compatibility during deployment.

Avoid destructive migrations without explicit approval.

---

# 42. Backward-Compatible Deployment

When schema changes and application changes are deployed separately, prefer:

Old application
  ↓
compatible schema

then:

New application
  ↓
new schema behavior

Avoid deployments where the application immediately depends on fields that do not exist yet unless deployment ordering guarantees it.

---

# 43. Data Types

Use appropriate MongoDB types.

Examples:

- ObjectId for MongoDB references where appropriate.
- Date for timestamps.
- Number/Decimal types according to precision requirements.
- Boolean for boolean state.
- String for identifiers only when the domain requires it.

Do not store dates as arbitrary strings if date operations are required.

Do not use floating-point numbers for values requiring exact financial precision without considering the appropriate representation.

---

# 44. Timestamps

Use consistent timestamp conventions.

Prefer:

createdAt
updatedAt

Use UTC for persisted timestamps unless there is a strong domain-specific reason otherwise.

Do not store timezone-dependent presentation values as the canonical timestamp.

Convert to local timezone at presentation boundaries.

---

# 45. Sensitive Data

Review whether sensitive data is stored unnecessarily.

Examples:

- Password hashes
- Authentication tokens
- Refresh tokens
- API keys
- OAuth credentials
- Personal information

Use appropriate encryption or hashing strategies where required.

Never store plaintext passwords.

Do not log sensitive database fields.

Do not return sensitive fields through APIs by default.

---

# 46. Audit Data

For security-sensitive or business-critical operations, consider audit records.

Examples:

- Login
- Role change
- Organization membership change
- Subscription change
- Permission change
- Data deletion
- External integration configuration

Audit records should include appropriate context such as:

- User
- Organization
- Action
- Resource
- Timestamp

Do not store unnecessary sensitive payloads in audit records.

---

# 47. Connection Management

Review MongoDB connection handling.

Check:

- Connection pooling
- Startup behavior
- Shutdown behavior
- Retry behavior
- Timeout configuration
- Error handling

Do not create a new database connection for every request.

Prefer a shared connection/pool according to the MongoDB driver/Mongoose architecture.

---

# 48. Transactions and Connection Pooling

Do not assume transaction-heavy operations are free.

Review:

- Transaction duration
- Connection usage
- Concurrent transactions
- Lock/contention behavior
- Retry behavior

Keep transactions as short as practical.

---

# 49. Background Jobs

Database operations in background jobs must preserve tenant context.

Example:

Job:
Generate report

Required context:

{
  organizationId,
  reportId,
  requestedBy
}

Do not create a background job that loses tenant identity.

The worker must independently enforce tenant-scoped access.

---

# 50. Analytics and Reporting

Analytics queries are especially important in a BI application.

Review:

- Tenant filtering
- Date filtering
- Indexes
- Aggregation efficiency
- Pagination
- Time ranges
- Large datasets
- Caching
- Pre-aggregation where appropriate

Never run a cross-tenant analytics query and filter the result in application code.

---

# 51. Data Retention

Review whether the application has data-retention requirements.

Potential data:

- Audit logs
- Events
- Analytics data
- Temporary data
- Deleted resources
- Integration sync history

Consider:

- TTL indexes
- Archival
- Cleanup jobs
- Retention periods

Do not retain sensitive data indefinitely without a business requirement.

---

# 52. TTL Indexes

Use TTL indexes for data that should expire automatically.

Examples:

- Temporary sessions
- Verification tokens
- Temporary jobs
- Short-lived cache records

Do not use TTL indexes for records requiring permanent retention.

---

# 53. Database Review Workflow

Follow this workflow.

## Step 1 — Understand

Read:

- Requirement
- Relevant models
- Repository/data-access code
- Existing indexes
- Related services

## Step 2 — Identify Data Ownership

Determine:

- Who owns the resource?
- Is it tenant-owned?
- Is it global?
- Is it user-owned?
- Is it shared?

## Step 3 — Review Queries

Inspect:

- Filters
- Projection
- Sorting
- Pagination
- Aggregation
- Population

## Step 4 — Review Security

Check:

- Tenant isolation
- Authorization
- NoSQL injection
- Mass assignment
- Sensitive fields

## Step 5 — Review Performance

Check:

- Indexes
- Query plans
- N+1
- Unbounded queries
- Aggregation performance

## Step 6 — Review Data Integrity

Check:

- Unique constraints
- References
- Transactions
- Concurrency
- Schema compatibility

## Step 7 — Review Tests

Check:

- Query tests
- Tenant isolation tests
- Migration tests
- Integration tests
- Edge cases

## Step 8 — Final Assessment

Classify findings by severity.

---

# 54. Finding Severity

## CRITICAL

Examples:

- Cross-tenant data exposure
- Unauthorized deletion of tenant data
- Production database credential exposure
- Database corruption risk
- Critical data integrity failure

These must be fixed before merge.

## HIGH

Examples:

- Missing tenant filter
- Missing unique constraint causing serious duplication
- Major unbounded query
- Severe collection scan
- NoSQL injection
- Incorrect transaction handling
- Significant data loss risk

## MEDIUM

Examples:

- Missing index on important query
- Inefficient aggregation
- Poor pagination
- Missing validation
- Inconsistent schema behavior

## LOW

Examples:

- Minor query optimization
- Naming improvement
- Minor schema cleanup
- Non-critical index improvement

Do not classify every performance improvement as HIGH.

---

# 55. Finding Format

Use:

### [SEVERITY] — [Short title]

**Location:**
`path/to/file.ts`

**Problem:**

Explain the actual issue.

**Impact:**

Explain the production/business/security impact.

**Recommendation:**

Provide a concrete solution.

Example:

### CRITICAL — Missing Tenant Filter

**Location:**
`repositories/report.repository.ts`

**Problem:**

The query searches for a report only by `_id`.

**Impact:**

A user could retrieve a report belonging to another organization if the report ID is known.

**Recommendation:**

Scope the query using the authenticated organization:

{
  _id: reportId,
  organizationId: organizationId
}

Add a regression test proving that a user cannot access another organization's report.

---

# 56. Avoid False Positives

Before reporting an issue:

- Inspect surrounding code.
- Check middleware.
- Check repository implementation.
- Check service implementation.
- Check model schema.
- Check indexes.
- Check tests.

If tenant filtering happens in a trusted repository layer, do not report the controller for missing filtering without understanding the architecture.

If an index exists elsewhere, verify before reporting it as missing.

If uncertain, clearly state the uncertainty.

---

# 57. Do Not Modify Code During Review

When asked to review:

- Do not modify files automatically.
- Do not create migrations automatically.
- Do not create indexes automatically.
- Do not delete data.
- Do not run destructive database commands.

Report findings first.

Only make changes when explicitly requested.

---

# 58. Do Not Run Destructive Commands

Never execute destructive database operations as part of a normal review.

Do not run:

db.dropDatabase()
db.collection.drop()
deleteMany({})
drop indexes

against a database unless explicitly requested and the environment is clearly safe.

Prefer read-only inspection.

---

# 59. Database Review Checklist

Before completing the review:

- [ ] Data model reviewed
- [ ] Ownership reviewed
- [ ] Tenant isolation reviewed
- [ ] CRUD queries reviewed
- [ ] Aggregation pipelines reviewed
- [ ] NoSQL injection reviewed
- [ ] Mass assignment reviewed
- [ ] Indexes reviewed
- [ ] Compound indexes reviewed
- [ ] Unique constraints reviewed
- [ ] Query performance reviewed
- [ ] Explain plans considered where appropriate
- [ ] Pagination reviewed
- [ ] Sorting reviewed
- [ ] Filtering reviewed
- [ ] Projection reviewed
- [ ] Population reviewed
- [ ] N+1 queries reviewed
- [ ] Document size considered
- [ ] Embedding vs referencing reviewed
- [ ] Transactions reviewed
- [ ] Concurrency reviewed
- [ ] Atomic operations reviewed
- [ ] Schema validation reviewed
- [ ] Schema evolution reviewed
- [ ] Migration safety reviewed
- [ ] Sensitive data reviewed
- [ ] Audit requirements reviewed
- [ ] Connection handling reviewed
- [ ] Background jobs reviewed
- [ ] Analytics queries reviewed
- [ ] Data retention reviewed
- [ ] Tests reviewed
- [ ] No destructive operations performed
- [ ] Findings prioritized
- [ ] False positives avoided

---

# 60. Final Database Review Principle

The database review should answer five questions:

1. **Is the data correct?**
2. **Is the data secure?**
3. **Is tenant data completely isolated?**
4. **Will the database perform acceptably as data grows?**
5. **Can the schema evolve safely?**

For this SaaS application, **tenant isolation is non-negotiable**.

A query that is functionally correct but can return another tenant's data must be treated as a critical defect.

Prefer:

Correctness
+
Security
+
Tenant isolation
+
Performance
+
Data integrity
+
Maintainability

over clever database techniques or premature optimization.
:::
```
