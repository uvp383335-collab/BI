# Code Review Skill

```text
---
name: code-review
description: Perform thorough, production-grade code reviews for the React + TypeScript + Node.js + MongoDB multi-tenant SaaS application. Use this skill whenever reviewing new code, modified code, pull requests, diffs, refactors, bug fixes, API changes, database changes, authentication/authorization changes, or feature implementations.
---

# Code Review Standards

## 1. Review Objective

The goal of the code review is to identify:

- Bugs
- Security vulnerabilities
- Authorization issues
- Multi-tenant data leakage
- Incorrect business logic
- Architectural violations
- Performance problems
- Database issues
- TypeScript issues
- React issues
- Node.js issues
- Missing validation
- Missing error handling
- Missing tests
- Maintainability problems
- Breaking changes
- Unnecessary complexity

Do not review code only for formatting or personal style preferences.

Prioritize correctness, security, maintainability, and production impact.

---

## 2. Review Existing Project Conventions First

Before reviewing the implementation:

1. Inspect the relevant project structure.
2. Inspect similar existing implementations.
3. Inspect existing coding patterns.
4. Inspect existing error handling.
5. Inspect existing validation.
6. Inspect existing authentication and authorization.
7. Inspect existing database access patterns.
8. Inspect relevant tests.
9. Inspect project configuration where necessary.

Do not report something as a problem merely because it differs from a generic pattern if the project has an established and valid convention.

Prefer consistency with the existing architecture unless the existing approach is itself problematic.

---

## 3. Review the Actual Change

When reviewing a change:

- Inspect `git diff`.
- Identify changed files.
- Understand why each file changed.
- Trace the execution flow.
- Identify affected API contracts.
- Identify affected database operations.
- Identify affected frontend behavior.
- Identify authentication/authorization impact.
- Identify tenant-isolation impact.

Do not review only individual lines without understanding their surrounding behavior.

---

## 4. Review Priority

Classify findings by severity.

### CRITICAL

Issues that can cause:

- Cross-tenant data exposure
- Authentication bypass
- Authorization bypass
- Remote code execution
- Credential/secret exposure
- Destructive production behavior
- Severe data corruption

These must be fixed before merging.

### HIGH

Issues that can cause:

- Significant security vulnerabilities
- Major data integrity problems
- Broken core functionality
- Serious performance degradation
- Incorrect authorization
- Important production failures

These should normally be fixed before merging.

### MEDIUM

Issues that can cause:

- Incorrect edge-case behavior
- Maintainability problems
- Missing important validation
- Moderate performance issues
- Missing error handling
- Missing important tests

These should generally be addressed before or shortly after merging.

### LOW

Issues such as:

- Minor maintainability improvements
- Small readability improvements
- Non-critical consistency issues

Do not overwhelm the review with low-value findings.

---

## 5. Finding Format

Every important finding should contain:

### Severity

Example:

CRITICAL

### Location

Identify the file and relevant code section.

### Problem

Explain what is wrong.

### Impact

Explain what can happen because of the issue.

### Recommendation

Explain how to fix it.

Example:

CRITICAL — Tenant Isolation

Problem:
The repository queries a report only by `_id`.

Impact:
A user could access a report belonging to another organization if they know its ID.

Recommendation:
Scope the query using the authenticated organization ID:

{
  _id: reportId,
  organizationId: authenticatedOrganizationId
}

Do not merely say:

"Security issue here."

Explain why it is a problem.

---

## 6. Avoid False Positives

Do not report speculative issues without evidence.

Before reporting a problem:

1. Inspect surrounding code.
2. Check how the function is called.
3. Check related middleware.
4. Check types.
5. Check tests.
6. Check configuration.
7. Verify whether the behavior is actually possible.

If something is uncertain, explicitly state the uncertainty.

Do not treat every theoretical possibility as a real vulnerability.

---

## 7. Correctness

Verify:

- Business logic
- Conditions
- Branches
- Edge cases
- Null/undefined behavior
- Empty collections
- Duplicate requests
- Concurrent operations
- Error paths
- Retry behavior
- Partial failures

Ask:

- Does this implementation actually satisfy the requirement?
- Does it behave correctly for invalid input?
- Does it behave correctly when dependencies fail?
- Does it preserve existing behavior?
- Does it introduce regressions?

---

# React Review

## 8. React Component Design

Check:

- Component responsibilities
- Component size
- Reusability
- Props
- State
- Effects
- Event handlers
- Conditional rendering
- Error states
- Loading states
- Empty states

Identify components that contain too much unrelated business logic.

Avoid recommending extraction simply because a component is long.

Extraction should improve responsibility boundaries or reuse.

---

## 9. React State

Check for:

- Duplicate state
- Derived state stored unnecessarily
- Stale state
- Incorrect state updates
- Unnecessary global state
- State synchronization problems
- Race conditions

Prefer derived values instead of storing values that can be calculated.

Example:

Avoid:

const [fullName, setFullName] = useState("");

when:

const fullName = `${firstName} ${lastName}`;

is sufficient.

---

## 10. React useEffect

Review every `useEffect` carefully.

Check:

- Dependency array
- Cleanup
- Stale closures
- Infinite loops
- Unnecessary effects
- Race conditions
- Async behavior
- Component unmount behavior

Do not use `useEffect` simply because something needs to be calculated.

Prefer derived state for pure calculations.

---

## 11. React Performance

Check for:

- Unnecessary re-renders
- Large lists
- Missing virtualization where required
- Expensive calculations
- Excessive context updates
- Unnecessary API calls
- Unnecessary state updates
- Large bundle imports
- Missing lazy loading where appropriate

Do not recommend `useMemo`, `useCallback`, or `React.memo` everywhere.

Use memoization only when there is a meaningful performance reason.

---

## 12. React API Handling

Check:

- Loading state
- Error state
- Empty state
- Request cancellation where appropriate
- Duplicate requests
- Retry behavior
- Authentication handling
- Response validation

Do not put sensitive server-side logic into React.

Never expose backend secrets in frontend code.

---

## 13. React Security

Check for:

- Unsafe `dangerouslySetInnerHTML`
- XSS
- Unsafe URL handling
- Sensitive information in local storage
- Tokens exposed unnecessarily
- Client-side authorization being treated as security
- Secrets included in frontend bundles

Remember:

Frontend authorization is not security.

The backend must enforce authorization.

---

# TypeScript Review

## 14. Type Safety

Check for:

- `any`
- Unsafe type assertions
- Incorrect interfaces
- Missing return types where useful
- Incorrect optional properties
- Null/undefined handling
- Type mismatches
- Unvalidated external data

Avoid:

const data: any = response;

when a proper type or runtime validation can be used.

Do not use TypeScript types as a substitute for runtime validation.

---

## 15. External Data

Anything coming from:

- HTTP requests
- APIs
- MongoDB
- User input
- Environment variables
- Files
- Third-party libraries

should be treated as potentially invalid until validated appropriately.

TypeScript compile-time types do not validate runtime data.

---

# Node.js Review

## 16. Controller Review

Controllers should remain thin.

Check that controllers:

- Validate input through the established validation layer.
- Read authentication context.
- Read tenant context.
- Call services.
- Return appropriate responses.
- Delegate errors appropriately.

Flag controllers containing substantial business logic.

---

## 17. Service Review

Services should contain business logic.

Check:

- Business rules
- Authorization
- Transaction coordination
- Repository usage
- External integrations
- Error handling

Avoid services that become massive "god classes."

If a service has many unrelated responsibilities, consider splitting it by business capability.

---

## 18. Async Code

Check:

- Missing `await`
- Unhandled promises
- Incorrect Promise chains
- Sequential operations that could safely run concurrently
- Concurrent operations that should actually be sequential
- Race conditions
- Timeout handling

Avoid:

array.forEach(async item => {
  await process(item);
});

when the intended behavior requires awaiting all operations.

Prefer an appropriate `Promise.all` or sequential loop depending on business requirements.

Do not use `Promise.all` when operations have ordering or transactional dependencies.

---

## 19. Error Handling

Check:

- Errors are not swallowed.
- Errors are logged appropriately.
- Sensitive information is not logged.
- Application errors are mapped consistently.
- Unexpected errors reach centralized error handling.
- External errors are handled safely.

Avoid:

try {
  ...
} catch {
}

unless intentionally ignoring the error is justified.

---

## 20. Configuration

Check:

- Required environment variables
- Defaults
- Validation
- Secret handling
- Environment-specific configuration

Never commit:

- API keys
- Passwords
- JWT secrets
- OAuth client secrets
- Database credentials

Do not expose server-only environment variables to React.

---

# API Review

## 21. REST API

Check:

- HTTP method
- URL naming
- Status codes
- Request structure
- Response structure
- Pagination
- Filtering
- Sorting
- Error format
- Versioning
- Backward compatibility

Do not approve APIs that return 200 for every outcome.

---

## 22. API Validation

Verify validation for:

- Body
- Query parameters
- Path parameters
- Headers where appropriate

Check:

- Required fields
- Types
- Formats
- Length
- Ranges
- Enums
- Nested structures

Never rely only on frontend validation.

---

## 23. API Authorization

For every protected endpoint ask:

1. Is the user authenticated?
2. Is the user authorized?
3. Does the user have the required permission?
4. Does the user belong to the requested tenant?
5. Does the user have access to the specific resource?

A valid JWT does not automatically mean the user can access the resource.

---

# Multi-Tenant Review

## 24. Tenant Isolation

This is a mandatory review area.

For every tenant-owned operation verify:

- Tenant context is established server-side.
- Tenant ID is not blindly trusted from the client.
- Database queries are tenant-scoped.
- Updates are tenant-scoped.
- Deletes are tenant-scoped.
- Aggregations are tenant-scoped.
- Background jobs preserve tenant context.
- Cache keys preserve tenant isolation.
- External integrations use the correct tenant.
- Reports and analytics are tenant-scoped.

Flag as CRITICAL if a realistic cross-tenant data-access path exists.

---

## 25. Tenant Query Review

Bad:

Model.findById(resourceId);

Potentially safe:

Model.findOne({
  _id: resourceId,
  organizationId: authenticatedOrganizationId
});

The exact implementation may differ, but tenant isolation must exist somewhere enforceable in the architecture.

Review:

- `find`
- `findOne`
- `findById`
- `findOneAndUpdate`
- `findOneAndDelete`
- `updateMany`
- `deleteMany`
- Aggregation pipelines

Do not assume that GET endpoints are the only tenant-isolation concern.

---

# MongoDB Review

## 26. MongoDB Query Safety

Check for:

- Raw user input passed directly into queries
- MongoDB operator injection
- Unbounded queries
- Missing tenant filters
- Missing pagination
- Excessive projections
- Inefficient aggregations
- Incorrect ObjectId handling

Avoid:

Model.find(req.query);

unless the input has been explicitly transformed and validated.

---

## 27. MongoDB Performance

Check:

- Appropriate indexes
- Compound indexes
- Query selectivity
- Aggregation pipeline ordering
- Large collection scans
- Unnecessary population
- N+1 queries
- Large documents
- Unbounded result sets

Do not recommend an index without understanding the query pattern.

---

## 28. MongoDB Updates

Check for mass assignment.

Avoid:

Model.updateOne(
  { _id: id },
  req.body
);

unless request data has been explicitly validated and restricted.

Protected fields may include:

- organizationId
- role
- permissions
- accountStatus
- subscription
- security settings

Only update fields that the API intentionally allows.

---

# Security Review

## 29. Authentication

Check:

- Token validation
- Expiration
- Signature validation
- Refresh-token handling
- Session handling
- Logout behavior
- Password handling
- OAuth handling

Never trust decoded JWT data before verifying the token.

---

## 30. Authorization

Check for:

- IDOR
- Broken access control
- Missing permission checks
- Missing resource ownership checks
- Missing tenant checks
- Client-only authorization

A frontend route guard is never sufficient authorization.

---

## 31. Injection

Check for:

- NoSQL injection
- Command injection
- XSS
- SQL injection if another database is introduced
- Path traversal
- SSRF
- Unsafe dynamic evaluation

Never pass raw user input into:

- MongoDB operators
- Shell commands
- Dynamic code execution
- File paths
- External URLs

without appropriate validation and controls.

---

## 32. Secrets

Search changed code for:

- API keys
- Tokens
- Passwords
- Private keys
- OAuth secrets
- Database credentials

If found, classify exposed production credentials as HIGH or CRITICAL depending on impact.

Do not reproduce secrets in the review output.

---

# Performance Review

## 33. Frontend

Check:

- Excessive renders
- Duplicate API calls
- Large bundles
- Unnecessary dependencies
- Large lists
- Missing lazy loading
- Expensive calculations
- Memory leaks

---

## 34. Backend

Check:

- N+1 queries
- Blocking operations
- Excessive synchronous work
- Large response payloads
- Missing pagination
- Unnecessary external API calls
- Missing caching where clearly needed
- Poor concurrency handling

---

## 35. Database

Check:

- Missing indexes
- Full collection scans
- Inefficient aggregation
- Unbounded queries
- Excessive document population
- Large payload retrieval
- Poor pagination

Only report performance issues when there is a credible impact.

---

# Testing Review

## 36. Test Coverage

Check whether the change includes appropriate tests.

Important areas:

- Happy path
- Validation
- Authentication
- Authorization
- Tenant isolation
- Error handling
- Edge cases
- Database behavior
- API behavior
- React behavior

For security-sensitive changes, tests should explicitly verify unauthorized scenarios.

---

## 37. Test Quality

Do not only count tests.

Check whether tests actually verify behavior.

Avoid tests that:

- Test implementation details unnecessarily.
- Mock everything.
- Never exercise real business logic.
- Are overly coupled to internal structure.
- Modify expectations merely to match a broken implementation.

Tests should fail when the important behavior regresses.

---

# Architecture Review

## 38. Separation of Concerns

Check that:

Frontend:

UI
  ↓
Hooks/application state
  ↓
API client

Backend:

Route
  ↓
Controller
  ↓
Service
  ↓
Repository
  ↓
MongoDB

The exact architecture may differ, but responsibilities should remain separated.

---

## 39. Coupling

Look for:

- Circular dependencies
- Services tightly coupled to HTTP
- Business logic tightly coupled to MongoDB
- React components tightly coupled to database/API implementation
- External integrations directly embedded into business logic

Prefer clear boundaries.

---

## 40. Abstractions

Do not reward abstraction for its own sake.

Ask:

- Does this abstraction solve a real problem?
- Does it improve testability?
- Does it isolate infrastructure?
- Does it reduce duplication?
- Does it make future change easier?

Avoid unnecessary:

- Factories
- Interfaces
- Base classes
- Generic wrappers
- Service layers
- Utility layers

when they do not provide meaningful value.

---

# Maintainability Review

## 41. Readability

Check:

- Naming
- Function size
- Module responsibility
- Duplication
- Comments
- Complexity

Prefer clear code over clever code.

Avoid comments that merely restate the code.

Prefer comments that explain:

- Why something is required.
- Why an unusual approach is used.
- Important business constraints.
- Non-obvious tradeoffs.

---

## 42. Duplication

Identify meaningful duplication.

Do not extract code merely because two blocks look similar.

Consider abstraction when:

- The behavior represents the same business concept.
- Changes must remain synchronized.
- Reuse is expected.
- Duplication creates meaningful maintenance risk.

---

## 43. Dead Code

Check for:

- Unused imports
- Unused variables
- Unreachable branches
- Deprecated implementations
- Old feature flags
- Commented-out code

Do not remove potentially used code without verifying references.

---

# Backward Compatibility

## 44. API Compatibility

Check whether the change modifies:

- Response fields
- Request fields
- Status codes
- Error formats
- Authentication requirements
- Permissions
- URL structure

Determine whether existing clients can continue to operate.

---

## 45. Database Compatibility

Check:

- Schema changes
- Required fields
- Existing documents
- Migration requirements
- Index changes
- Backward compatibility

MongoDB collections may contain older documents.

Do not assume every existing document matches the newest schema.

---

# Review Workflow

## 46. Standard Review Process

Follow this process:

### Step 1 — Understand

Read:

- Requirement
- Relevant files
- Existing architecture
- Similar implementations

### Step 2 — Inspect Changes

Run/inspect:

git status
git diff
git diff --stat

### Step 3 — Trace

Trace:

Frontend
  ↓
API
  ↓
Controller
  ↓
Service
  ↓
Repository
  ↓
MongoDB

where applicable.

### Step 4 — Security

Check:

Authentication
Authorization
Tenant isolation
Input validation
Secrets
Injection

### Step 5 — Correctness

Check:

Business logic
Edge cases
Error paths
Concurrency

### Step 6 — Performance

Check:

React rendering
API calls
Database queries
Indexes
Payload sizes

### Step 7 — Testing

Check:

Existing tests
New tests
Regression coverage

### Step 8 — Architecture

Check:

Boundaries
Coupling
Responsibility
Consistency

### Step 9 — Final Assessment

Summarize:

- Critical findings
- High findings
- Medium findings
- Low findings
- Positive observations
- Overall recommendation

---

# Review Output Format

Use this structure:

## Summary

Briefly explain what the change does.

## Findings

### CRITICAL

List only critical issues.

### HIGH

List high-impact issues.

### MEDIUM

List meaningful medium-impact issues.

### LOW

List low-impact issues worth mentioning.

## Positive Observations

Mention strong implementation choices when relevant.

## Recommendation

Choose one:

APPROVE

No blocking issues identified.

APPROVE WITH COMMENTS

No blocking issues, but improvements are recommended.

REQUEST CHANGES

One or more issues should be fixed before merging.

DO NOT APPROVE

Critical security, correctness, or architectural problems exist.

---

# Review Rules

## 47. Do Not Modify Code During Review

When asked to review code:

- Do not automatically modify files.
- Do not fix issues unless explicitly asked.
- First report findings.
- If asked to fix them, make targeted changes.

---

## 48. Do Not Over-Report

A high-quality review is not the one with the most comments.

Prioritize:

1. Security
2. Correctness
3. Tenant isolation
4. Data integrity
5. Production reliability
6. Performance
7. Maintainability
8. Style

Do not report trivial stylistic preferences as important findings.

---

## 49. Do Not Assume

Before reporting an issue:

- Verify the execution path.
- Inspect related code.
- Check middleware.
- Check types.
- Check configuration.
- Check tests.

If you cannot verify the issue, label it as a concern rather than a confirmed defect.

---

## 50. Final Review Checklist

Before completing a review, verify:

- [ ] Requirement understood
- [ ] Existing architecture inspected
- [ ] Git diff inspected
- [ ] Correctness reviewed
- [ ] Edge cases reviewed
- [ ] Authentication reviewed
- [ ] Authorization reviewed
- [ ] Multi-tenant isolation reviewed
- [ ] Input validation reviewed
- [ ] Output/data exposure reviewed
- [ ] MongoDB queries reviewed
- [ ] MongoDB indexes considered
- [ ] NoSQL injection reviewed
- [ ] Mass assignment reviewed
- [ ] React behavior reviewed
- [ ] TypeScript safety reviewed
- [ ] Async behavior reviewed
- [ ] Error handling reviewed
- [ ] External integrations reviewed
- [ ] Performance reviewed
- [ ] Tests reviewed
- [ ] Architecture reviewed
- [ ] Backward compatibility reviewed
- [ ] Secrets reviewed
- [ ] Findings prioritized by severity
- [ ] False positives avoided
- [ ] No unrelated style issues presented as blockers

---

# Final Principle

The purpose of code review is not to make the code look different.

The purpose is to ensure that the implementation is:

- Correct
- Secure
- Tenant-safe
- Maintainable
- Testable
- Performant
- Consistent with the existing architecture
- Ready for production

Prefer a small number of high-confidence, actionable findings over a large number of speculative or stylistic comments.
```
