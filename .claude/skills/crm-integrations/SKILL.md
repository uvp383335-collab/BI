---
name: crm-integrations
description: Provider-specific implementation details for third-party CRM/finance integrations (HubSpot, Salesforce, QuickBooks) in this multi-tenant SaaS app — OAuth flows, token refresh, rate limits, pagination, sync jobs, and data models. Use this skill whenever implementing or modifying an integrations/* or sync/* module, adding a new provider, or debugging a provider connection/sync issue. For generic integration architecture (module isolation, tenant scoping, retries, webhook verification) see the architecture, multi-tenancy, nodejs, and security skills instead — this skill only documents what differs per provider and the shared plumbing those generic skills don't know about.
---

# CRM/Finance Integration Standards

## 1. Scope of This Skill

This application connects one org to (eventually) three external providers:

```
hubspot     - implemented
salesforce  - implemented
quickbooks  - implemented (Customer + Invoice sync only — see §5)
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

- **Contacts** (`GET /crm/v3/objects/contacts`): `email`, `firstname`, `lastname`, `lifecyclestage`, `hs_lead_status`, `hs_analytics_source` (original traffic-source channel, synced onto `Contact.analyticsSource` — Phase 6, feeds CM-05/CM-07's marketing attribution), plus `propertiesWithHistory=lifecyclestage` to capture the stage-change timeline (`lifecycleStageHistory` on `Contact`) that feeds the lead funnel.
- **Deals** (`GET /crm/v3/objects/deals`): `dealname`, `amount`, `closedate`, `pipeline`, `dealstage`, `hubspot_owner_id`, `createdate` (the CRM's actual deal-creation date, synced onto `Deal.dealCreatedAt` — Phase 6, distinct from Mongo's own `createdAt` sync-time timestamp; feeds CM-05's "qualified pipeline created this period"), plus `propertiesWithHistory=dealstage` to capture the stage-change timeline (`dealStageHistory`) that feeds the deal funnel. No other object's history is synced.
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

**CM-04/06/08 (Phase 5)** read this same `FunnelStageEvent`/`PipelineStageDefinition` data — no new sync work was needed, exactly as the metrics guide's gap G-7 anticipated ("the rare case where the raw data already syncs — the gap is purely the funnel-role mapping"). Two new `funnelStageEventRepository` methods support them: `getCohortRecordIds` (already existed, reused for CM-06's cohort semantics) plus the metric layer's own composition, and `countRecordsEnteringStage` (new — a plain in-range count, not cohort-scoped, for CM-08's "how many crossed the MQL line this month"). The funnel-role mapping itself (`metrics/service/cmMetrics.service.ts`, `LEAD_STAGE`/`MQL_STAGE`/`SQL_STAGE`/`WON_STAGE`) is a fixed default straight from HubSpot's own standard `lifecyclestage` value names (`lead`/`marketingqualifiedlead`/`salesqualifiedlead`/`customer`) — not a per-org config yet, same "hardcoded default, not a versioned UI" pattern as G-13's chart-of-accounts heuristic. CM-04's qualified-stage cutoff is a similar heuristic in the same file: within each open pipeline, every open stage except the lowest-`displayOrder` one counts as "qualified."

### Routes

```
GET    /api/v1/integrations/status                  any org member
GET    /api/v1/integrations/:provider/authorize      owner/admin
GET    /api/v1/integrations/:provider/callback       public (provider redirects browser here, no auth header)
DELETE /api/v1/integrations/:provider/disconnect      owner/admin
```

The `/callback` route is intentionally unauthenticated — it relies entirely on `verifyIntegrationState` for trust, not `requireAuth`. Keep it that way; do not add `requireAuth` to a provider callback route.

---

## 4. Provider: Salesforce (implemented)

Files: `backend/src/modules/integrations/service/salesforce.service.ts`, `integrations.service.ts` (the `salesforce` branches), `backend/src/modules/sync/service/sync.service.ts` (the `syncSalesforce*` functions).

### Entity mapping — deliberate departure from Salesforce's own object model

This app treats a Salesforce **Lead** as its generic Contact entity, and a Salesforce **Opportunity** as its generic Deal entity. It does **not** sync Salesforce's separate `Contact`/`Campaign` objects at all — same "narrow sync" philosophy as HubSpot (§3, "only two object types, only properties the dashboard needs"). This is a product decision, not a Salesforce data-model default: normally a Lead *converts into* an Account+Contact+Opportunity trio and stops being queryable data on its own. Consequences that fall out of this choice:

- **Lead → Contact.** `Contact.lifecycleStage` is Salesforce's `Lead.Status` (Salesforce has one status field where HubSpot has two — `lifecyclestage` + `hs_lead_status` — so `Contact.leadStatus` is left unset for Salesforce rows).
- **Opportunity → Deal.** Standard field mapping: `Name → dealname`, `Amount → amount`, `CloseDate → closedate`, `StageName → dealstage`, `OwnerId → ownerId`, plus (Phase 4) `Type → type`, `LeadSource → leadSource`, `CampaignId → campaignId`, `AccountId → accountId` — all four are Salesforce-only and stay `undefined` on HubSpot-sourced deals.
- **`Deal.competitor` / `Deal.competitors` (Phase 7 + Post-Phase-7, per-org configurable, two modes)** — Salesforce has no single standard way to record "which competitor was in this deal" (unlike every other synced field, which has a fixed API name or object). Which mode an org uses is `Organization.settings.salesforceCompetitorSource: 'field' | 'junction'` (default org model, not tenant-scoped — see §2.2's tenant-vs-control-plane distinction), editable via `GET`/`PATCH /api/v1/organizations/settings` (owner/admin-gated for writes):
  - **`'field'` mode** — a custom Opportunity field (commonly `Competitor__c`), one competitor per deal, named in `Organization.settings.salesforceCompetitorField`. `SalesforceService.getOpportunities` takes it as an optional `competitorField` param and appends it to the SOQL SELECT list when present, normalizing the dynamically-named response field onto a fixed `Competitor` property so callers never see the raw field name — populates `Deal.competitor` (single string). **Any per-org value that gets interpolated into a SOQL string must be validated against a strict field-name regex (`^[A-Za-z][A-Za-z0-9_]*$`) both at the settings write (validator) and again immediately before use in the query (service) — this is the first place in the app where org-configurable input reaches a query string, so don't relax either check when extending this pattern to a future per-org config value.**
  - **`'junction'` mode** — the standard `OpportunityCompetitor` object, which allows *multiple* named competitors per deal. `SalesforceService.getOpportunityCompetitors` batch-resolves `OpportunityId → CompetitorName[]` per synced page (same pattern as `getConvertedLeadIdsByOpportunity` below), populating `Deal.competitors` (string array) instead. The sync call site wraps this in `.catch(() => ({}))` — an org that selects this mode but whose Salesforce edition/permissions don't actually expose `OpportunityCompetitor` shouldn't have the whole sync fail over it.
  - CM-03 (`cmMetrics.service.ts`'s `buildCompetitorStats`) reads *either* field uniformly — a multi-competitor deal (junction mode) credits a win/loss to every competitor it names, not just one.
- **`Deal.contactIds` (lead-to-deal conversion funnel input)** is populated from `Lead.ConvertedOpportunityId` — the field Salesforce stamps onto a Lead when it's converted — batched per synced page (`SalesforceService.getConvertedLeadIdsByOpportunity`, `WHERE ConvertedOpportunityId IN (...)`). This is the natural bridge given Leads (not Contacts) are the contact entity here; it is **not** `OpportunityContactRole` (which associates Opportunities with the real `Contact` object, which this app doesn't sync).
- **Account (Phase 4, narrow)** — `Id`/`Name`/`ParentId` only, into a new `SalesforceAccount` tenant model (`sync/model/SalesforceAccount.model.ts`), *not* this app's Contact entity. Exists solely to resolve subsidiary hierarchy for CM-02's customer-concentration grouping — see the metrics progress doc. In practice CM-02 ended up using QuickBooks `Customer.ParentRef` as its primary/only grouping signal instead (already synced, no fuzzy name-matching needed against a separate Salesforce record), so this Account sync is groundwork not yet consumed by a live metric.

### OAuth (web-server flow + PKCE)

- Authorize: `{SALESFORCE_LOGIN_URL}/services/oauth2/authorize` with `response_type=code`, `client_id`, `redirect_uri`, `scope`, `state`, `code_challenge`, `code_challenge_method=S256`.
- Token exchange/refresh: `POST {SALESFORCE_LOGIN_URL}/services/oauth2/token`, form-encoded, `grant_type=authorization_code` (+ `code_verifier`) or `grant_type=refresh_token`.
- **PKCE verifier can't be kept server-side** across the redirect (this backend is stateless between authorize and callback) — it's generated in `integrations.service.getAuthorizationUrl` and carried inside the signed `state` JWT itself (`IntegrationStatePayload.codeVerifier`, `shared/utils/jwt.ts`), same trust boundary as the rest of `state`. A callback whose state has no `codeVerifier` is rejected (`SALESFORCE_MISSING_CODE_VERIFIER`).
- **No separate token-info call needed** — unlike HubSpot, Salesforce's token response itself carries everything needed to identify the connection: `instance_url` (the per-org API host, see below), `scope` (space-delimited granted scopes), and an `id` field shaped `https://<host>/id/{orgId}/{userId}` — the org id is parsed out of that (`SalesforceService.exchangeCodeForToken`) instead of making an extra identity-API round trip.
- **`instance_url` is mandatory for every subsequent API call** and varies per connected org (unlike HubSpot's fixed `api.hubapi.com`) — persisted on `Integration.instanceUrl` (added to the shared model specifically for this; null/unused for other providers). `sync.service.ts` reads it off the `Integration` doc it already fetches for `lastSyncedAt`, rather than changing `getValidAccessToken`'s signature.
- **No `expires_in` in the token response** — a genuine Salesforce API gap (actual expiry is governed by the connected org's session-timeout policy, which isn't introspectable via this API). A conservative fixed default (`DEFAULT_TOKEN_TTL_SECONDS = 2 hours`, in `salesforce.service.ts`) is used in its place for `Integration.expiresAt`, so the existing expiresAt-based proactive-refresh flow in `getValidAccessToken` still applies unmodified.
- Env vars: `SALESFORCE_CLIENT_ID`, `SALESFORCE_CLIENT_SECRET`, `SALESFORCE_REDIRECT_URI` (default `http://localhost:4000/api/v1/integrations/salesforce/callback`), `SALESFORCE_LOGIN_URL` (default `https://login.salesforce.com`; override to `https://test.salesforce.com` for a sandbox-only Connected App). **The redirect URI must be added to the Connected App's allowed callback URLs in Salesforce Setup** — it isn't auto-provisioned.
- Scopes requested: `api refresh_token` — narrow, mirrors HubSpot's policy of not requesting more than the sync needs.

### API version pinning

Every request goes through `SALESFORCE_API_VERSION = 'v65.0'` (top of `salesforce.service.ts`) against `{instance_url}/services/data/v65.0/...` — Salesforce requires an explicit version segment, there's no "latest" alias.

### Data pulled (SOQL, not a fixed-path REST resource like HubSpot)

All reads go through the generic `/services/data/v65.0/query?q=<SOQL>` endpoint:

- **Leads**: `SELECT Id, Email, FirstName, LastName, Status FROM Lead [WHERE LastModifiedDate >= ...] ORDER BY LastModifiedDate ASC`.
- **Opportunities**: `SELECT Id, Name, Amount, CloseDate, StageName, OwnerId, Type, LeadSource, CampaignId, AccountId FROM Opportunity [WHERE LastModifiedDate >= ...] ORDER BY LastModifiedDate ASC` (Phase 4 widened this from just the first 6 fields).
- **Accounts** (Phase 4, narrow): `SELECT Id, Name, ParentId FROM Account [WHERE LastModifiedDate >= ...] ORDER BY LastModifiedDate ASC` — `SalesforceService.getAccounts`, synced via `syncSalesforceAccounts` in `sync.service.ts`.
- **Lead status history** (`LeadHistory`, `Field = 'Status'`, batched per synced page via `WHERE LeadId IN (...)`) — Salesforce's rough equivalent of HubSpot's `propertiesWithHistory`, except it's always a separate query (never embeddable in the list call, so it runs on every sync, not just incremental ones) **and depends on field history tracking being enabled for `Status` in Salesforce Setup**. `getLeadStatusHistory` degrades to an empty array (not a thrown error) when tracking isn't enabled or the query otherwise fails — treat a Salesforce org with no lead-stage funnel data as "tracking not enabled," not a bug.
- **Opportunity stage history** (`OpportunityHistory`, batched per page via `WHERE OpportunityId IN (...)`) — this one **is** always-on out of the box (no tracking toggle, unlike `LeadHistory`), so it's a hard failure (`SALESFORCE_OPPORTUNITY_HISTORY_FETCH_FAILED`) rather than a degrade if it errors.
- **Stage picklist metadata**: `OpportunityStage` (`ApiName, MasterLabel, SortOrder, IsClosed, IsWon`) and `LeadStatus` (`ApiName, MasterLabel, SortOrder, IsConverted` — `IsConverted` doubles as both `isClosed` and `isWon`, there's no separate "closed lost" concept for a Lead status) — Salesforce's equivalent of HubSpot's deal-pipelines API and lifecyclestage property options, refreshed once per sync job the same way.

### Pipelines — single synthetic pipeline per entity type, not per-org pipelines

Salesforce has no default multi-pipeline concept for Opportunities (one Stage picklist per org unless using multiple Sales Processes + Record Types, which this app doesn't attempt to resolve) or Leads. Mirroring HubSpot's `CONTACTS_PIPELINE` synthetic-pipeline-id pattern (§3, "Funnel data model"), `sync.service.ts` exports **`OPPORTUNITIES_PIPELINE = 'opportunities-default'`** for deals and reuses the existing **`CONTACTS_PIPELINE = 'contacts-default'`** for leads — safe to share across providers since every `PipelineStageDefinition`/`FunnelStageEvent` row is additionally scoped by `provider`. `funnel.service.ts` needed no changes as a result.

### Pagination

Cursor-based via Salesforce's own `nextRecordsUrl` (a full relative path returned once a query exceeds the batch size), **not** SOQL `OFFSET` — `OFFSET` caps out at 2000 rows and can't page through a whole org. Batch size is requested via the `Sforce-Query-Options: batchSize=<n>` header on the *initial* query call only (`PAGE_SIZE = 50`, same constant the HubSpot sync loop uses); subsequent pages are plain `GET {instance_url}{nextRecordsUrl}` calls.

### Incremental sync

Same `Integration.lastSyncedAt` mechanism as HubSpot (§3, "Incremental sync"), but simpler: Salesforce's query endpoint is SOQL either way, so incremental sync is just an added `WHERE LastModifiedDate >= <since>` clause on the same query — there's no HubSpot-style split between a "list" endpoint and a dedicated "search" endpoint with different capabilities. One consequence: unlike HubSpot (where a full sync gets stage history embedded in the list response for free via `propertiesWithHistory`), Salesforce **always** makes the separate `LeadHistory`/`OpportunityHistory` batched call regardless of full vs. incremental — there's no cheaper embedded path to prefer on a full sync.

### Known limitation — Lead/Opportunity creation-time stage may be missing from history

`LeadHistory`/`OpportunityHistory` capture *changes*; depending on the org's field-history-tracking configuration, a record's stage at creation time isn't guaranteed to appear as its own history row. A Lead/Opportunity that has never changed stage since creation can end up with an empty `lifecycleStageHistory`/`dealStageHistory`, which undercounts that stage in the funnel chart. This is an inherent Salesforce data limitation, not a sync bug — don't try to backfill a synthetic "created" event to paper over it.

### Rate limits

Salesforce enforces a **per-org rolling 24-hour API call budget** (not per-second like HubSpot) — a large backfill sync could meaningfully eat into a client's daily allowance. No budget-aware throttling exists yet, consistent with [§2.7's documented "no retry/backoff" gap](#27-known-gap--no-retrybackoff-yet) — if this becomes a real issue, solve it alongside HubSpot's retry/backoff gap rather than bolting on a Salesforce-only throttle.

### Collision detection

`ProviderConnectionIndex`'s `externalAccountId` for Salesforce is the **Salesforce org id** (the 18-character id parsed out of the token response's `id` field, see OAuth section above) — Salesforce's equivalent of HubSpot's `hub_id`. `assertSalesforceAccountUsable` in `integrations.service.ts` is a parallel implementation of `assertHubSpotAccountUsable` (same three-way branch: same org allowed, different org + member offers a switch, different org + non-member is denied without leaking identity) using `SALESFORCE_ALREADY_CONNECTED_SWITCH` / `SALESFORCE_ALREADY_CONNECTED_REQUEST_ACCESS` / `SALESFORCE_ORG_LOCKED_TO_ACCOUNT` error codes. `integrations.controller.ts`'s callback error handling matches on the error-code *suffix* (`_ALREADY_CONNECTED_SWITCH` etc.) rather than a hardcoded HubSpot-prefixed string, so both providers' collision errors redirect correctly without provider-specific branches in the controller.

---

## 5. Provider: QuickBooks (implemented — Customer + Invoice sync)

Files: `backend/src/modules/integrations/service/quickbooks.service.ts` (OAuth + Query API), `integrations.service.ts` (the `quickbooks` branches), `backend/src/modules/sync/service/sync.service.ts` (the `syncQuickBooksCustomers`/`syncQuickBooksInvoices` functions), `backend/src/modules/sync/model/{QuickBooksCustomer,Invoice}.model.ts`.

`'quickbooks'` is in `integrations.controller.ts`'s `SYNC_IMPLEMENTED_PROVIDERS`, so a callback triggers an initial sync like the other two providers.

### Entity mapping — deliberately narrow, and unlike the other two providers

QuickBooks is finance data, not CRM — its two synced objects are `Customer` (the billing-customer entity, → `QuickBooksCustomer.model.ts`) and `Invoice` (→ `Invoice.model.ts`), **not** the generic Contact/Deal pool HubSpot/Salesforce feed. Only what the MVP metrics guide's first two metrics (VC-01 Gross Revenue Retention, VC-02 Net Revenue Retention) need is pulled today:

- **Customer**: `Id`, `DisplayName`, `ParentRef` (→ `parentRecordId`, captured now even though nothing consumes it yet — free on the same payload, and CM-02's subsidiary-grouping metric will need it later without a resync), `Active`.
- **Invoice**: `Id`, `CustomerRef`, `TxnDate`, `TotalAmt` only — **no line-item detail**. The shared customer revenue roll-forward (see below) only needs a per-invoice total; line/Class/Item detail is a later addition once VC-04 (COGS by product) and VC-12 (recurring-revenue tagging) are built. Don't widen this ahead of that need.

Neither object is written into the shared `Contact`/`Deal` pool — they get their own tenant-scoped models, same `getXModel(connection)` + `WeakMap` cache pattern.

### Customer revenue roll-forward (shared building block)

`backend/src/modules/metrics/service/revenueRollForward.service.ts` builds the per-customer-per-month revenue table every QuickBooks-revenue metric reads from (metrics guide, "Shared building blocks"). QuickBooks invoices carry no explicit "downgrade" or "cancellation" event, so both are *inferred* by comparing a customer's invoiced total month over month: revenue drop while still >0 = downgrade, drop to 0 = cancellation, increase = expansion, first invoice ever = new-logo (excluded from "starting revenue" — nothing to retain yet). Build this once here; don't re-derive it per metric.

### OAuth (authorization-code flow, HTTP Basic client auth)

- Authorize: `https://appcenter.intuit.com/connect/oauth2` with `client_id`, `redirect_uri`, `response_type=code`, `scope`, `state`. Fixed Intuit host — doesn't vary per connected company, unlike Salesforce's per-org domain.
- Token exchange/refresh: `POST https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer`, form-encoded, `grant_type=authorization_code` (+ `redirect_uri`) or `grant_type=refresh_token`. **Client authentication is HTTP Basic** (`Authorization: Basic base64(client_id:client_secret)`), not body params like HubSpot/Salesforce — see `QuickBooksService.basicAuthHeader()`.
- **`realmId` (the connected company id) arrives as a query param directly on the OAuth redirect** — Intuit appends it itself (`...&realmId=...&state=...`), no parsing or extra identity call needed (simpler than both HubSpot's `hub_id` token-info call and Salesforce's `id`-URL parsing). Since `integrations.service.handleCallback`'s signature is shared across all providers, it takes `realmId` as an extra optional 4th parameter that only QuickBooks uses; `integrations.controller.ts`'s `handleCallback` extracts it off `req.query` and passes it through unconditionally.
- This is the `ProviderConnectionIndex` external-account identifier — QuickBooks' equivalent of HubSpot's `hub_id` / Salesforce's org id. `assertQuickBooksAccountUsable` in `integrations.service.ts` is the same three-way collision-guard pattern as the other two providers, using `QUICKBOOKS_ALREADY_CONNECTED_SWITCH` / `QUICKBOOKS_ALREADY_CONNECTED_REQUEST_ACCESS` / `QUICKBOOKS_ORG_LOCKED_TO_ACCOUNT`.
- No display metadata (company name, domain) is fetched — `accountDomain` is left `null` for QuickBooks rows. A one-off `CompanyInfo` API call could add one later (mirrors HubSpot's non-critical `getTokenInfo` call) if the UI wants to show more than "Connected".
- Scope requested: `com.intuit.quickbooks.accounting` — read/write on the company's accounting data, no payments/payroll scopes.
- Env vars: `QUICKBOOKS_CLIENT_ID`, `QUICKBOOKS_CLIENT_SECRET`, `QUICKBOOKS_REDIRECT_URI` (default `http://localhost:4000/api/v1/integrations/quickbooks/callback`). **The redirect URI must be added to the app's allowed redirect URIs in the Intuit Developer Portal.**
- Sandbox vs. production: unlike Salesforce (`SALESFORCE_LOGIN_URL`), the OAuth host doesn't change between sandbox and production Intuit apps — only the accounting API host does. `QuickBooksService`'s `ACCOUNTING_API_HOST` picks `https://quickbooks.api.intuit.com` when `QUICKBOOKS_ENVIRONMENT=production`, else defaults to `https://sandbox-quickbooks.api.intuit.com`.

### Accounting Query API

Reads go through `GET /v3/company/{realmId}/query?query=<SQL-like query>` (`QuickBooksService.runQuery`) — QuickBooks' own query language, not a fixed-path REST resource. Pagination is `STARTPOSITION`/`MAXRESULTS` (no cursor, unlike HubSpot/Salesforce) — `hasMore` is inferred from a full page (`records.length === pageSize`), the standard heuristic since the API returns no total count. Incremental sync filters on `WHERE Metadata.LastUpdatedTime >= '<since>'`, QuickBooks' equivalent of HubSpot's `lastmodifieddate`/Salesforce's `LastModifiedDate`.

### Reports API — synced into `PLSnapshot`, not called live per request

`QuickBooksService.getProfitAndLossReport` (`GET /v3/company/{realmId}/reports/ProfitAndLoss`, `summarize_column_by=Class`) is called by the **sync job** (`syncQuickBooksProfitAndLoss` in `sync.service.ts`), not by metric computation directly — it fetches the trailing 6 quarters (18 months) and upserts one `PLSnapshot` row per quarter (`sync/model/PLSnapshot.model.ts`, unique on `(orgId, provider, quarterStart)`, overwritten in place on each resync — no version history yet). Still deliberately **not** reconstructed from raw Bill/JournalEntry/Vendor transactions: a report is QuickBooks' own point-in-time aggregate, so pulling *the report* and storing *that* is simpler and always correct, versus building a full transaction sync just to re-derive the same numbers locally.

Every P&L-driven metric (VC-04, VC-06, VC-07, VC-09, VC-10, VC-12, VC-13, VC-14 — `backend/src/modules/metrics/service/plMetrics.service.ts`) reads through `metrics/service/plReport.service.ts`'s `getStoredProfitAndLoss(orgId, provider, quarterStart)`, which returns `null` if that quarter hasn't been synced yet — the metric then reports itself as not computable rather than guessing. `getParsedProfitAndLoss` (the live-call function) still exists and is used only by the sync step itself.

`metrics/service/plParser.ts` walks the report's recursive Rows/Summary tree into flat Income/COGS/Expenses line-item lists (QuickBooks' own section grouping is trusted for Income vs. COGS vs. Expenses) — used both by the sync step (to build what gets stored) and by tests. `classifyExpenseAccount`/`isRecurringIncomeAccount` in the same file apply a name-keyword heuristic for G&A vs. sales-&-marketing vs. D&A vs. recurring-income, since QuickBooks doesn't sub-split those on its own (see the metrics progress doc's gap G-13 — this isn't yet a per-org configurable/versioned mapping).

No scheduler exists yet — `PLSnapshot` (like Customer/Invoice/Contact/Deal) only refreshes on OAuth-connect or a manual resync click. A future cron/repeatable job just needs to call the same `syncService.startSync` path more often; no metric-side changes needed when that ships.

**Balance Sheet, Cash Flow, A/R/A/P Aging, and Inventory Valuation Summary** (Phase 3 — CB-05/07/10) follow the same sync-and-store pattern, not a live per-request call:

- `QuickBooksService.getBalanceSheetReport` / `getCashFlowReport` / `getAgedReceivablesReport` / `getAgedPayablesReport` / `getInventoryValuationSummaryReport` — all thin wrappers over a shared private `getReport` helper, same shape as `getProfitAndLossReport`.
- `metrics/service/reportParser.ts` — lighter-weight than `plParser.ts` since CB-05/07/10 only need each report's own pre-computed totals, not full line-item detail: `extractSectionTotals` reads a grouped report's (Balance Sheet, Cash Flow — same recursive Rows/Summary/`group` tree as ProfitAndLoss) per-section subtotal (e.g. `BankAccounts`, `OperatingActivities`); `extractFlatReportGrandTotal` reads a flat report's (Aging, Inventory — one row per customer/vendor/item, no sections) grand-total row. **Caveat (progress doc gap G-18): written against documented QuickBooks report shapes, not verified against a live sandbox response** — no connected org existed in the session that built this.
- The A/R, A/P, and Inventory balances (as of each quarter's end date) and the Cash Flow figures (over each quarter) are folded into the **same `PLSnapshot` row** as the P&L data — one row per quarter still covers everything, fetched in the same sync pass. Each of these 4 extra report calls is independently try/caught during sync — one failing (e.g. no inventory tracking) doesn't break the P&L data that already succeeded.
- **`CashBalanceSnapshot`** (`sync/model/CashBalanceSnapshot.model.ts`) is the one exception to the quarterly grain — CB-05 is the single metric in the framework checked *daily*, so it's keyed by calendar day instead. `syncQuickBooksCashBalance` pulls the Balance Sheet as-of today and stores just the `BankAccounts` section total. Still only refreshes on connect/manual-resync like everything else — genuinely daily data needs the scheduler that doesn't exist yet.

### Not yet decided

- Rate limits — QuickBooks enforces per-realm request limits, distinct from HubSpot's per-second and Salesforce's per-24h models. No throttling exists yet, consistent with [§2.7's documented "no retry/backoff" gap](#27-known-gap--no-retrybackoff-yet). A full QuickBooks sync now makes ~30 report calls (6 quarters × 5 report types, plus 1 for cash balance) — no longer per-dashboard-view, but worth watching under real load as the trailing-quarter window or report count grows.

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
