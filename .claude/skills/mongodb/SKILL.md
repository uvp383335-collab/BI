# MongoDB Skill

```text
---
name: mongodb
description: Design, implement, optimize, and review MongoDB and Mongoose data access for the React + TypeScript + Node.js + MongoDB multi-tenant SaaS application. Use this skill whenever creating or modifying MongoDB schemas, Mongoose models, repositories, queries, aggregation pipelines, indexes, migrations, transactions, pagination, data validation, or database performance.
---

# MongoDB Development Standards

## 1. Core Principles

- Follow the existing project's MongoDB and Mongoose conventions before introducing new patterns.
- Design schemas around application access patterns.
- Keep database access separate from business logic.
- Prefer simple queries over unnecessarily complex aggregation pipelines.
- Optimize based on actual query patterns and evidence.
- Never compromise tenant isolation for convenience.
- Never trust client-provided tenant identifiers for authorization.
- Validate external input before constructing MongoDB queries.
- Avoid unbounded queries.
- Avoid unnecessary database calls.
- Protect sensitive fields.
- Use indexes intentionally.
- Preserve backward compatibility when changing schemas.
- Do not introduce database abstractions without a clear benefit.

---

# 2. MongoDB Architecture

Prefer the following conceptual flow:

Route
  ↓
Controller
  ↓
Service
  ↓
Repository / Data Access
  ↓
Mongoose
  ↓
MongoDB

Responsibilities:

### Controller

- HTTP concerns
- Request/response handling
- Calling services

### Service

- Business logic
- Authorization
- Tenant context
- Business rules
- Transaction orchestration

### Repository

- MongoDB queries
- Persistence
- Aggregations
- Database-specific operations

### Model

- Schema definition
- Mongoose configuration
- Database-level validation where appropriate

Do not put business logic into MongoDB queries unless the logic is genuinely data-access-specific.

---

# 3. MongoDB Document Design

Design documents based on:

- Read patterns
- Write patterns
- Relationship cardinality
- Document growth
- Query frequency
- Update frequency
- Consistency requirements
- Tenant boundaries

Do not automatically normalize everything.

Do not automatically embed everything.

Choose between embedding and referencing based on actual application behavior.

---

# 4. Embedding

Prefer embedding when:

- Data is tightly coupled to the parent.
- Data is usually retrieved together.
- The embedded collection has a bounded size.
- The embedded data does not need independent lifecycle management.
- Updates generally occur with the parent.

Example:

{
  _id,
  organizationId,
  settings: {
    timezone,
    locale,
    dateFormat
  }
}

This can be appropriate when settings are always retrieved with the organization.

---

# 5. Referencing

Prefer references when:

- Related data has an independent lifecycle.
- The related collection can grow significantly.
- The entity is accessed independently.
- The relationship is many-to-many.
- Multiple documents need to reference the same entity.
- Embedding would make documents excessively large.

Example:

Organization
  ↓
Membership collection

instead of an indefinitely growing members array.

---

# 6. Avoid Unbounded Arrays

Do not store indefinitely growing arrays inside a single document.

Avoid:

{
  organizationId,
  auditLogs: [
    ...
  ]
}

if auditLogs can grow indefinitely.

Prefer:

organization
auditLog collection

with:

organizationId

on each audit record.

The same principle applies to:

- Notifications
- Events
- Transactions
- Activity history
- Large message lists
- Analytics records
- Job history

---

# 7. Document Size

Be aware of MongoDB's document size limitations.

Review:

- Large arrays
- Large nested objects
- Embedded history
- Large text fields
- Binary data
- Large analytics results

Do not store unbounded or very large datasets in a single document.

---

# 8. Multi-Tenant Data Model

This application is multi-tenant.

Tenant-owned documents should have a reliable tenant relationship.

Preferred example:

{
  _id,
  organizationId,
  name,
  createdAt,
  updatedAt
}

Use the project's established naming convention, such as:

organizationId
tenantId

Do not introduce both terms for the same concept unless the domain explicitly requires both.

---

# 9. Tenant Isolation

Tenant isolation is mandatory.

Every tenant-owned query must be scoped to the authenticated tenant.

Preferred:

const report = await Report.findOne({
  _id: reportId,
  organizationId
});

Avoid:

const report = await Report.findById(reportId);

when the resource is tenant-owned and no equivalent tenant authorization exists elsewhere.

Never rely on the frontend to provide the correct tenant ID.

---

# 10. Tenant Context

Tenant context must originate from trusted server-side authentication and authorization.

Unsafe:

const { organizationId } = req.body;

const report = await Report.findOne({
  _id: reportId,
  organizationId
});

if `organizationId` has not been independently verified.

Preferred conceptual flow:

Authentication
  ↓
Authenticated user
  ↓
Validated organization membership
  ↓
Trusted organization context
  ↓
Repository
  ↓
MongoDB

---

# 11. Tenant Scope Every Operation

Review tenant isolation for:

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
- distinct
- aggregate

Also review:

- Background jobs
- Reports
- Analytics
- Exports
- Search
- Scheduled tasks
- Cache keys
- External integrations

---

# 12. Tenant-Aware Repository Design

Prefer repositories that make tenant scope explicit.

Example:

async findReport(
  organizationId: string,
  reportId: string
) {
  return Report.findOne({
    _id: reportId,
    organizationId
  });
}

This makes tenant isolation visible at the data-access boundary.

For complex applications, consider a tenant-aware repository pattern that makes it difficult to accidentally perform an unscoped query.

Do not over-engineer this pattern unnecessarily.

---

# 13. Mongoose Schemas

Use Mongoose schemas consistently with the project.

Define:

- Types
- Required fields
- Defaults
- Enums
- Validation
- Indexes
- Timestamps

Example:

const UserSchema = new Schema(
  {
    organizationId: {
      type: Schema.Types.ObjectId,
      ref: "Organization",
      required: true,
      index: true
    },

    email: {
      type: String,
      required: true
    }
  },
  {
    timestamps: true
  }
);

Use the actual project's naming and model conventions.

---

# 14. Schema Validation

Use validation at multiple boundaries.

### API validation

Protects the application boundary.

### Mongoose validation

Protects model-level integrity.

### Database constraints/indexes

Protect important invariants.

Do not assume Mongoose validation alone guarantees all database integrity.

---

# 15. Required Fields

Mark fields required when the domain requires them.

Be careful when making a new field required on an existing collection.

Existing documents may not contain that field.

Before changing:

required: false

to:

required: true

determine whether existing data requires migration.

---

# 16. Enum Fields

Use enums for controlled states.

Example:

status:

- active
- inactive
- suspended

Do not use arbitrary strings when the domain has a fixed set of states.

Avoid allowing clients to introduce unsupported state values.

---

# 17. Defaults

Use defaults for fields that have a genuine domain default.

Examples:

createdAt
status
isActive

Do not use defaults to hide missing or invalid business data.

---

# 18. Dates

Store canonical timestamps using MongoDB Date values.

Prefer:

createdAt: Date
updatedAt: Date

Avoid storing canonical timestamps as arbitrary strings.

Use UTC for persisted timestamps unless the domain requires another representation.

Convert to user-local time at presentation boundaries.

---

# 19. ObjectId

Use MongoDB ObjectId appropriately for MongoDB references.

Validate IDs before querying.

Do not allow malformed IDs to produce confusing database errors.

Example:

if (!Types.ObjectId.isValid(id)) {
  throw new ValidationError("Invalid resource ID");
}

Follow the project's existing validation approach.

---

# 20. Sensitive Fields

Never expose sensitive fields by default.

Potentially sensitive fields include:

- passwordHash
- refreshToken
- API keys
- OAuth credentials
- internal security fields
- recovery tokens

Use:

- Schema configuration
- Explicit projections
- Response DTOs

to prevent accidental exposure.

---

# 21. Passwords

Never store plaintext passwords.

Use an established password hashing algorithm and follow the project's authentication architecture.

Do not implement custom cryptography.

Do not log passwords.

Do not return password hashes in API responses.

---

# 22. Query Construction

Never pass raw client input directly into MongoDB.

Avoid:

Model.find(req.query);

Avoid:

Model.find({
  ...req.body
});

Avoid:

Model.find({
  organizationId,
  ...req.query
});

unless the query object has been strictly validated and transformed.

Instead:

1. Validate input.
2. Extract supported fields.
3. Transform values.
4. Construct the query explicitly.

---

# 23. NoSQL Injection

Treat MongoDB operators as potentially dangerous when supplied by users.

Pay particular attention to:

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

Do not allow arbitrary MongoDB operators from request input.

Example of unsafe behavior:

{
  email: req.body.email
}

if the input can become:

{
  "$ne": null
}

Use runtime validation and explicit transformation.

---

# 24. Filtering

Only allow supported filter fields.

Example:

const filter = {
  organizationId,
  status: validatedStatus
};

Do not expose arbitrary database fields to clients.

Maintain explicit allowlists where practical.

---

# 25. Sorting

Only allow supported sort fields.

Example:

const allowedSortFields = [
  "createdAt",
  "updatedAt",
  "name"
];

Do not allow arbitrary MongoDB field paths from users.

Validate sort direction:

asc
desc

or the project's established representation.

---

# 26. Pagination

Collection endpoints must use pagination when result size can grow.

Offset pagination:

.skip(skip)
.limit(limit)

may be acceptable for smaller datasets.

For large datasets, consider cursor-based pagination.

Example:

?cursor=<createdAt-or-id>&limit=20

Always enforce a maximum page size.

Do not allow unlimited queries.

---

# 27. Stable Pagination

Pagination should use deterministic ordering.

Avoid relying only on a field with many duplicate values.

For example, if sorting by:

createdAt

consider a deterministic secondary sort such as `_id` where appropriate.

This reduces duplicate/missing records between pages.

---

# 28. Projection

Retrieve only fields required by the operation.

Example:

const users = await User.find(
  query,
  {
    name: 1,
    email: 1,
    createdAt: 1
  }
);

Avoid retrieving large sensitive fields unnecessarily.

Projection can improve:

- Performance
- Memory usage
- Network payload
- Security

---

# 29. Lean Queries

Consider `.lean()` for read-only Mongoose queries when Mongoose document methods are unnecessary.

Example:

const users = await User
  .find(query)
  .lean();

Use `.lean()` when appropriate.

Do not use it blindly if the application relies on:

- Mongoose document methods
- Getters
- Setters
- Virtual behavior
- Other document-specific behavior

Follow existing project conventions.

---

# 30. Query Performance

Review queries for:

- Collection scans
- Unnecessary fields
- Large result sets
- Missing indexes
- Expensive sorting
- Expensive regex
- Excessive population
- N+1 operations

Use query execution plans where necessary.

Prefer evidence-based optimization.

---

# 31. Explain Plans

For suspicious or important queries, consider:

explain("executionStats")

Review:

- Winning plan
- Collection scan
- Index scan
- Keys examined
- Documents examined
- Documents returned

A query returning 20 documents while scanning millions should be investigated.

---

# 32. Index Design

Indexes should support real query patterns.

Consider:

- Equality filters
- Tenant filters
- Sorting
- Range queries
- Uniqueness

Example:

{
  organizationId: 1,
  createdAt: -1
}

may support:

{
  organizationId
}

plus:

sort({
  createdAt: -1
})

The exact index should be determined from real query patterns.

---

# 33. Compound Index Order

When designing compound indexes, consider:

1. Equality fields
2. Sort fields
3. Range fields

Example query:

{
  organizationId,
  status,
  createdAt: {
    $gte: startDate
  }
}

with:

sort({
  createdAt: -1
})

may benefit from an index such as:

{
  organizationId: 1,
  status: 1,
  createdAt: -1
}

Validate with explain plans where possible.

---

# 34. Unique Indexes

Use database-level uniqueness where the domain requires it.

Do not rely only on:

findOne()
  ↓
if not exists
  ↓
create()

because concurrent requests can create duplicates.

Use unique indexes.

For tenant-specific uniqueness, consider compound indexes.

Example:

{
  organizationId: 1,
  email: 1
}

with:

unique: true

only if the business rule requires email uniqueness within each organization.

---

# 35. Partial Indexes

Use partial indexes when only a subset of documents participates in a query or uniqueness requirement.

Example use cases:

- Active records
- Non-deleted records
- Documents with a specific state

Do not introduce partial indexes without understanding how queries interact with the index.

---

# 36. Index Overuse

Every index has a cost.

Indexes increase:

- Storage
- Write overhead
- Memory requirements
- Maintenance

Do not create an index for every property.

Review existing indexes before adding new ones.

Avoid duplicate or redundant indexes.

---

# 37. N+1 Queries

Identify patterns such as:

const users = await User.find(...);

for (const user of users) {
  const reports = await Report.find({
    userId: user._id
  });
}

This can create:

1 + N database queries.

Consider:

- `$in`
- Aggregation
- Batch queries
- Data modeling changes

Do not replace N+1 with an uncontrolled massive query without considering performance.

---

# 38. Population

Use `populate()` selectively.

Review:

- Number of populated documents
- Fields populated
- Nested population
- Result size
- Query count
- Tenant isolation

Prefer selecting only required fields.

Example:

.populate("organization", "name")

instead of retrieving the entire organization document unnecessarily.

---

# 39. Aggregation Pipelines

Use aggregation when it provides a clear benefit.

Review:

- `$match`
- `$project`
- `$lookup`
- `$unwind`
- `$group`
- `$sort`
- `$limit`
- `$skip`

Apply restrictive `$match` stages early where appropriate.

Avoid unnecessary `$lookup` operations.

Avoid processing massive datasets when the query can be made more selective.

---

# 40. Tenant Filtering in Aggregation

Always apply tenant scope.

Preferred:

[
  {
    $match: {
      organizationId
    }
  },
  {
    $group: {
      _id: "$status",
      count: {
        $sum: 1
      }
    }
  }
]

Do not:

1. Aggregate all tenants.
2. Return results to Node.js.
3. Filter tenants afterward.

Tenant filtering belongs inside the database operation whenever possible.

---

# 41. Aggregation Performance

When reviewing aggregation pipelines:

- Match early.
- Project unnecessary fields out.
- Avoid unnecessary `$lookup`.
- Avoid unnecessary `$unwind`.
- Limit result sets.
- Review indexes.
- Check explain plans for expensive pipelines.

For analytics-heavy workloads, consider whether pre-aggregation or materialized data is more appropriate.

Do not introduce pre-aggregation without evidence that the workload requires it.

---

# 42. Atomic Operations

Prefer atomic MongoDB updates when possible.

Examples:

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

when concurrent requests can modify the same document.

---

# 43. Concurrency

Consider concurrent requests for:

- Counters
- Inventory
- Subscription state
- Membership changes
- Resource ownership
- Job processing
- Webhooks

Use:

- Atomic operators
- Unique indexes
- Transactions
- Optimistic concurrency
- Versioning

where appropriate.

---

# 44. Transactions

Use transactions when multiple database operations must be atomic.

Example:

Create organization
  ↓
Create owner membership
  ↓
Create organization settings

If all three must succeed together, consider a transaction.

Do not use transactions for every database operation.

Keep transactions short.

Avoid external API calls inside database transactions whenever possible.

---

# 45. Transaction Error Handling

When using transactions:

- Handle commit failures.
- Handle transient failures.
- Roll back appropriately.
- Avoid partial state.
- Keep transaction scope minimal.

Do not assume that starting a transaction automatically guarantees correct business behavior.

---

# 46. Updates

Explicitly whitelist fields that can be updated.

Avoid:

Model.findOneAndUpdate(
  filter,
  req.body
);

Prefer:

const update = {
  name: validated.name,
  description: validated.description
};

Do not allow ordinary update endpoints to modify:

- organizationId
- ownerId
- role
- permissions
- createdAt
- security fields
- subscription state

unless explicitly authorized.

---

# 47. Upserts

Review upserts carefully.

Upserts can unintentionally create records when a query does not match.

When using:

upsert: true

verify:

- Query fields
- Update fields
- Unique indexes
- Tenant scope
- Concurrency behavior

Tenant scope must be included in the upsert filter where appropriate.

---

# 48. Deletes

Before deleting:

1. Verify authorization.
2. Verify tenant ownership.
3. Determine dependent records.
4. Determine audit requirements.
5. Determine whether soft delete is required.

Avoid unscoped deletes.

Never perform:

deleteMany({})

without explicit authorization and a clearly controlled context.

---

# 49. Soft Deletes

If the application uses soft deletion:

Use a consistent convention such as:

deletedAt

and possibly:

deletedBy

Normal queries should exclude deleted records.

Review:

- Indexes
- Unique constraints
- Restoration
- Reports
- Aggregations
- Background jobs

Ensure deleted records do not accidentally appear in normal application flows.

---

# 50. Cascading Data

MongoDB does not automatically enforce relational cascades.

When deleting:

Organization
  ↓
Memberships
  ↓
Projects
  ↓
Reports

determine which related records should:

- Be deleted
- Be archived
- Remain
- Be detached

Do not assume cascading behavior exists automatically.

---

# 51. Referential Integrity

When using references:

- Validate referenced IDs.
- Handle missing references.
- Avoid orphan records where the domain does not permit them.
- Consider cleanup strategy.

MongoDB does not automatically guarantee referential integrity like a relational database.

---

# 52. Schema Evolution

Before modifying a schema:

1. Inspect existing documents.
2. Identify old schema versions.
3. Determine compatibility.
4. Determine migration requirements.
5. Consider rolling deployments.
6. Consider rollback.

Do not assume every document already has the newest fields.

---

# 53. Migrations

Migrations should be:

- Repeatable where practical.
- Safe.
- Tested.
- Observable.
- Appropriate for the dataset size.

Before production migration:

- Test on representative data.
- Estimate runtime.
- Consider backup/recovery.
- Consider deployment ordering.
- Consider rollback strategy.

Avoid destructive migrations without explicit approval.

---

# 54. Backward-Compatible Schema Changes

For production deployments, prefer:

Phase 1:
Add new optional field.

Phase 2:
Deploy application that writes the new field.

Phase 3:
Backfill existing documents.

Phase 4:
Update reads to require/use the new field.

Phase 5:
Make the field required if appropriate.

Avoid immediately making a new required field mandatory when older application instances may still exist.

---

# 55. Data Types

Use appropriate MongoDB data types.

Prefer:

Date
ObjectId
Boolean
Number
Decimal128 where appropriate

Avoid storing dates as arbitrary strings.

For financial values, do not assume JavaScript floating-point numbers provide the required precision.

Use an appropriate representation such as Decimal128 or integer minor units according to the application's financial requirements.

---

# 56. Timestamps

Use consistent timestamps.

Prefer:

createdAt
updatedAt

Use UTC for persisted timestamps.

Use Mongoose timestamps when appropriate:

{
  timestamps: true
}

Do not manually maintain timestamps in many unrelated locations unless required.

---

# 57. Data Retention

Consider retention requirements for:

- Audit logs
- Events
- Temporary tokens
- Analytics data
- Integration history
- Background jobs
- Deleted resources

Do not retain sensitive data indefinitely without a business requirement.

---

# 58. TTL Indexes

Use TTL indexes for appropriate temporary data.

Examples:

- Verification tokens
- Temporary sessions
- Expiring records
- Temporary jobs

Do not use TTL indexes for data requiring permanent retention.

---

# 59. Audit Data

For important operations, consider storing audit records.

Examples:

- Organization membership changes
- Role changes
- Permission changes
- Resource deletion
- Authentication events
- Integration configuration
- Subscription changes

Audit records may contain:

- organizationId
- userId
- action
- resourceId
- timestamp

Do not store unnecessary sensitive payloads.

---

# 60. Connection Management

Use a shared MongoDB connection/pool.

Do not create a new MongoDB connection for every HTTP request.

Review:

- Connection pool size
- Connection timeout
- Server selection timeout
- Retry behavior
- Startup failure
- Shutdown behavior

The exact settings should depend on deployment characteristics.

---

# 61. Graceful Shutdown

On application shutdown:

1. Stop accepting new requests.
2. Allow active operations to finish where practical.
3. Stop background workers.
4. Close MongoDB connections.
5. Exit cleanly.

Do not abruptly terminate active database operations unless required.

---

# 62. Background Jobs

Background jobs must preserve tenant context.

Example:

{
  organizationId,
  reportId,
  requestedBy
}

The worker must validate the tenant context before accessing data.

Never create a worker that retrieves a resource only by ID if the resource is tenant-owned and tenant authorization is required.

---

# 63. Analytics and BI Queries

For analytics workloads:

- Always scope by organization/tenant.
- Use date filters.
- Use appropriate indexes.
- Avoid unbounded historical queries where possible.
- Consider pre-aggregation for expensive repeated calculations.
- Consider caching where appropriate.
- Review aggregation pipelines carefully.
- Avoid returning massive datasets to the application.

Analytics queries can become expensive quickly as data volume grows.

---

# 64. Search

For search requirements, choose an appropriate mechanism.

Small datasets may use simple indexed queries.

Large datasets may require:

- MongoDB text indexes
- MongoDB Search
- Dedicated search infrastructure

Do not use unindexed regex queries as a general search strategy for large collections.

---

# 65. Repository Rules

Repositories should:

- Accept validated inputs.
- Receive trusted tenant context.
- Encapsulate MongoDB queries.
- Return appropriate data structures.
- Avoid HTTP-specific logic.

Repositories should not:

- Read `req.body`.
- Read `req.query`.
- Decide HTTP status codes.
- Return HTTP responses.
- Trust raw client input.

---

# 66. MongoDB Review Workflow

When implementing or reviewing database code:

### Step 1 — Understand the resource

Determine:

- What is being stored?
- Who owns it?
- Is it tenant-scoped?
- How large can it become?

### Step 2 — Understand access patterns

Determine:

- How is it queried?
- How is it sorted?
- How is it filtered?
- How frequently is it accessed?
- How frequently is it updated?

### Step 3 — Review schema

Check:

- Types
- Required fields
- References
- Embedded data
- Validation
- Timestamps

### Step 4 — Review queries

Check:

- Tenant scope
- Filters
- Projection
- Pagination
- Sorting
- Aggregation

### Step 5 — Review indexes

Check:

- Existing indexes
- Required indexes
- Compound indexes
- Unique constraints
- Redundant indexes

### Step 6 — Review security

Check:

- NoSQL injection
- Mass assignment
- Sensitive fields
- Tenant isolation

### Step 7 — Review performance

Check:

- Query plans
- N+1
- Collection scans
- Large documents
- Large aggregations

### Step 8 — Review integrity

Check:

- Transactions
- Concurrency
- Uniqueness
- References
- Migration safety

---

# 67. MongoDB Development Checklist

Before considering a database change complete:

- [ ] Schema follows existing conventions
- [ ] Data ownership is clear
- [ ] Tenant ownership is explicit
- [ ] Tenant isolation is enforced
- [ ] Input is validated
- [ ] MongoDB operators are not blindly accepted
- [ ] Sensitive fields are protected
- [ ] Updates use explicit field allowlists
- [ ] Deletes are tenant-scoped
- [ ] Queries are bounded
- [ ] Pagination is implemented where necessary
- [ ] Sorting is validated
- [ ] Projection is considered
- [ ] Population is justified
- [ ] Aggregation is optimized
- [ ] N+1 queries are avoided
- [ ] Appropriate indexes exist
- [ ] Unique constraints are correct
- [ ] Transactions are used where necessary
- [ ] Concurrency is considered
- [ ] Schema migration is safe
- [ ] Existing documents are considered
- [ ] Connection handling is correct
- [ ] Background jobs preserve tenant context
- [ ] Analytics queries are tenant-scoped
- [ ] Tests cover important database behavior

---

# 68. Final Principles

When designing MongoDB functionality:

1. Design around access patterns.
2. Keep documents reasonably bounded.
3. Embed when data belongs together and remains bounded.
4. Reference when data has an independent lifecycle or unbounded growth.
5. Use indexes intentionally.
6. Validate external input.
7. Never trust client-supplied tenant identity.
8. Enforce tenant isolation at the data-access boundary.
9. Avoid unbounded queries.
10. Prefer atomic updates where appropriate.
11. Use transactions only when necessary.
12. Use database-level constraints for important invariants.
13. Optimize based on evidence.
14. Protect sensitive fields.
15. Design schema changes for backward compatibility.
16. Keep MongoDB-specific concerns inside the data layer where practical.

For this SaaS application, the highest-priority rule is:

**A database query is not considered correct if it can return, update, delete, aggregate, or otherwise expose data belonging to another tenant.**

Tenant isolation, data integrity, and security take priority over query convenience or implementation simplicity.
```
