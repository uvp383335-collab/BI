# Cross-CRM Funnel Normalization — Design Doc

Status: **proposed, not yet implemented**. Written to align on approach before
touching `backend/src/modules/sync/`. See `.claude/skills/crm-integrations`
for the shared plumbing this builds on.

---

## 1. Problem

Today the platform syncs HubSpot into two tenant-scoped collections,
`Contact` and `Deal` (`backend/src/modules/sync/model/`). Both already carry
`provider` + `providerRecordId` so multiple providers can land in the same
pool. HubSpot's shape: a `Deal` is born already mid-pipeline, with
`dealStageHistory` tracking one stage lifecycle on one object.

Salesforce splits the same journey into **two objects with two separate
stage lifecycles**:

- **Lead** — `Status` field (e.g. `Open - Not Contacted` → `Working -
  Contacted` → `Closed - Converted`). No amount/close date yet.
- **Opportunity** — `StageName` field (`Prospecting` → ... → `Closed Won`),
  only exists after a Lead converts.

Cramming Salesforce's Lead phase into the `Deal` schema is a bad fit (no
`amount`/`closedate` pre-conversion) and merging two lifecycles into one
history array loses which lifecycle each stage belongs to.

**Decision: funnel is shown per-provider, not merged across providers.**
Salesforce orgs routinely rename/reorder/add stages per admin config, so
forcing raw stage strings into a fixed cross-provider canonical enum is
lossy and fragile — a client's custom `"Negotiation - Legal Review"` stage
either gets mis-bucketed or silently dropped. Dropping the canonical-enum
requirement removes that problem entirely: each provider's funnel renders
its own real stage names, exactly as configured in that CRM.

## 2. Approach

Two layers, on top of what already exists:

1. **Keep raw sync provider-faithful** — `Contact` (lead-side) and `Deal`
   (opportunity-side) stay as-is, unchanged shape. A Salesforce Lead syncs
   into `Contact` (matches shape already); a Salesforce Opportunity syncs
   into `Deal`.
2. **Normalized event timeline, per provider** — a new collection,
   `FunnelStageEvent`, one row per stage-entry, replacing/extending the
   embedded `dealStageHistory` array pattern. Funnel chart queries this one
   collection, grouped by `(provider, pipeline, rawStage)` — no canonical
   mapping, no cross-provider merge. A dashboard showing both HubSpot and
   Salesforce renders two separate funnels, one per provider.

Losing the canonical enum also loses implicit stage **ordering** and
"which stage counts as closed-won/lost" — those were hardcoded in the enum
before. Both CRMs expose that as real metadata instead of us guessing it,
so a third, small collection captures it — see §3.4.

## 3. Collections

### 3.1 `Contact` (existing, unchanged)

`backend/src/modules/sync/model/Contact.model.ts`. Lead-side raw data.

| field | source: HubSpot | source: Salesforce |
|---|---|---|
| `email` | `email` | `Lead.Email` |
| `firstname`/`lastname` | `firstname`/`lastname` | `Lead.FirstName`/`LastName` |
| `lifecycleStage` | `lifecyclestage` | *(not a direct SF field — see §4)* |
| `leadStatus` | `hs_lead_status` | `Lead.Status` |

### 3.2 `Deal` (existing, unchanged)

`backend/src/modules/sync/model/Deal.model.ts`. Opportunity-side raw data.

| field | source: HubSpot | source: Salesforce |
|---|---|---|
| `dealname` | `dealname` | `Opportunity.Name` |
| `amount` | `amount` | `Opportunity.Amount` |
| `closedate` | `closedate` | `Opportunity.CloseDate` |
| `pipeline` | `pipeline` | *(Salesforce calls this the Sales Process — usually one per record type)* |
| `dealstage` | `dealstage` | `Opportunity.StageName` |
| `ownerId` | `hubspot_owner_id` | `Opportunity.OwnerId` |
| `dealStageHistory` | `propertiesWithHistory=dealstage` | `OpportunityHistory` (auto-tracked by Salesforce) |

### 3.3 `FunnelStageEvent` (new)

One row per stage-entry, across both lead and deal lifecycles, all
providers. No canonical mapping — `rawStage` is the exact CRM value and is
also what the funnel chart groups on.

```ts
interface FunnelStageEventDocument {
  orgId: Types.ObjectId
  provider: string                    // 'hubspot' | 'salesforce' | ...
  entityType: 'lead' | 'deal'
  providerRecordId: string            // HubSpot contact/deal id, or SF Lead/Opportunity id
  pipeline: string                    // HubSpot pipeline id, or SF record type / sales process name
  rawStage: string                    // exact value the CRM sent, unmapped
  enteredAt: Date
  convertedToRecordId?: string        // set only on the last lead-event, when Lead converts to a Deal
}
```

Unique index: `(orgId, provider, entityType, providerRecordId, rawStage,
enteredAt)` — re-syncing the same transition is a no-op insert (duplicate
key), not a duplicate row.

Tenant-scoped, compiled per connection via `getFunnelStageEventModel(connection)`
+ `WeakMap<Connection, Model>` cache — identical pattern to `Contact`/`Deal`.

### 3.4 `PipelineStageDefinition` (new)

Without a canonical enum, stage **order** and **which stage is
closed-won/lost/converted** have to come from somewhere — both CRMs expose
this as real metadata, so we sync it rather than guess it:

```ts
interface PipelineStageDefinitionDocument {
  orgId: Types.ObjectId
  provider: string
  entityType: 'lead' | 'deal'
  pipeline: string          // pipeline id (HubSpot) / record type or sales process (Salesforce)
  rawStage: string          // matches FunnelStageEvent.rawStage
  label: string             // human-readable display name, as configured by the client's admin
  displayOrder: number
  isClosed: boolean
  isWon: boolean            // meaningful only when isClosed is true
}
```

Unique index: `(orgId, provider, entityType, pipeline, rawStage)`. Synced
separately from `FunnelStageEvent` — it's pipeline *configuration*, not
per-record data, so it only needs refreshing occasionally (e.g. once per
sync job, or on a slower cadence), not per record.

Source per provider:

- **HubSpot deals**: `GET /crm/v3/pipelines/deals` → each pipeline's
  `stages[]` array has `label`, `displayOrder`, and
  `metadata.isClosed`/`metadata.probability` (probability `1` = won, `0`
  with closed = lost).
- **HubSpot contacts**: `GET /crm/v3/properties/contacts/lifecyclestage` →
  `options[]` has `label` and `displayOrder`. No native "isClosed" concept
  for lifecycle stage — treat `customer` as the closed/won marker.
- **Salesforce deals**: SOQL `SELECT MasterLabel, SortOrder, IsClosed,
  IsWon FROM OpportunityStage`.
- **Salesforce leads**: SOQL `SELECT MasterLabel, SortOrder, IsConverted
  FROM LeadStatus`. `IsConverted` doubles as the `isClosed`/`isWon`
  equivalent for the lead funnel.

## 4. Per-provider raw data

Raw data flows straight into `FunnelStageEvent.rawStage` — no mapping
step. `PipelineStageDefinition` (synced separately, §3.4) supplies the
order and closed/won markers the chart needs.

### HubSpot — lead side (`entityType: 'lead'`)

Source: `Contact.lifecyclestage` / `hs_lead_status`. **Gap today:** current
sync does not request `propertiesWithHistory` for contacts — only current
value. To get a real transition timeline, `contacts.service.ts`'s fetch
needs `propertiesWithHistory=lifecyclestage` added (HubSpot's v3 API
supports this param on any object, not just deals — it's not a HubSpot
limitation, just a code gap). Until then, only one "observed at sync time"
event is possible per contact — funnel logic must tolerate
`providerRecordId`s with a single event.

Typical values: `subscriber`, `lead`, `marketingqualifiedlead`,
`salesqualifiedlead`, `opportunity`, `customer` — but these are also
just the *default* set; a portal admin can add custom lifecycle stages, in
which case `PipelineStageDefinition` is the only source of truth for what
exists and in what order.

### HubSpot — deal side (`entityType: 'deal'`)

Source: `Deal.dealstage`, already fetched with `propertiesWithHistory=dealstage`
today — full timeline available for free, just needs exploding into
`FunnelStageEvent` rows instead of staying an embedded array. Stage ids
(`appointmentscheduled`, `contractsent`, `closedwon`, ...) are per-pipeline
and per-portal — never assume the default pipeline's ids apply everywhere,
always join against that pipeline's `PipelineStageDefinition` rows.

### Salesforce — lead side (`entityType: 'lead'`)

Source: `Lead.Status` — **fully org-customizable picklist**, this is
exactly the case that made a canonical enum a bad fit. `Lead.IsConverted`
+ `Lead.ConvertedOpportunityId` fill `convertedToRecordId`.

**Gap:** full `Status` change history requires **Field History Tracking**
enabled on that field by the org admin (`LeadHistory` object) — not on by
default. If disabled, same fallback as HubSpot contacts: single
observed-now event only.

### Salesforce — deal side (`entityType: 'deal'`)

Source: `Opportunity.StageName` — also customizable per org (this is the
`OpportunityStage` metadata object referenced in §3.4). Stage-change
history (`OpportunityHistory`) is tracked automatically by Salesforce,
always on — full timeline always pullable, no admin config needed.

## 5. End-to-end example

One org (`org1`), one HubSpot contact→deal, one Salesforce lead→opportunity.

### 5a. HubSpot: contact converts to deal

`Contact`:
```json
{
  "orgId": "org1", "provider": "hubspot", "providerRecordId": "hs-contact-501",
  "email": "a@x.com", "lifecycleStage": "opportunity", "leadStatus": "OPEN"
}
```

`Deal`:
```json
{
  "orgId": "org1", "provider": "hubspot", "providerRecordId": "hs-deal-9001",
  "dealname": "Acme Renewal", "amount": 5000, "pipeline": "default",
  "dealstage": "contractsent", "ownerId": "hs-owner-7"
}
```

`FunnelStageEvent` rows generated at sync:
```json
[
  { "orgId":"org1","provider":"hubspot","entityType":"lead","providerRecordId":"hs-contact-501",
    "pipeline":"contacts-default","rawStage":"lead","enteredAt":"2026-07-01T10:00:00Z" },
  { "orgId":"org1","provider":"hubspot","entityType":"lead","providerRecordId":"hs-contact-501",
    "pipeline":"contacts-default","rawStage":"opportunity","enteredAt":"2026-07-05T09:00:00Z",
    "convertedToRecordId":"hs-deal-9001" },
  { "orgId":"org1","provider":"hubspot","entityType":"deal","providerRecordId":"hs-deal-9001",
    "pipeline":"default","rawStage":"appointmentscheduled","enteredAt":"2026-07-05T09:00:00Z" },
  { "orgId":"org1","provider":"hubspot","entityType":"deal","providerRecordId":"hs-deal-9001",
    "pipeline":"default","rawStage":"contractsent","enteredAt":"2026-07-10T12:00:00Z" }
]
```

`PipelineStageDefinition` rows (synced once from HubSpot's Pipelines API,
reused for every deal in that pipeline):
```json
[
  { "orgId":"org1","provider":"hubspot","entityType":"deal","pipeline":"default",
    "rawStage":"appointmentscheduled","label":"Appointment Scheduled","displayOrder":0,"isClosed":false,"isWon":false },
  { "orgId":"org1","provider":"hubspot","entityType":"deal","pipeline":"default",
    "rawStage":"contractsent","label":"Contract Sent","displayOrder":3,"isClosed":false,"isWon":false },
  { "orgId":"org1","provider":"hubspot","entityType":"deal","pipeline":"default",
    "rawStage":"closedwon","label":"Closed Won","displayOrder":4,"isClosed":true,"isWon":true },
  { "orgId":"org1","provider":"hubspot","entityType":"deal","pipeline":"default",
    "rawStage":"closedlost","label":"Closed Lost","displayOrder":5,"isClosed":true,"isWon":false }
]
```

### 5b. Salesforce: lead converts to opportunity

`Contact` (Salesforce Lead, pre-conversion):
```json
{
  "orgId": "org1", "provider": "salesforce", "providerRecordId": "sf-lead-77",
  "email": "b@y.com", "lifecycleStage": "Qualified", "leadStatus": "Working - Contacted"
}
```

`Deal` (Salesforce Opportunity, born on conversion):
```json
{
  "orgId": "org1", "provider": "salesforce", "providerRecordId": "sf-opp-3300",
  "dealname": "Globex Deal", "amount": 12000, "pipeline": "Sales Process",
  "dealstage": "Negotiation", "ownerId": "sf-user-12"
}
```

`FunnelStageEvent` rows — note Salesforce's client-customized label
(`"Qualified"` instead of a stock value) passes through untouched, exactly
the case a canonical enum would have mishandled:
```json
[
  { "orgId":"org1","provider":"salesforce","entityType":"lead","providerRecordId":"sf-lead-77",
    "pipeline":"leads-default","rawStage":"Open - Not Contacted","enteredAt":"2026-06-01T08:00:00Z" },
  { "orgId":"org1","provider":"salesforce","entityType":"lead","providerRecordId":"sf-lead-77",
    "pipeline":"leads-default","rawStage":"Working - Contacted","enteredAt":"2026-06-04T08:00:00Z" },
  { "orgId":"org1","provider":"salesforce","entityType":"lead","providerRecordId":"sf-lead-77",
    "pipeline":"leads-default","rawStage":"Qualified","enteredAt":"2026-06-10T08:00:00Z",
    "convertedToRecordId":"sf-opp-3300" },
  { "orgId":"org1","provider":"salesforce","entityType":"deal","providerRecordId":"sf-opp-3300",
    "pipeline":"Sales Process","rawStage":"Prospecting","enteredAt":"2026-06-10T08:00:00Z" },
  { "orgId":"org1","provider":"salesforce","entityType":"deal","providerRecordId":"sf-opp-3300",
    "pipeline":"Sales Process","rawStage":"Negotiation","enteredAt":"2026-06-20T08:00:00Z" }
]
```

`PipelineStageDefinition` rows (synced from Salesforce's `OpportunityStage`
object — order/won-lost come straight from the client's own configuration,
whatever they renamed the stages to):
```json
[
  { "orgId":"org1","provider":"salesforce","entityType":"deal","pipeline":"Sales Process",
    "rawStage":"Prospecting","label":"Prospecting","displayOrder":0,"isClosed":false,"isWon":false },
  { "orgId":"org1","provider":"salesforce","entityType":"deal","pipeline":"Sales Process",
    "rawStage":"Negotiation","label":"Negotiation/Review","displayOrder":6,"isClosed":false,"isWon":false },
  { "orgId":"org1","provider":"salesforce","entityType":"deal","pipeline":"Sales Process",
    "rawStage":"Closed Won","label":"Closed Won","displayOrder":8,"isClosed":true,"isWon":true }
]
```

### 5c. Resulting funnel charts — one per provider

`FunnelStageEvent` grouped by `(provider, pipeline, rawStage)`, ordered
using `PipelineStageDefinition.displayOrder`, dedupe within a provider by
chaining `convertedToRecordId` so one person isn't counted twice across
their lead+deal phases:

**HubSpot funnel (pipeline: default / contacts-default):**
```
lead (contact)              : 1   (hs-contact-501)
opportunity (contact)       : 1   (hs-contact-501)
Appointment Scheduled (deal): 1   (hs-deal-9001)
Contract Sent (deal)        : 1   (hs-deal-9001)
Closed Won                  : 0
```

**Salesforce funnel (pipeline: leads-default / Sales Process):**
```
Open - Not Contacted : 1   (sf-lead-77)
Working - Contacted  : 1   (sf-lead-77)
Qualified             : 1   (sf-lead-77)
Prospecting            : 1   (sf-opp-3300)
Negotiation/Review     : 1   (sf-opp-3300)
Closed Won              : 0
```

No merged totals across providers — each funnel stands alone, in that
provider's own stage language. Chart query branches only on `provider` to
pick which `PipelineStageDefinition` rows to order by; it never touches a
mapping table.

## 6. How rows get written (sync-time logic)

Two independent writes per sync pass:

- **`FunnelStageEvent`** (per-record, every sync): fetch the CRM's
  stage-history (or current value only, if history isn't available — see
  gaps in §4), diff against `rawStage`+`enteredAt` pairs already stored for
  that `providerRecordId` (the unique index makes this a cheap
  insert-or-ignore), insert any new transitions as new rows. The existing
  `Contact.lifecycleStage` / `Deal.dealstage` fields keep holding the
  *current* stage exactly as today — `FunnelStageEvent` is additive, it
  doesn't replace those fields.
- **`PipelineStageDefinition`** (pipeline metadata, not per-record):
  refreshed by one metadata call per pipeline per sync job (HubSpot
  Pipelines API / property definitions; Salesforce `OpportunityStage` /
  `LeadStatus` SOQL), upserted by its own unique key
  `(orgId, provider, entityType, pipeline, rawStage)`. Cheap and
  infrequent compared to record syncing — doesn't need to run on every
  incremental sync, just needs to exist before the funnel chart is queried
  and be refreshed if the client reconfigures their pipeline.

## 7. Extensibility — adding a future CRM

Because the design is provider-agnostic by construction, a new CRM (lead→deal
style, like Salesforce) only needs to supply:

1. **Raw stage source** — whatever field(s) hold lead-status and
   deal/opportunity-stage in that CRM's API. Flows straight into
   `FunnelStageEvent.rawStage`, no transformation.
2. **Stage metadata source** — whatever that CRM exposes for stage order
   and closed/won status (every mainstream CRM has an equivalent of
   HubSpot's Pipelines API or Salesforce's `OpportunityStage` object).
   Feeds `PipelineStageDefinition`. `FunnelStageEvent` schema, sync loop
   shape, and funnel chart query are otherwise untouched.
3. **Conversion link field**, if that CRM splits lead/deal like Salesforce
   — mapped to `convertedToRecordId`. If the CRM doesn't split (deal exists
   standalone, like HubSpot), skip this — funnel just starts at the deal
   pipeline's first stage.

Funnels stay per-provider by design, so a new provider never requires
touching another provider's mapping — there is no shared mapping to touch.

**Exception: finance providers (QuickBooks).** No lead/opportunity concept
at all (`Customer`/`Invoice`, not CRM stages) — out of scope for this table
entirely, consistent with the `crm-integrations` skill's note that
QuickBooks' entity shape differs fundamentally from a CRM's.

## 8. Open decisions (need sign-off before implementation)

- **History storage**: standalone `FunnelStageEvent` collection (this doc's
  assumption) vs. keeping embedded arrays as-is. Recommended: standalone
  collection — one query shape for the funnel chart regardless of provider,
  and it's what lets `PipelineStageDefinition` join cleanly.
- **Stage metadata refresh cadence**: refresh `PipelineStageDefinition`
  every sync job (simplest, slightly wasteful) vs. only on first
  connect + manual "resync pipeline config" action vs. detecting pipeline
  changes some other way. Recommended: every sync job — call is cheap,
  avoids stale labels/order silently drifting from the client's real CRM
  config.
- **Scope/timing**: build `FunnelStageEvent` + `PipelineStageDefinition` now
  against existing HubSpot data (funnel chart works today, Salesforce just
  plugs in later) vs. wait until Salesforce sync work actually starts.
  Recommended: build now, avoids a second migration later.
- **Naming**: keep `Deal` model name vs. rename to `Opportunity`. No
  functional need either way — `Deal` already provider-agnostic via
  `provider`+`providerRecordId`. Recommended: keep `Deal`, avoid churn
  across `deal.repository.ts`, `sync.service.ts`, `analytics.service.ts`,
  `analytics.controller.ts`, frontend `syncApi.ts`.
