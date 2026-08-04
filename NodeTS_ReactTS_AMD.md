# NodeTS + ReactTS Architecture & Modern Best Practices

## Purpose
This document captures modern, practical best practices for TypeScript-based Node.js backends and React frontends. It is intended as an architecture management document (AMD) that teams can use as a reference when building or evolving enterprise applications.

## Scope
- Node.js + TypeScript backend applications
- React + TypeScript frontend applications
- Shared conventions for API contracts, validation, testing, and developer experience

## Principles
- Strong typing and predictable boundaries
- Feature-first, modular organization
- Clear separation between API, business logic, and infrastructure
- Reusable shared services and UI components
- Secure, observable, and testable applications
- Incremental adoption and practical simplicity

## Recommended Stack
- Node.js 22+ / 24+ LTS
- TypeScript with `strict` mode enabled
- React 18/19 with function components and hooks
- Vite for frontend builds and local development
- Fastify or Express for backend APIs
- TanStack Query for server state management
- Zod or similar runtime schema validation
- React Hook Form for forms
- Tailwind CSS, CSS modules, or design system components
- ESLint, Prettier, Husky, and lint-staged
- Vitest + React Testing Library for frontend tests
- Jest/Mocha/Playwright for backend and integration tests

## Common Folder Structure
### Backend
```
src/
├── app/               # application bootstrap and providers
├── config/            # typed configuration and secrets management
├── modules/           # feature modules
│   ├── auth/
│   ├── users/
│   ├── reports/
│   └── connectors/
├── infrastructure/    # DB, external API clients, email, queue connect
├── shared/            # common utilities, types, errors
├── middleware/        # request handling and security middleware
├── routes/            # route registration and API versioning
└── server.ts
```

### Frontend
```
src/
├── app/               # providers, routing, layout routes
├── features/          # feature modules with pages, components, hooks
├── entities/          # shared domain models and mappers
├── widgets/           # reusable UI compositions and dashboard blocks
├── shared/            # reusable UI components, hooks, utilities
├── assets/
├── types/
└── main.tsx
```

## NodeTS Best Practices
### 1. Strong TypeScript Configuration
- Enable `strict`, `noImplicitAny`, `strictNullChecks`, `strictFunctionTypes`, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`, `useUnknownInCatchVariables`.
- Use `import type` for type-only imports.
- Prefer `ESM` build output when possible, or maintain a compatible CommonJS layer if required.
- Keep tsconfig settings centralized and shared across packages or services.

### 2. Feature-First and Layered Architecture
- Organize code by feature/domain, not by technical layer only.
- Within each feature, separate controllers/routes, services, repositories, schemas, and types.
- Keep controllers thin: validate, authorize, and delegate to services.
- Place business rules in service or domain layer, not in route handlers.
- Use repositories or adapters for persistence and external integrations.

### 3. Validation and Contracts
- Validate all inbound data with a runtime schema library such as Zod.
- Use the same schema definitions to derive TypeScript types where possible.
- Define request/response contracts near the feature they belong to.
- For public APIs, document contracts using OpenAPI / Swagger or generated schemas.

### 4. Error Handling and Observability
- Centralize error handling with middleware/handler layers.
- Distinguish between operational errors, validation failures, and developer exceptions.
- Return consistent error envelopes with status code, code, message, and optional details.
- Log structured events with metadata and correlation IDs.
- Include request IDs and trace context in logs.
- Expose health, readiness, and metrics endpoints.

### 5. Security and Stability
- Validate and sanitize all input.
- Use secure defaults for CORS, CSP, cookies, and HTTP headers.
- Protect endpoints with authentication and authorization middleware.
- Use rate limiting, request size limits, and JSON parse safety.
- Keep secrets out of source control and load them from environment variables or vaults.
- Avoid `any`, and do not disable TypeScript strictness broadly.

### 6. Dependency Management and Configuration
- Use a typed configuration layer for environment variables.
- Avoid global state and singletons where initialization order matters.
- Use dependency injection or explicit factories to wire infrastructure and services.
- Keep external clients isolated behind adapters or wrappers.

### 7. Testing Strategy
- Unit test controllers, services, repositories, and utility functions.
- Use integration tests for API routes and database interactions.
- Mock external services and keep integration tests deterministic.
- Validate schemas and runtime behavior with tests.
- Add contract tests for API consumers when applicable.

### 8. Observability and Ops
- Instrument operations with OpenTelemetry, Prometheus metrics, and structured logs.
- Emit logs at appropriate levels (debug, info, warn, error).
- Provide readiness and liveness probes for containers.
- Monitor error budgets, request latency, and queue/backpressure health.

## ReactTS Best Practices
### 1. Strong Typing and Type Safety
- Enable strict TypeScript settings in tsconfig.
- Use `as const` for literal objects and action values.
- Prefer explicit component props and type `children` when used.
- Avoid `any`; prefer `unknown` when a value is generic and then narrow it.
- Derive types from schemas, API contracts, and shared types.

### 2. Component Organization
- Use feature modules for groups of related functionality.
- Keep presentational components small and reusable.
- Keep page-level components focused on orchestration, not logic.
- Use a clear naming convention such as `FeatureNameComponent.tsx` or `FeatureNamePage.tsx`.

### 3. Data Fetching and State Management
- Use TanStack Query or React Query for server state.
- Use React Hook Form + Zod for form state and validation.
- Use local state (`useState`, `useReducer`) for UI-specific state.
- Use Context or Zustand only for state that truly spans many components.
- Avoid storing server cache in global state unless necessary.
- Keep data fetching hooks declarative and composable.

### 4. UI and Accessibility
- Build accessible components with proper labels, focus management, and keyboard support.
- Use a consistent design system or utility CSS strategy.
- Use semantic HTML and ARIA only when needed.
- Prefer layout-first responsive design with CSS grid and flexbox.

### 5. Performance
- Use route-based code splitting and lazy loading for large pages.
- Use memoization only when necessary, and prefer stable props.
- Virtualize large lists and tables.
- Keep bundle size manageable by tree-shaking dependencies.
- Avoid unnecessary re-renders through proper dependency arrays and stable callbacks.

### 6. Component Patterns
- Use custom hooks to encapsulate behaviour and side effects.
- Keep side effects in `useEffect`, `useMemo`, or dedicated hooks.
- Prefer single responsibility components.
- Use compound component patterns for reusable UI primitives.
- Avoid deeply nested prop drilling by using local composition or context.

### 7. Testing
- Use Vitest + React Testing Library for unit and component tests.
- Test hooks and UI behavior through user-focused assertions.
- Use MSW to mock network responses in tests.
- Use snapshot tests sparingly, focusing instead on semantics and behavior.

### 8. Tooling and Developer Experience
- Use ESLint, Prettier, and type-aware linting for consistent code style.
- Use path aliases for frequently used imports and keep them aligned with tsconfig.
- Maintain small, focused commits and feature branches.
- Use GitHub Actions or equivalent to run lint, type-check, and tests on every push.

## Shared Best Practices
### 1. API Contracts and Shared Types
- Keep type definitions aligned between backend and frontend.
- Use generated or shared DTOs where practical.
- Prefer explicit request/response DTOs and avoid leaking internal models.
- Document API schemas and use them for both validation and frontend consumption.

### 2. CI/CD and Quality Gates
- Run linting, formatting, and type checking in CI.
- Run unit and integration tests before merge.
- Enforce branch protections and code reviews.
- Use automated dependency updates with review.

### 3. Documentation and Architecture Decisions
- Document architectural decisions and conventions in a central file.
- Keep dependency and feature diagrams up to date.
- Use consistent naming conventions for features, hooks, services, and modules.

### 4. Incremental Adoption
- Apply these practices gradually during refactors.
- Start with strict typing, validation, and modular organization.
- Add observability and testing coverage over time.
- Keep the developer onboarding path simple and easy to follow.

## Implementation Tips
- Use the existing `Enterprise_NodeJS_MongoDB_Backend_Architecture_Guide.md` and `Enterprise_BI_Platform_Frontend_Architecture_Guide.md` as starting points.
- Standardize on Zod schemas for both backend validation and frontend form validation.
- Keep components and services small and reusable.
- Create shared folders for cross-cutting utilities and types.
- Use a consistent naming style for features, pages, hooks, and modules.

## Checklist for Modern NodeTS + ReactTS Projects
- [ ] Strong `strict` TypeScript settings enabled everywhere
- [ ] Feature-first folder structure in backend and frontend
- [ ] Runtime validation for all inbound API payloads
- [ ] Thin route/controller layer with business logic in services
- [ ] Server state managed by TanStack Query in React
- [ ] Reusable shared UI components and hooks
- [ ] Structured logging, health checks, and metrics in backend
- [ ] Automated tests for backend and frontend
- [ ] ESLint, Prettier, and CI validation enabled
- [ ] Shared API contracts between client and server
- [ ] Security guardrails for inputs, headers, auth, and rate limits
- [ ] Accessibility-first frontend components
- [ ] Incremental, documented adoption of best practices
