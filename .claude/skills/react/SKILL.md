# React Skill

```text
---
name: react
description: Build, review, refactor, test, and optimize production-grade React + TypeScript applications for the multi-tenant SaaS platform. Use this skill whenever implementing React components, pages, routing, forms, state management, API integration, authentication, authorization UI, tenant switching, data fetching, dashboards, tables, performance optimization, accessibility, testing, or frontend architecture.
---

# React Development Standards

## 1. Core Principles

Build React applications that are:

- Type-safe
- Componentized
- Accessible
- Testable
- Maintainable
- Performant
- Secure by design
- Consistent with the existing application architecture

Prioritize:

1. Correctness
2. Security
3. Accessibility
4. Maintainability
5. Performance
6. Developer convenience

Never use frontend behavior as the security boundary.

Backend authorization is always authoritative.

---

# 2. React Architecture

Prefer a clear separation:

React Component
  ↓
UI / View Logic
  ↓
Custom Hook
  ↓
API / Data Layer
  ↓
Node.js API
  ↓
MongoDB

For larger modules:

Feature
├── components/
├── hooks/
├── api/
├── types/
├── schemas/
├── utils/
└── pages/

The exact structure should follow the existing project.

Do not restructure an existing project unnecessarily.

---

# 3. Feature-Based Organization

For a SaaS application, prefer organizing larger features around business domains.

Example:

src/
├── features/
│   ├── auth/
│   ├── organizations/
│   ├── members/
│   ├── reports/
│   ├── dashboards/
│   ├── analytics/
│   ├── integrations/
│   └── billing/
├── components/
├── hooks/
├── services/
├── routes/
├── types/
├── utils/
└── app/

Avoid putting every component into one massive `components` directory.

---

# 4. Components

Components should have a clear responsibility.

Good:

UserTable
ReportCard
OrganizationSwitcher
InviteMemberDialog
DashboardChart

Avoid components such as:

ApplicationEverything
DashboardManager
GlobalPageComponent

containing hundreds or thousands of lines.

Split large components by meaningful responsibilities.

---

# 5. Component Responsibilities

A component may handle:

- Rendering
- Local UI state
- User interactions
- Calling hooks
- Displaying loading/error states

Avoid putting complex business logic directly into JSX.

Prefer:

Component
  ↓
Hook
  ↓
Service/API

---

# 6. JSX

Keep JSX readable.

Avoid deeply nested conditional expressions.

Bad:

return condition1
  ? condition2
    ? condition3
      ? <ComponentA />
      : <ComponentB />
    : <ComponentC />
  : <ComponentD />;

Prefer explicit conditions or extracted components.

---

# 7. Component Size

There is no universal line-count limit.

However, consider splitting a component when it contains multiple unrelated responsibilities such as:

- API calls
- Complex forms
- Table rendering
- Chart logic
- Modal state
- Navigation
- Permission logic

Split based on responsibility, not arbitrary line count.

---

# 8. Props

Keep props focused.

Good:

interface UserCardProps {
  user: User;
  onSelect: (userId: string) => void;
}

Avoid passing large unrelated objects when only a few properties are needed.

Prefer:

<UserCard
  name={user.name}
  role={user.role}
/>

when appropriate.

---

# 9. Prop Drilling

Do not introduce global state merely to avoid one or two levels of prop passing.

Use props when the data naturally belongs to the parent-child relationship.

Consider context/state management when:

- Many distant components require the same state.
- The state represents application-level context.
- Prop drilling becomes genuinely difficult to maintain.

---

# 10. State Ownership

State should live as close as possible to where it is needed.

Example:

Search input state
  ↓
Search component

Organization selection
  ↓
Application/organization context

User session
  ↓
Authentication state

Do not put all state into one global store.

---

# 11. Types

Use TypeScript types for:

- Props
- API responses
- API requests
- Form values
- Domain models
- State
- Events

Avoid `any`.

Bad:

const data: any = response.data;

Prefer:

const data: ReportResponse = response.data;

---

# 12. Avoid Duplicate Types

Do not create multiple incompatible definitions for the same API entity.

Avoid:

ReportA
ReportDTO
ReportModel
ReportData
ReportResponse

all representing the same concept without a meaningful distinction.

Create separate types only when their responsibilities genuinely differ.

---

# 13. API Types

Keep frontend API types aligned with backend contracts.

Example:

interface Report {
  id: string;
  name: string;
  status: ReportStatus;
  createdAt: string;
}

If the backend changes:

Report

to:

DashboardReport

update the frontend contract intentionally.

Do not silently use `any` to bypass API incompatibilities.

---

# 14. API Layer

Keep API calls outside UI components where practical.

Avoid:

function ReportPage() {
  useEffect(() => {
    fetch("/api/reports");
  }, []);
}

Prefer:

const reports = useReports();

with the API/data-fetching logic isolated.

This improves:

- Testing
- Reusability
- Maintainability
- Error handling

---

# 15. Custom Hooks

Use custom hooks for reusable stateful behavior.

Examples:

useAuth()
useCurrentOrganization()
useReports()
useMembers()
usePagination()
useDebouncedValue()

A hook should have a clear responsibility.

Avoid creating hooks that simply wrap one trivial line unless they provide meaningful abstraction.

---

# 16. Hooks Rules

Follow React Hooks rules strictly.

Hooks must:

- Be called at the top level.
- Not be called conditionally.
- Not be called inside loops.
- Not be called inside nested functions.

Bad:

if (isAuthenticated) {
  useReports();
}

Prefer:

const reports = useReports({
  enabled: isAuthenticated
});

when the underlying data library supports conditional fetching.

---

# 17. useEffect

Use `useEffect` for synchronization with external systems.

Examples:

- API requests when appropriate
- Browser APIs
- Event listeners
- Timers
- Subscriptions

Do not use `useEffect` for simple derived calculations.

Bad:

useEffect(() => {
  setTotal(price * quantity);
}, [price, quantity]);

Prefer:

const total = price * quantity;

---

# 18. useEffect Dependencies

Treat dependency arrays as correctness requirements.

Do not silence the exhaustive-deps rule simply to make an effect stop running.

If an effect runs too often:

1. Understand why.
2. Stabilize dependencies.
3. Refactor state.
4. Move logic if appropriate.

Do not use an empty dependency array as a universal solution.

---

# 19. Data Fetching

Use the application's established data-fetching solution.

For example:

- React Query/TanStack Query
- SWR
- Existing custom API hooks

Do not introduce another data-fetching library without a clear reason.

Data fetching should handle:

- Loading
- Success
- Error
- Retry
- Refetch
- Caching
- Stale data

where appropriate.

---

# 20. Loading States

Every asynchronous UI should consider:

- Initial loading
- Refreshing
- Empty state
- Error state
- Success state

Avoid showing a blank page while data is loading.

Use appropriate skeletons/spinners according to the application's UI system.

---

# 21. Error States

Errors should be understandable to users.

Bad:

Something went wrong.

when more useful context can safely be provided.

Good:

Unable to load reports. Please try again.

Do not expose:

- Stack traces
- MongoDB errors
- Internal server details
- Access tokens
- Secrets

---

# 22. Empty States

Differentiate:

Loading

from:

No data

from:

Error

Example:

Loading:
"Loading reports..."

Empty:
"No reports have been created yet."

Error:
"Unable to load reports."

Do not use an empty array to represent all three states.

---

# 23. Forms

Forms should have:

- Typed values
- Validation
- Error handling
- Submission state
- Accessible labels
- Disabled submission while appropriate
- Server-side validation support

Frontend validation improves UX.

Backend validation remains authoritative.

---

# 24. Form Validation

Validate before submission when appropriate.

Use the project's established validation library.

Common approach:

Schema
  ↓
Form
  ↓
Client validation
  ↓
API
  ↓
Server validation

Do not assume client validation guarantees data correctness.

---

# 25. Prevent Duplicate Submissions

For operations such as:

- Create organization
- Invite member
- Create report
- Submit payment

prevent accidental duplicate submissions.

Example:

<button disabled={isSubmitting}>

Use backend idempotency where duplicate requests can have serious consequences.

Frontend prevention alone is not enough.

---

# 26. Authentication UI

Authentication state should be centralized.

Conceptually:

AuthProvider
  ↓
Current User
  ↓
Session
  ↓
Protected Routes
  ↓
Application

Do not duplicate authentication checks across every component.

---

# 27. Protected Routes

Protected routes improve user experience.

Example:

<Route
  path="/reports"
  element={
    <RequireAuth>
      <ReportsPage />
    </RequireAuth>
  }
/>

However, protected routes are not the security boundary.

The backend must independently enforce authentication and authorization.

---

# 28. Authorization UI

Use permissions to control:

- Buttons
- Menus
- Pages
- Actions

Example:

<Can permission="reports:create">
  <CreateReportButton />
</Can>

This is a UX optimization.

The backend must still reject unauthorized requests.

---

# 29. Roles vs Permissions

Prefer permission-based UI checks when practical.

Instead of:

if (user.role === "admin")

prefer:

if (hasPermission("reports:delete"))

This avoids coupling UI behavior directly to role names.

Roles can map to permissions.

---

# 30. Multi-Tenant UI

The current organization should be explicit.

Example:

OrganizationSwitcher
  ↓
Current Organization
  ↓
Tenant-aware API calls
  ↓
Tenant-specific UI

The frontend must never assume the selected organization is authorized.

The backend must validate organization membership.

---

# 31. Organization Switching

When switching organizations:

1. Update current organization context.
2. Clear or invalidate tenant-specific cached data.
3. Refetch tenant-specific data.
4. Reset tenant-specific UI state where required.
5. Navigate appropriately.

Avoid displaying Organization A data after switching to Organization B.

This is both a correctness and security concern.

---

# 32. Tenant-Specific Cache

Cache keys must distinguish organizations.

Conceptually:

[
  "reports",
  organizationId
]

instead of:

[
  "reports"
]

This prevents cache collisions between tenants.

---

# 33. User Session

Avoid putting unnecessary sensitive information into browser state.

Do not store:

- Passwords
- Refresh tokens unnecessarily
- OAuth client secrets
- API secrets

Follow the application's established authentication architecture.

---

# 34. localStorage

Use localStorage carefully.

Suitable examples may include:

- Non-sensitive UI preferences
- Theme
- Selected non-sensitive settings

Do not use localStorage as the authoritative source for:

- Permissions
- Organization membership
- Security decisions

The backend remains authoritative.

---

# 35. API Authentication

API authentication should be handled consistently.

Prefer a centralized API client/interceptor layer where appropriate.

Avoid manually adding authentication logic in every component.

---

# 36. HTTP 401 Handling

When an API returns 401:

Follow the application's authentication strategy.

Potential flow:

Request
  ↓
401
  ↓
Refresh authentication
  ↓
Retry request
  ↓
If refresh fails → logout

Do not create multiple independent refresh mechanisms.

Avoid refresh loops.

---

# 37. HTTP 403 Handling

403 means the user is authenticated but does not have permission.

UI should handle this appropriately.

Examples:

- Hide unavailable action
- Show access denied
- Redirect where appropriate

Do not interpret every 403 as a logout condition.

---

# 38. API Error Handling

Centralize common API error handling.

The UI should be able to distinguish:

400
401
403
404
409
422
500
503

where appropriate.

Do not duplicate response parsing across every component.

---

# 39. Routing

Use a clear route structure.

Example:

/login
/signup
/organizations
/organizations/:organizationId
/organizations/:organizationId/reports
/organizations/:organizationId/settings

The exact structure should follow the product's requirements.

Do not expose internal IDs unnecessarily when a safe slug/identifier is more appropriate.

---

# 40. Route Parameters

Route parameters are user-controlled input.

Never treat:

/organizations/:organizationId

as proof of authorization.

The backend must validate membership.

---

# 41. URL State

Use URL parameters/query parameters for state that should be:

- Shareable
- Bookmarkable
- Browser-navigation-friendly

Examples:

?status=active
?sort=createdAt
?page=2

Do not duplicate the same state unnecessarily in multiple places.

---

# 42. Tables

For large SaaS datasets:

Prefer:

- Server-side pagination
- Server-side sorting
- Server-side filtering
- Virtualized rows
- Debounced search

Do not load millions of records into React.

---

# 43. Debounced Search

For search fields that trigger APIs:

Use debouncing when appropriate.

Example:

User types:

rep
repor
report
reports

Instead of sending four requests immediately, wait for the user to pause.

Choose a reasonable debounce interval based on UX.

Do not debounce actions that must be immediate.

---

# 44. Search Cancellation

When users type quickly, previous requests may become stale.

Use appropriate cancellation or request-management behavior.

Do not allow an older response to overwrite a newer search result.

---

# 45. Pagination UI

Pagination should clearly represent:

- Current page/cursor
- Loading state
- Total/next availability when known
- Empty results

Avoid calculating total counts unnecessarily if the backend can efficiently provide cursor-based pagination.

---

# 46. Large Dashboards

Dashboards should avoid:

- Fetching every dataset immediately
- Rendering every chart simultaneously
- Loading unnecessary components
- Sending huge raw datasets

Consider:

- Lazy loading
- Parallel API requests
- Aggregated backend endpoints
- Caching
- Chart-level loading states

---

# 47. Chart Data

Prefer server-side aggregation.

Instead of sending:

10 million events

to React and calculating:

daily totals

send:

[
  { date: "...", count: 123 },
  ...
]

This reduces:

- Network payload
- Browser memory
- CPU
- Rendering work

---

# 48. Component Memoization

Use:

React.memo
useMemo
useCallback

only when they provide a measurable or clear architectural benefit.

Do not blindly memoize every component.

Memoization adds complexity and can itself have overhead.

---

# 49. React Context

Context is useful for:

- Authentication
- Current organization
- Theme
- Application configuration

Avoid putting frequently changing large datasets into a global context.

Large context updates can cause broad rerenders.

---

# 50. State Management

Use local state when possible.

Use global state for truly shared state.

Use server-state tools for server data.

Do not put:

API response data
forms
temporary UI state
authentication
tenant context

all into one global store.

Separate concerns.

---

# 51. Server State vs UI State

Distinguish:

### Server state

- Reports
- Users
- Organizations
- Dashboard data
- Integrations

### UI state

- Modal open/closed
- Selected tab
- Form input
- Sidebar state

Use appropriate tools for each.

---

# 52. Avoid Derived State

Avoid storing values that can be calculated from existing state.

Bad:

const [users, setUsers] = useState([]);
const [activeUsers, setActiveUsers] = useState([]);

Prefer:

const activeUsers = users.filter(
  user => user.status === "active"
);

unless the calculation is genuinely expensive and requires memoization.

---

# 53. Keys

Use stable unique keys.

Prefer:

key={user.id}

Avoid:

key={index}

for dynamic lists.

---

# 54. Accessibility

Every UI feature should consider accessibility.

Use:

- Semantic HTML
- Labels
- Keyboard navigation
- Focus management
- ARIA only where necessary
- Sufficient contrast
- Accessible error messages

Do not rely solely on color to communicate state.

---

# 55. Buttons

Use:

<button>

for actions.

Do not use:

<div onClick={...}>

as a replacement for buttons.

This improves:

- Keyboard accessibility
- Semantics
- Screen reader behavior

---

# 56. Forms Accessibility

Inputs should have accessible labels.

Prefer:

<label htmlFor="email">
  Email
</label>

<input id="email" />

Error messages should be associated with their inputs where appropriate.

---

# 57. Loading Accessibility

Loading states should be understandable to assistive technologies where appropriate.

Do not rely only on visual spinners.

---

# 58. Error Accessibility

Form errors should:

- Be visible
- Be understandable
- Be associated with the relevant input
- Not rely only on color

---

# 59. Styling

Follow the project's existing styling system.

Possible systems:

- CSS
- SCSS
- CSS Modules
- Tailwind
- Styled Components
- Component libraries

Do not introduce a new styling system without a strong reason.

---

# 60. Avoid Inline Style Explosion

Avoid large inline style objects throughout JSX when the project has an established styling system.

Prefer reusable styles/components where appropriate.

---

# 61. Design System

Reuse existing:

- Buttons
- Inputs
- Modals
- Tables
- Cards
- Alerts
- Typography
- Spacing

Do not recreate common UI components repeatedly.

---

# 62. UI Consistency

A new feature should follow existing:

- Colors
- Typography
- Spacing
- Form behavior
- Error messages
- Loading states
- Modal behavior

Do not introduce a completely different visual language for one feature.

---

# 63. React Security

Never assume React escaping protects against every form of injection.

Be particularly careful with:

dangerouslySetInnerHTML

Avoid it unless necessary.

If HTML must be rendered:

- Sanitize it.
- Validate its source.
- Restrict allowed content.

Never render raw user-generated HTML blindly.

---

# 64. URL Handling

Do not blindly inject user-controlled URLs into:

- href
- src
- iframe
- redirects

Validate allowed protocols and destinations where appropriate.

Be especially careful with:

javascript:

data:

and untrusted redirects.

---

# 65. Sensitive Data

Do not expose server-only secrets in React.

Anything bundled into frontend code can potentially be inspected by users.

Never place:

- Database credentials
- API secrets
- OAuth client secrets
- Private keys

in frontend environment variables.

---

# 66. Environment Variables

Only expose environment variables intended for the browser.

Follow the project's framework-specific convention.

Remember:

Frontend environment variables are not secret.

They become part of the client application.

---

# 67. Testing

Test:

- Components
- Hooks
- Forms
- API interactions
- Authentication behavior
- Authorization UI
- Tenant switching
- Error states
- Loading states
- Accessibility

Use the testing framework already established by the project.

---

# 68. Component Tests

Test behavior rather than implementation details.

Prefer:

"Clicking Save submits the form."

over:

"setState was called once."

Tests should remain valid after internal refactoring.

---

# 69. User-Focused Tests

Examples:

- User can create a report.
- User sees validation error for invalid input.
- Viewer cannot see delete action.
- User can switch organizations.
- Organization switch clears tenant-specific data.
- API 401 triggers appropriate authentication behavior.
- API 403 shows access denied.

---

# 70. API Mocking

For frontend tests, mock backend APIs.

Do not depend on real production APIs.

Mock:

- Success
- Validation errors
- Unauthorized
- Forbidden
- Not found
- Server errors
- Slow responses

---

# 71. Performance Testing

Use React profiling when investigating rendering issues.

Measure:

- Render duration
- Commit duration
- Number of renders
- Expensive components
- Large lists

Do not add memoization without understanding the rendering behavior.

---

# 72. Error Boundaries

Use error boundaries around appropriate application areas.

An error boundary can prevent one component failure from crashing the entire UI.

Consider boundaries around:

- Dashboard modules
- Large feature areas
- Application root

Do not use error boundaries as a replacement for normal API error handling.

---

# 73. Lazy Loading

Use lazy loading for:

- Large routes
- Admin areas
- Heavy analytics modules
- Large charting functionality

Avoid excessive fragmentation.

---

# 74. Suspense

Use Suspense according to the application's React/data-fetching architecture.

Do not introduce Suspense-based data loading patterns simply because they are available.

Follow the project's established React version and libraries.

---

# 75. React Strict Mode

Use React Strict Mode when supported by the application.

Understand that development behavior can expose:

- Unsafe effects
- Side effects
- Unexpected assumptions

Do not disable Strict Mode merely to hide development issues.

---

# 76. React Development Workflow

Before implementing a feature:

1. Understand the existing architecture.
2. Find similar components.
3. Reuse existing UI components.
4. Identify API contracts.
5. Identify authorization requirements.
6. Identify tenant context.
7. Define loading/error/empty states.
8. Implement.
9. Test.
10. Review accessibility.
11. Review performance.

---

# 77. React Code Review

When reviewing React code, check:

### Architecture

- [ ] Component responsibility is clear
- [ ] Business logic is not unnecessarily in JSX
- [ ] API calls are appropriately isolated
- [ ] Hooks are reusable where appropriate

### State

- [ ] State ownership is correct
- [ ] Duplicate state avoided
- [ ] Server state separated from UI state
- [ ] Context is not overused

### Performance

- [ ] Duplicate requests avoided
- [ ] Unnecessary rerenders considered
- [ ] Large lists handled appropriately
- [ ] Bundle impact considered
- [ ] Expensive calculations considered

### Security

- [ ] Backend authorization is not replaced by frontend checks
- [ ] Tenant switching is safe
- [ ] Sensitive data is not exposed
- [ ] Unsafe HTML is avoided

### UX

- [ ] Loading state
- [ ] Empty state
- [ ] Error state
- [ ] Success state
- [ ] Disabled submission state

### Accessibility

- [ ] Semantic HTML
- [ ] Keyboard navigation
- [ ] Labels
- [ ] Focus management
- [ ] Accessible errors

---

# 78. Common Anti-Patterns

Avoid:

### Massive Components

One component contains the entire feature.

### API Calls Everywhere

Every component directly calls fetch/axios.

### Global Everything

Every piece of state is stored globally.

### Excessive useEffect

Effects are used for ordinary calculations.

### Blind Memoization

Every function uses useCallback.

Every value uses useMemo.

Every component uses React.memo.

### Frontend Authorization Only

Buttons are hidden but backend APIs remain accessible.

### Client Tenant Trust

The frontend-selected organization is assumed to be authorized.

### Unbounded Lists

Thousands or millions of records rendered at once.

### Duplicate State

The same data exists in multiple state locations.

---

# 79. React Performance Checklist

- [ ] No unnecessary API calls
- [ ] No obvious request waterfalls
- [ ] Large lists paginated/virtualized
- [ ] Expensive calculations measured
- [ ] Memoization used intentionally
- [ ] Large components reviewed
- [ ] Bundle size considered
- [ ] Lazy loading used where beneficial
- [ ] Images optimized
- [ ] Tenant-specific caches are isolated
- [ ] Organization switching invalidates appropriate state
- [ ] Server-side aggregation used for large datasets

---

# 80. React Security Checklist

- [ ] Authentication state handled centrally
- [ ] Backend authorization remains authoritative
- [ ] Tenant context is not blindly trusted
- [ ] Sensitive data is not stored unnecessarily
- [ ] Server secrets are never exposed
- [ ] dangerouslySetInnerHTML avoided or sanitized
- [ ] Untrusted URLs validated
- [ ] API errors do not expose sensitive information
- [ ] Organization switching is validated by backend
- [ ] Tenant-specific cache/state cannot leak between organizations

---

# 81. React Production Checklist

Before completing a React feature:

- [ ] TypeScript passes
- [ ] Lint passes
- [ ] Tests pass
- [ ] Production build passes
- [ ] Loading state implemented
- [ ] Empty state implemented
- [ ] Error state implemented
- [ ] Form validation implemented where needed
- [ ] API errors handled
- [ ] Authentication behavior verified
- [ ] Authorization behavior verified
- [ ] Tenant isolation behavior verified
- [ ] Accessibility reviewed
- [ ] Responsive behavior reviewed
- [ ] Performance reviewed
- [ ] No debug logs
- [ ] No secrets
- [ ] Existing design system reused
- [ ] No unnecessary dependencies added

---

# 82. Final React Principles

For every React feature, ask:

1. Is the component responsible for one clear concern?
2. Is state stored at the correct level?
3. Is server state separated from UI state?
4. Are API calls isolated appropriately?
5. Are loading, empty, and error states handled?
6. Is the UI accessible?
7. Is backend authorization still authoritative?
8. Is tenant switching safe?
9. Is tenant-specific state/cache isolated?
10. Are unnecessary renders avoided?
11. Are large datasets handled server-side?
12. Is the implementation consistent with the existing application?
13. Is the solution simple enough to maintain?

The most important rule is:

**React is responsible for user experience, not security enforcement.**

The frontend may hide unavailable actions and guide users through valid workflows, but the Node.js backend must independently enforce:

- Authentication
- Authorization
- Tenant isolation
- Data validation
- Resource ownership

A React implementation is production-ready only when the UI, API contract, security model, accessibility, error handling, and performance behavior work together correctly.
```
