# driverinsights

Enterprise BI platform: multi-tenant SaaS that connects a customer's CRM/finance
providers (HubSpot implemented; Salesforce and QuickBooks planned) and surfaces
synced data as dashboards.

- `backend/` — Node 22 + TypeScript + Express 5 + Mongoose 8 + Zod 4, JWT auth,
  BullMQ/Redis, Pino logging. Feature modules under `backend/src/modules/`
  (`auth`, `organizations`, `users`, `invitations`, `verification`,
  `integrations`, `sync`), each split into `controller/service/repository/model/
  dto/validator/routes`. Each organization has its own tenant MongoDB database.
- `frontend/` — React 19 + TypeScript + Vite + TanStack Query + React Hook Form
  + Zod + Tailwind 4. Feature-first layout under `frontend/src/`
  (`app/`, `features/`, `entities/`, `widgets/`, `shared/`, `pages/`).

## Standards

Coding standards live in `.claude/skills/` and load automatically by topic —
don't restate them here. Relevant ones: `architecture`, `api-design`, `react`,
`nodejs`, `mongodb`, `multi-tenancy`, `security`, `performance`, `testing`,
`database-review`, `code-review`, `git-pr`, `crm-integrations`.

`crm-integrations` specifically documents the HubSpot implementation and the
shared plumbing (tenant-per-database model resolution, the cross-tenant
`ProviderConnectionIndex` collision check, signed OAuth state, sync job
progress tracking) that Salesforce/QuickBooks must follow when they're built.

The original standalone architecture guides this project started from are
archived at `docs/archive/` for historical reference — they've been superseded
by the more detailed, project-grounded `.claude/skills/` and should not be
treated as current.
