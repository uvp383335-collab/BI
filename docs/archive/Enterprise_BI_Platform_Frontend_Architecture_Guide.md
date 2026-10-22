Enterprise BI Platform Frontend Architecture Guide

Purpose
This document defines a modern, scalable React architecture for enterprise Business Intelligence (BI) platforms. It is intended to serve as the architectural foundation for both developers and AI coding assistants.

1. Architecture Principles

Feature-first architecture.

Clean separation of concerns.

Strong TypeScript typing.

Reusable shared UI and infrastructure.

Business logic isolated from presentation.

Scalable, testable, AI-friendly design.

2. Recommended Technology Stack

React 19

TypeScript

Vite

React Router v7

TanStack Query

React Hook Form

Zod

Axios

Tailwind CSS or Enterprise Design System

Vitest + React Testing Library

ESLint, Prettier, Husky

3. High-Level Architecture

App Layer – bootstrap, providers, routing.

Feature Layer – business capabilities.

Entity Layer – shared business models.

Widget Layer – dashboard compositions.

Shared Layer – reusable infrastructure.

Infrastructure Layer – API client, configuration and integrations.

4. Recommended Folder Structure

src/
├── app/
├── features/
│   ├── auth/
│   ├── dashboard/
│   ├── reports/
│   ├── connectors/
│   ├── datasets/
│   ├── charts/
│   ├── ai/
│   ├── workspaces/
│   ├── users/
│   ├── settings/
│   └── notifications/
├── entities/
├── widgets/
├── shared/
├── pages/
└── main.tsx

5. Feature Module Template

features/dashboard/
├── api/
├── components/
├── hooks/
├── pages/
├── schemas/
├── services/
├── types/
├── utils/
├── tests/
└── index.ts

6. Entity Layer

Dashboard

Chart

Dataset

Connector

Pipeline

Report

Workspace

User

Organization

Metric

Filter

7. Widget Layer

DashboardHeader

KPIGrid

ChartGrid

FilterPanel

RecentActivity

Sidebar

ReportBuilder

ConnectionStatus

8. API Architecture

Component → Hook → Service → API Client → Backend.

Never call HTTP client directly from UI.

Centralize authentication, retries, interceptors and error normalization.

9. State Management

Local UI: useState/useReducer.

Server state: TanStack Query.

Global state: Context/Zustand only for shared application state.

10. Connector Architecture

Each external platform lives in its own feature.

Example connectors: HubSpot, Salesforce, Dynamics, QuickBooks, Google Analytics.

Connector implementations remain isolated.

11. Dashboard & Visualization

Widgets compose dashboards.

Charts are feature modules.

Support reusable visualizations and filter synchronization.

12. AI Module

Keep AI prompts, services, APIs and components in a dedicated feature.

Do not mix AI logic with dashboard presentation.

13. Authentication & Authorization

Dedicated authentication provider.

Protected routes.

Role-based UI.

Backend remains source of truth.

14. Performance

Lazy loading.

Code splitting.

Caching.

Virtualized tables.

Optimized charts.

Memoization where beneficial.

15. Testing

Unit, component, integration and end-to-end testing.

16. AI Coding Standards

Feature-first organization.

No API calls from components.

Business logic in hooks/services.

Reuse shared modules.

Document public APIs.

Follow naming conventions consistently.

17. Future Scalability

Plugin-based connector system.

Multi-tenancy/workspaces.

Audit logging.

Real-time updates.

Internationalization.

Feature flags.

Conclusion

This architecture is designed specifically for enterprise BI platforms. It supports modular growth, multiple third-party integrations, dashboard composition, analytics, AI-assisted features, and long-term maintainability while providing a consistent structure for AI coding assistants.