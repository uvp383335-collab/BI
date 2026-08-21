---
name: crm-integrations
description: Provider-specific implementation details for third-party CRM/finance integrations (HubSpot, Salesforce, QuickBooks) in this multi-tenant SaaS app — OAuth flows, token refresh, rate limits, pagination, sync jobs, and data models. Use this skill whenever implementing or modifying an integrations/* or sync/* module, adding a new provider, or debugging a provider connection/sync issue. For generic integration architecture (module isolation, tenant scoping, retries, webhook verification) see the architecture, multi-tenancy, nodejs, and security skills instead — this skill only documents what differs per provider and the shared plumbing those generic skills don't know about.
---

# CRM/Finance Integration Standards

## 1. Scope of This Skill

This application connects one org to (eventually) three external providers:

```
hubspot     - implemented
salesforce  - planned, stubbed as "coming soon"
quickbooks  - planned, stubbed as "coming soon"
```

Do not duplicate the generic guidance already covered elsewhere:

- Module isolation, controller/service/repository layering → `architecture`, `nodejs`
- Tenant-scoped credentials, OAuth security, secrets → `multi-tenancy`, `security`
- Timeouts, retries, background jobs, queue design → `nodejs`, `performance`
- MongoDB modeling/indexes → `mongodb`, `database-review`

This skill exists only for the parts that are genuinely provider-specific or specific to how *this codebase* wires providers together. When adding Salesforce or QuickBooks, add a new `## Provider: X` section below following the HubSpot section as the template — do not create a separate skill file per provider.

---

## 2. Shared Plumbing (applies to every provider)

These conventions live in `backend/src/modules/integrations/` and `backend/src/modules/sync/` and are already implemented for HubSpot. Any new provider must fit into the same shape.

### 2.1 Provider registration

`integrations.service.ts` keeps two lists:

```ts
SUPPORTED_PROVIDERS = ['hubspot', 'salesforce', 'quickbooks']
IMPLEMENTED_PROVIDERS = ['hubspot']
```

A provider can be "known" (shows as a tile, reports `comingSoon: true` from `getStatus`) before it is "implemented" (`assertImplemented` throws `PROVIDER_NOT_IMPLEMENTED` otherwise). When you implement a new provider, move it from `SUPPORTED_PROVIDERS`-only into `IMPLEMENTED_PROVIDERS` and wire it into every `if (provider === '...')` branch in `integrations.service.ts` (`getAuthorizationUrl`, `handleCallback`, `getValidAccessToken`).

### 2.2 Tenant-per-database model

This app gives each organization its own tenant MongoDB database (see `database/tenantConnection.ts`). Consequences specific to integrations:

- `Integration` (the document holding tokens) is a **tenant-scoped model**, compiled per `Connection` via `getIntegrationModel(connection)` with a `WeakMap<Connection, Model>` cache (`integrations/model/Integration.model.ts`). Never `import { IntegrationModel }` directly — always resolve it through the tenant connection, same as other tenant-scoped models.
- `Contact` and `Deal` (`sync/model/Contact.model.ts`, `sync/model/Deal.model.ts`) follow the exact same pattern — `getContactModel(connection)` / `getDealModel(connection)`, each with their own `WeakMap<Connection, Model>` cache. They live in the org's tenant database, **not** a shared collection, specifically so that contacts/deals synced from multiple providers (HubSpot today, Salesforce/QuickBooks later) land in one unified per-org pool: every doc carries `provider` + `providerRecordId` (the provider's raw record id — generic name, not `hubspotId`) instead of the pool being partitioned by provider. A repository's `bulkUpsert`/`count`/etc. must resolve the model via `getTenantConnection(orgId)` first (see `sync/repository/contact.repository.ts` / `deal.repository.ts`) — never import a bare `ContactModel`/`DealModel`.
- Because tenant databases can't be queried cross-database, there is a separate **control-plane collection**, `ProviderConnectionIndex` (`integrations/model/ProviderConnectionIndex.model.ts`), living on the default connection. It maps `{ provider, externalAccountId } → orgId` with a unique index, purely to detect "this HubSpot account is already connected to a different org" without touching another tenant's tokens. It stores no secrets — only the external account id/label and the owning org.
- **An org is permanently locked to the first external account it connects, per provider.** Switching a connected HubSpot account for a different one within the same org is not supported by design — `Contact`/`Deal` rows carry no per-account marker (only `provider`), so allowing a swap would silently mix two different accounts' data in the tenant DB. `disconnect()` deliberately does **not** delete the `ProviderConnectionIndex` entry (only the `Integration`/tokens), so the claim survives disconnect and a reconnect of a *different* account for the same org+provider is rejected. The escape hatch is creating a new organization, not switching accounts in place. When adding a new provider, replicate the `assertHubSpotAccountUsable` pattern (`integrations.service.ts`): look up by `{ provider, externalAccountId }` for the cross-org check ("same org" allow / "different org, user is a member" `{PROVIDER}_ALREADY_CONNECTED_SWITCH` / "different org, user is not a member" `{PROVIDER}_ALREADY_CONNECTED_REQUEST_ACCESS`, no org details leaked), **and** by `{ provider, orgId }` for the same-org lock (`{PROVIDER}_ORG_LOCKED_TO_ACCOUNT` if it resolves to a different external account id than the one being connected).

### 2.3 OAuth state

`signIntegrationState` / `verifyIntegrationState` (`shared/utils/jwt.ts`) sign a JWT carrying `{ userId, orgId, provider }` as the OAuth `state` param. This is what lets the callback (which arrives unauthenticated — the provider redirects the user's browser directly) recover *which* org/user initiated the connection. Every new provider's authorize step must go through `signIntegrationState`, and its callback must call `verifyIntegrationState` and check `payload.provider !== provider` before proceeding (protects against state reuse across providers).

### 2.4 Token lifecycle

`getValidAccessToken(orgId, provider)` is the single choke point every downstream call (sync, analytics) goes through. It checks `integration.expiresAt` and lazily refreshes if expired, persisting the new token via `integrationsRepository.updateAccessToken`. New providers must implement a `refreshAccessToken` following the same signature shape (`{ accessToken, expiresIn }`) and add a branch here — do not have callers refresh tokens themselves.

### 2.5 Sync jobs

`SyncJob` (`sync/model/SyncJob.model.ts`) tracks one background sync per `(orgId, provider)` with `status`, `progress` (0-100), `currentStep`, and per-entity progress (`entities.contacts`, `entities.deals`). `syncService.startSync` refuses to start a second concurrent job for the same org/provider (`findActiveByOrgAndProvider`) and is fire-and-forget from the OAuth callback — sync failures are persisted onto the job document, not surfaced through the redirect. A new provider's sync should follow the same do/while `after`-cursor pagination loop, bulk-upsert per page (`bulkUpsert(orgId, provider, records)`), and update `entities.<name>` progress after each page — see `syncContacts`/`syncDeals` in `sync/service/sync.service.ts` as the template. If the new provider syncs different entity types, extend `SyncJobDocument.entities` rather than overloading `contacts`/`deals`.

### 2.6 Error codes

Provider errors use a `{PROVIDER}_{ACTION}_FAILED` convention (`HUBSPOT_TOKEN_EXCHANGE_FAILED`, `HUBSPOT_CONTACTS_FETCH_FAILED`, etc.) via `AppError`. Keep new providers consistent with this so the frontend/logs can pattern-match on the prefix.

### 2.7 Known gap — no retry/backoff yet

None of the current HubSpot `axios` calls have retry, backoff, or rate-limit (429) handling — a failure just throws a generic `AppError.badRequest`. The `nodejs` and `performance` skills' guidance on retries/backoff for external APIs applies but is **not yet implemented** here. Don't assume it exists; if you touch this code and hit rate-limit issues, that's the place to add it (and consider adding it for all providers at once rather than per-provider).

---

## 3. Provider: HubSpot (implemented)

Files: `backend/src/modules/integrations/service/hubspot.service.ts`, `integrations.service.ts` (the `hubspot` branches), `backend/src/modules/sync/service/sync.service.ts`.

### OAuth

- Authorize: `https://app.hubspot.com/oauth/authorize` with `client_id`, `redirect_uri`, `scope`, `state`.
- Token exchange/refresh: `POST https://api.hubapi.com/oauth/v1/token`, form-encoded (`application/x-www-form-urlencoded`), `grant_type=authorization_code` or `refresh_token`.
- Token info (for display only — hub id/domain/scopes): `GET https://api.hubapi.com/oauth/v1/access-tokens/{accessToken}`. This call is non-critical: a failure returns `null` and the connection still succeeds without display metadata.
- Env vars: `HUBSPOT_CLIENT_ID`, `HUBSPOT_CLIENT_SECRET`, `HUBSPOT_REDIRECT_URI` (default `http://localhost:4000/api/v1/integrations/hubspot/callback`), plus `FRONTEND_URL` (default `http://localhost:5173`) used to build post-callback redirects.
- Scopes actually requested — deliberately narrow, don't expand without reason: `oauth`, `crm.objects.contacts.read`, `crm.objects.contacts.write`, `crm.objects.deals.read`, `crm.objects.deals.write`. (Write scopes were added when the funnel-chart work needed `hubspot_owner_id`/lifecycle-stage/dealstage writes during test-data seeding — see `HUBSPOT_SCOPES` in `hubspot.service.ts` for the live list.)

### Data pulled

Only two object types, and only the properties the dashboard needs — do not widen these without a concrete UI need, per the "narrow sync" comments in the code:

- **Contacts** (`GET /crm/v3/objects/contacts`): `email`, `firstname`, `lastname`, `lifecyclestage`, `hs_lead_status`, plus `propertiesWithHistory=lifecyclestage` to capture the stage-change timeline (`lifecycleStageHistory` on `Contact`) that feeds the lead funnel.
- **Deals** (`GET /crm/v3/objects/deals`): `dealname`, `amount`, `closedate`, `pipeline`, `dealstage`, `hubspot_owner_id`, plus `propertiesWithHistory=dealstage` to capture the stage-change timeline (`dealStageHistory`) that feeds the deal funnel. No other object's history is synced.
- **Deal↔Contact associations** (`POST /crm/v4/associations/deals/contacts/batch/read`, one batched call per synced page via `getDealContactAssociations`): populates `Deal.contactIds`, the only cross-object link this app stores — powers the lead-to-deal conversion funnel. Nothing else reads or writes associations.

### Pagination

Cursor-based via `paging.next.after`; page size `100` for direct HubSpot calls, `PAGE_SIZE = 50` used by the sync loop. Loop pattern: `do { fetch(after) ... after = response.paging?.next?.after } while (after)`.

### Incremental sync

`Integration.lastSyncedAt` (set by `integrationsRepository.updateLastSyncedAt`, read via `findByOrgAndProvider`) drives whether a sync is full or incremental. `sync.service.ts`'s `executeSyncJob` captures `syncStartedAt = new Date()` **before** fetching anything and persists that (not the completion time) as the new `lastSyncedAt` on success — using the start time avoids a gap for records changed while the sync itself was running.

- **First sync** (`lastSyncedAt` is null): `since` is `undefined`, `HubSpotService.getContacts`/`getDeals` use the plain list endpoints exactly as before (full portal, `propertiesWithHistory=dealstage` included directly).
- **Re-sync** (`lastSyncedAt` set): `since` is passed through, and both methods switch to HubSpot's **Search API** (`POST /crm/v3/objects/{contacts,deals}/search`) filtered `{propertyName: 'lastmodifieddate' | 'hs_lastmodifieddate', operator: 'GTE', value: since.getTime()}`, sorted ascending on that same property, paginated the same `after`-cursor way. Only contacts/deals created or modified since the last successful sync come back.
- **Search API can't return `propertiesWithHistory`** — this is a real HubSpot API limitation, not an oversight. So on an incremental sync, `syncDeals` gets deals without `dealStageHistory` from the search call, then makes one follow-up `HubSpotService.getDealStageHistory(accessToken, dealId)` call (`GET /crm/v3/objects/deals/{id}?propertiesWithHistory=dealstage`) **per deal returned in that page** to backfill full history. This is bounded to changed deals only, not the whole portal — acceptable N+1 given [no retry/backoff exists yet](#27-known-gap--no-retrybackoff-yet) and incremental pages are expected to be small. If you see this becoming a bottleneck, batch/parallelize with care around HubSpot's rate limits rather than removing the backfill (skipping it would silently wipe `dealStageHistory` back to empty on every re-sync, since the search result's `propertiesWithHistory` is always absent).
- If a new provider's API doesn't support an equivalent "modified since" filter, don't force the pattern — a provider-specific incremental strategy note belongs in that provider's own section instead.
- **Force resync**: `POST /sync/:provider/start?force=true` ignores `lastSyncedAt` and re-runs a full sync. Needed the first time a new synced field ships (e.g. `contactIds`, `lifecycleStageHistory`) — an incremental sync will never backfill a new field onto a record that hasn't changed on the HubSpot side, so a one-time forced full resync is the standard way to backfill already-synced data after a schema change.

### Funnel data model (FunnelStageEvent / PipelineStageDefinition)

Funnels are rendered **per-provider**, never mapped onto a shared canonical stage enum — Salesforce clients customize stage names, so a fixed cross-CRM bucket would be lossy. Two normalized, per-tenant collections back every funnel chart:

- **`FunnelStageEvent`** — one row per stage-entry event (`entityType: 'lead'|'deal'`, `providerRecordId`, `pipeline`, `rawStage`, `enteredAt`), built at sync time from `Contact.lifecycleStageHistory` / `Deal.dealStageHistory`. Flattened specifically so a chart can `$group`/count across records without unwinding two differently-shaped embedded arrays per entity type.
- **`PipelineStageDefinition`** — one row per `(provider, entityType, pipeline, rawStage)` holding `label`/`displayOrder`/`isClosed`/`isWon`, refreshed every sync from HubSpot's own Pipelines API (deals) and the `lifecyclestage` property's options (leads — HubSpot has no separate pipeline object for contacts, so a fixed synthetic pipeline id `contacts-default`/`CONTACTS_PIPELINE` is used instead). Never hardcode stage order/labels — always resolve them from this table, since a client can rename/reorder their pipeline at any time.

`funnelService.getFunnels(orgId, provider, {pipeline?})` (`sync/service/funnel.service.ts`) is the single read path: aggregates `FunnelStageEvent` membership counts per stage, joins against `PipelineStageDefinition` for order/labels, and separately derives the lead→deal conversion funnel (`Total Leads → Converted to Deal → Deal Won`) from `Deal.contactIds` + `Contact` counts. Exposed at `GET /analytics/:provider/funnels`.

### Routes

```
GET    /api/v1/integrations/status                  any org member
GET    /api/v1/integrations/:provider/authorize      owner/admin
GET    /api/v1/integrations/:provider/callback       public (provider redirects browser here, no auth header)
DELETE /api/v1/integrations/:provider/disconnect      owner/admin
```

The `/callback` route is intentionally unauthenticated — it relies entirely on `verifyIntegrationState` for trust, not `requireAuth`. Keep it that way; do not add `requireAuth` to a provider callback route.

---

## 4. Provider: Salesforce (not yet implemented)

Add this section when Salesforce work starts. At minimum capture, from the real implementation:

- OAuth flow used (web-server auth-code flow vs JWT bearer) and token/callback endpoints.
- API version pinning (Salesforce requires an explicit `/services/data/vXX.0/` version in every request).
- Object/field mapping equivalent to the HubSpot contacts/deals allowlist above — likely `Contact`/`Opportunity` with `StageName` history via `OpportunityHistory` or `OpportunityFieldHistory`.
- Rate limit model (Salesforce limits are per-org-per-24h, not per-second like HubSpot — the retry/backoff strategy will differ).
- The external-account identifier to plug into `ProviderConnectionIndex` (likely the Salesforce org id).
- Env vars actually added to `.env` / `.env.example`.

Until implemented, `integrations.service.ts` reports it via `getStatus` as `{ connected: false, comingSoon: true }` and rejects any authorize/callback/disconnect call with `PROVIDER_NOT_IMPLEMENTED`.

---

## 5. Provider: QuickBooks (not yet implemented)

Add this section when QuickBooks work starts. At minimum capture, from the real implementation:

- OAuth2 flow (Intuit's discovery-document-based OAuth2, distinct token/refresh/revoke endpoints from HubSpot's).
- The `realmId` (company id) — this is QuickBooks' equivalent of HubSpot's `hub_id`/`hub_domain` for the `ProviderConnectionIndex` external-account identifier, and note that a QuickBooks *app* can have both sandbox and production realms — decide how/whether the app distinguishes them.
- Object/field mapping (likely `Customer`/`Invoice` rather than contacts/deals — QuickBooks is finance data, not CRM, so the entity shape in `SyncJobDocument.entities` and the sync loop will differ more than a typical CRM would from HubSpot).
- Rate limits (QuickBooks: per-realm request limits, distinct from HubSpot's).
- Env vars actually added to `.env` / `.env.example`.

Until implemented, same stub behavior as Salesforce above.

---

## 6. Adding a New Provider — Checklist

When moving a provider from stub to implemented, replicate the HubSpot shape:

- [ ] `{provider}.service.ts` in `integrations/service/` with `getAuthorizationUrl`, `exchangeCodeForToken`, `refreshAccessToken`, and (if the provider supports it) a token-info/account-metadata call
- [ ] Provider moved from `SUPPORTED_PROVIDERS`-only to `IMPLEMENTED_PROVIDERS` in `integrations.service.ts`
- [ ] Branch added in `getAuthorizationUrl`, `handleCallback`, `getValidAccessToken`
- [ ] `assert{Provider}AccountAvailable`-style collision check against `ProviderConnectionIndexModel` if the provider has an external account/company id
- [ ] `getStatus` updated to report real connection state instead of `comingSoon`
- [ ] Sync logic added to `sync.service.ts` (or a parallel service if the entity shape diverges significantly, e.g. QuickBooks) using the cursor-pagination + bulk-upsert + per-entity `SyncJob` progress pattern
- [ ] New repository + Mongoose model(s) for the synced entities, tenant-scoped via `getTenantConnection` + a per-connection `WeakMap` cache (same pattern as `Integration`/`Contact`/`Deal` — not a shared collection filtered by `orgId`), unique on `(orgId, provider, providerRecordId)`
- [ ] Error codes follow `{PROVIDER}_{ACTION}_FAILED`
- [ ] Env vars documented in `.env.example` (client id/secret/redirect URI equivalents)
- [ ] Tests: OAuth callback (valid/invalid state, provider mismatch), token refresh, cross-tenant `ProviderConnectionIndex` collision (same org / different org member / different org non-member), sync pagination, tenant isolation on synced entities — see `multi-tenancy` and `testing` skills for the standard matrix
- [ ] This skill's `## Provider: {Name}` section updated from "not yet implemented" to the real implementation details
