# SherpAI Metrics — Build Progress & Gap Tracker

Companion to `sherpai-metrics-implementation-guide.md` (the field-level data lookup) and
`SherpAI Metrics Guide- MVP-v1.0.pdf` (the client's metric definitions). That guide says *what
data each metric needs*; this document tracks *what's actually been built*, what was
deliberately deferred and why, and what's next — so a future session can resume without
re-reading the whole implementation history.

Update this file at the end of every phase: move metrics from "Not started" to "Done", add new
entries to the gap list, don't delete resolved gaps — mark them done with the date/phase.

---

## 1. Status by metric ID

| ID | Metric | Status | Notes |
|---|---|---|---|
| VC-01 | Gross Revenue Retention Rate | **Done (Phase 1)** | Salesforce "why" enrichment (`Opportunity.Type='Churn'`) not built — G-2 |
| VC-02 | Net Revenue Retention Rate | **Done (Phase 1)** | |
| VC-03 | New-Logo Revenue Growth Rate | **Done (Phase 4)** | Built from the QuickBooks roll-forward alone, not Salesforce `Type='New Business'` — G-20 |
| VC-04 | COGS % and Mix | **Done (Phase 2)** | Rate/mix decomposition implemented; no peer/plan benchmark (G-14) |
| VC-06 | CAC & Payback Period | **Done (Phase 2)** | Blended only, no Salesforce channel breakdown (G-16) |
| VC-07 | LTV:CAC (New Customers) | **Done (Phase 2)** | |
| VC-09 | G&A as % of Revenue | **Done (Phase 2)** | Flag never fires — needs peer/plan data (G-14) |
| VC-10 | EBITDA Margin Trend | **Done (Phase 2)** | Only the "2 quarters shrinking" flag leg fires (G-14) |
| VC-12 | Recurring Revenue % of Total | **Done (Phase 2)** | Account-name heuristic, not invoice-line cross-checked (G-4, G-13) |
| VC-13 | Revenue Growth Rate (Recurring vs. Non-Recurring) | **Done (Phase 2)** | Plan-relative flag leg unavailable (G-14) |
| VC-14 | LTV:CAC (Whole Base) | **Done (Phase 2)** | "2 quarters running" trend approximated (G-17) |
| CB-05 | Cash Position & Runway | **Done (Phase 3)** | New daily `CashBalanceSnapshot` table; runway/burn-rate degrade gracefully against sparse (non-daily) sync history — G-15b |
| CB-07 | Free Cash Flow Conversion | **Done (Phase 3)** | Flag can never fire — needs leverage (CB-01), permanently deferred — G-19 |
| CB-10 | Cash Conversion Cycle | **Done (Phase 3)** | Report-shape assumptions unverified against a live sandbox — G-18 |
| CM-02 | Customer Concentration (Top-10 Revenue %) | **Done (Phase 4)** | Groups via QuickBooks `Customer.ParentRef` only, not Salesforce `Account.ParentId` (now synced but unused) — G-21 |
| CM-03 | Competitive Win Rate | **Done (Phase 7 + Post-Phase-7)** | Both custom-field **and** `OpportunityCompetitor` junction-object modes supported — G-24 resolved |
| CM-04 | Pipeline Coverage Ratio | **Partial (Phase 5)** | Numerator (qualified pipeline) computed; ratio structurally blocked — no operating-plan target exists at all (G-14) |
| CM-05 | Marketing-Sourced Pipeline & Revenue % | **Done (Phase 6)** | HubSpot-only (no Salesforce equivalent) — G-23 |
| CM-06 | Funnel Conversion Rates | **Done (Phase 5)** | Fixed HubSpot-lifecyclestage-name mapping, not per-org configurable — G-22 |
| CM-07 | Marketing ROI by Channel | **Done (Phase 6)** | Blended only — no per-channel breakdown, ad-spend connector out of MVP scope (G-16b) |
| CM-08 | Lead Volume vs. Plan (MQL Flow) | **Done (Phase 5 + Post-Phase-7)** | Growth/decline legs fully computed, act-now leg no longer wrongly gated behind the watch leg's two-month streak; plan-vs-actual variance unavailable (G-14) |

Deferred out of MVP scope entirely (per the guide's own gating — do not build against
substitute data): VC-05, VC-08, VC-11, VC-15, CB-01–04, CB-06, CB-08, CB-09, CB-11–15, CM-01,
all of RC and ER.

---

## 2. What shipped

### Phase 1

- QuickBooks `Customer` + `Invoice` sync (`backend/src/modules/sync/model/{QuickBooksCustomer,Invoice}.model.ts`,
  `QuickBooksService.getCustomers/getInvoices`). `quickbooks` added to `SYNC_IMPLEMENTED_PROVIDERS`.
- Shared customer revenue roll-forward (`backend/src/modules/metrics/service/revenueRollForward.service.ts`)
  — the building block every QuickBooks-revenue metric reuses.
- `GET /api/v1/metrics/vc-01`, `GET /api/v1/metrics/vc-02` — full flag logic per the PDF's exact
  wording, honest-numbers rule (`null` not `0` when uncomputable).
- QuickBooks dashboard tab shows Customers/Invoices counts + metric cards instead of the
  HubSpot/Salesforce-shaped Contacts/Deals/Funnels UI that never applied to it.
- Removed dead API: `GET /analytics/:provider/owners` (zero frontend callers) + its
  controller/service/repository code.

### Phase 2

- **QuickBooks Profit & Loss report client** (`QuickBooksService.getProfitAndLossReport`). A P&L is
  QuickBooks' own point-in-time aggregate over its underlying transactions (Bills, Journal Entries,
  ...); pulling *the report itself* instead of reconstructing one from a locally-synced transaction
  stream avoids reimplementing QuickBooks' own accounting rollup. This also means **no
  Bill/Vendor/JournalEntry sync was built** — none was needed.
- **P&L report parser** (`metrics/service/plParser.ts`) — walks QuickBooks' recursive Rows/Summary
  report tree into flat Income/COGS/Expenses/OtherExpenses line-item lists, using QuickBooks' own
  section grouping (no guessing which rows are revenue vs. COGS). Unit-tested against a hand-built
  fixture shaped like a real QuickBooks report response.
- **Expense/income classification heuristic** (`classifyExpenseAccount`, `isRecurringIncomeAccount`
  in the same file) — keyword-based default for which expense accounts are sales & marketing vs.
  G&A vs. D&A, and which income accounts are recurring. This is the MVP starting point for what the
  PDF calls a "one-time reviewable mapping per company" — see G-13, it isn't yet a real per-org
  config a user can edit.
- **8 new metrics**: VC-04, VC-06, VC-07, VC-09, VC-10, VC-12, VC-13, VC-14
  (`metrics/service/plMetrics.service.ts`), all operating at **quarter grain** (not monthly-value +
  quarterly-flag like VC-01/02 — the PDF's own cadence for these is "monthly once books close;
  checked quarterly," and collapsing to one quarterly figure matches how PE portfolio reporting
  actually consumes them), reachable at `GET /api/v1/metrics/vc-{04,06,07,09,10,12,13,14}`.
- Dashboard's QuickBooks tab now shows all 10 metric cards (VC-01/02 from Phase 1 + the 8 above)
  in a responsive grid, each formatted by its actual unit (%, months, "x" multiple).

### Phase 2b — `PLSnapshot` storage (superseded the initial live-call design)

Phase 2 originally called the QuickBooks P&L report **live** on every metrics request. After
discussion (2026-08-22) this was replaced before shipping: P&L data is now **synced and stored**,
same as Customer/Invoice, resolving gap G-15 (rate-limit/latency risk from ~20 live calls per
dashboard view) up front rather than leaving it as a deferred gap.

- **`PLSnapshot`** (`sync/model/PLSnapshot.model.ts`) — one row per `(orgId, provider, quarterStart)`,
  storing the exact `ParsedProfitAndLoss` shape (Class-summarized, so it covers both the headline
  company-wide figures and the per-product Mix % breakdown from one snapshot). Overwritten in place
  on each resync — no version history yet (same gap as G-13's mapping-versioning note).
- **`syncQuickBooksProfitAndLoss`** (new step in `sync.service.ts`'s QuickBooks branch) — pulls the
  trailing 6 quarters (18 months) every sync run. That window covers every P&L metric's furthest
  back-reference (VC-12/13's year-ago-quarter comparison, 4 quarters back) with a quarter of buffer.
  `SyncJobDocument.entities.plSnapshots` tracks its progress, same pattern as `customers`/`invoices`.
- **`plMetrics.service.ts` now reads exclusively from storage** via `plReport.service.ts`'s
  `getStoredProfitAndLoss(orgId, provider, quarterStart)` — never a live QuickBooks call at
  request time. Honest-numbers handling: the **requested/current** quarter missing its snapshot
  makes the whole metric `computable: false`; a **comparison** quarter (prior quarter, year-ago
  quarter) missing just drops that one comparison leg — e.g. VC-04 still returns this quarter's
  COGS % even if last quarter's snapshot isn't synced yet, it just can't say whether it rose or fell.
  VC-14 goes further: if *any* of the 4 trailing quarters used for trailing-12-month CAC is missing,
  the whole CAC figure goes `null` rather than silently treating that quarter's S&M spend as $0
  (which would understate CAC — worse than admitting the number isn't known).
- No scheduler exists yet — this only refreshes on OAuth-connect or a manual resync click, same as
  every other synced entity. A future cron/repeatable job (BullMQ + Redis are already dependencies)
  just needs to call the same sync path more often; no metric-side changes required when that ships.
- 31 backend unit tests now cover this (parser/classifier fixtures, mocked-snapshot metric-formula
  tests, and 3 new tests specifically for the missing-snapshot honest-numbers behavior) — 54 total
  passing.

### Phase 3 — CB-05, CB-07, CB-10

- **5 new QuickBooks report clients** (`QuickBooksService.getBalanceSheetReport` /
  `getCashFlowReport` / `getAgedReceivablesReport` / `getAgedPayablesReport` /
  `getInventoryValuationSummaryReport`), all thin wrappers over a shared private `getReport` helper
  — same refactor also cleaned up `getProfitAndLossReport` to use it.
- **`metrics/service/reportParser.ts`** — `extractSectionTotals` (for Balance-Sheet/Cash-Flow-shaped
  grouped reports) and `extractFlatReportGrandTotal` (for Aging/Inventory-shaped flat reports).
  Lighter than `plParser.ts` since these metrics only need pre-computed totals, not line-item detail.
  Unit-tested against hand-built fixtures — but see G-18, these fixtures encode assumptions about
  QuickBooks' report shape that a live sandbox never confirmed.
- **`PLSnapshot` widened** with `accountsReceivable`/`accountsPayable`/`inventoryValue` (as of each
  quarter's end date) and `operatingCashFlow`/`capEx` (over each quarter) — same per-quarter row as
  the P&L data, fetched in the same sync pass. Each of the 4 extra report calls is independently
  try/caught during sync so one failing doesn't break the P&L snapshot.
- **`CashBalanceSnapshot`** (`sync/model/CashBalanceSnapshot.model.ts`) — new, *daily*-keyed model
  (CB-05 is the only metric in the framework checked daily). `syncQuickBooksCashBalance` pulls the
  Balance Sheet as-of today and stores the `BankAccounts` section total.
- **3 new metrics**: CB-05, CB-07, CB-10 (`metrics/service/cbMetrics.service.ts`), reachable at
  `GET /api/v1/metrics/cb-{05,07,10}`. CB-07/CB-10 are quarter-grain like the VC metrics; CB-05 reads
  `CashBalanceSnapshot` directly and has no `?period=` (always "as of the latest sync").
- Dashboard's QuickBooks tab now shows all 13 metric cards.
- 15 new backend unit tests (`reportParser.test.ts`, `cbMetrics.test.ts`) — 69 total passing.

### Phase 4 — VC-03, CM-02, and the Salesforce Opportunity/Account widening

- **Salesforce `Opportunity` SOQL widened**: `Type`, `LeadSource`, `CampaignId`, `AccountId` added
  (were previously not pulled at all — one of the "three standing facts" the original implementation
  guide called out). `Deal.model.ts` gained matching optional fields (`type`/`leadSource`/
  `campaignId`/`accountId`) — undefined on HubSpot-sourced deals, same pattern as other
  provider-specific fields.
- **New `SalesforceAccount` sync** (`Id`/`Name`/`ParentId` only, narrow) — `SalesforceService.getAccounts`,
  `syncSalesforceAccounts` in `sync.service.ts`, new tenant model + repository. Built as Phase 4's
  stated deliverable for CM-02, but see G-21 below — CM-02 ended up not needing it.
- **VC-03** (`metrics.service.ts`, alongside VC-01/02) — built entirely from the same QuickBooks
  roll-forward VC-01/02 already use (`newLogoRevenue`, which was already being computed there). The
  PDF's Salesforce `Opportunity.Type='New Business'` cross-check ("confirm the customer really is
  new") is skipped, same scoping choice as VC-01's G-2. Quarter-over-quarter growth, with the one
  plan-independent flag leg ("growth rate itself declined two quarters running") implemented as an
  act-now condition — see G-20 for the exact interpretation.
- **CM-02** (`metrics/service/cmMetrics.service.ts`, new file) — trailing-12-month revenue grouped by
  QuickBooks `Customer.ParentRef` (already synced since Phase 1), walking each customer up to its
  root ancestor before summing. Salesforce `Account.ParentId` (just synced above) turned out to be
  unnecessary for this — QuickBooks' own hierarchy needs no fuzzy name-matching against a separate
  Salesforce record and was sufficient on its own. See G-21.
- Dashboard's QuickBooks tab now shows all 15 metric cards.
- 23 new backend unit tests (`metrics.test.ts` VC-03 cases, `cmMetrics.test.ts`) — 77 total passing.

### Phase 5 — CM-04, CM-06, CM-08 (the funnel-role mapping phase)

The rare phase where the raw data was already fully synced (Phase 1's `FunnelStageEvent`/
`PipelineStageDefinition`) — the whole gap really was just the mapping, exactly as G-7 predicted.
No new sync work at all; two new read-side repository methods instead.

- **`funnelStageEventRepository.countRecordsEnteringStage`** (new) — a plain in-range count of
  records whose event for a given stage falls in a date window, *not* cohort-scoped. Added
  alongside the already-existing `getCohortRecordIds`/`getStageMembershipCounts` (both reused
  as-is from the funnel-chart work) because CM-08 asks a different question than CM-06 ("how many
  crossed the MQL line this month" vs. "of leads who started this month, how many became MQLs").
- **Funnel-role mapping** (`metrics/service/cmMetrics.service.ts`) — `LEAD_STAGE`/`MQL_STAGE`/
  `SQL_STAGE`/`WON_STAGE` mapped directly from HubSpot's own standard `lifecyclestage` value names
  (`lead`/`marketingqualifiedlead`/`salesqualifiedlead`/`customer`). A fixed default, not a
  per-org config — see G-22.
- **CM-06** — cohort-based Lead→MQL→SQL→Won rates, 2-month maturation buffer, minimum-cohort-size
  gating (100 leads / 30 MQLs) per the PDF, full flag logic including the "MQL→SQL below half its
  prior rate" act-now condition.
- **CM-08** — MQL count + period-over-period growth, "declining two months running" flag (watch),
  upgraded to act-now when CM-06 is *also* deteriorating in the same window (computed by calling
  `computeCM06` internally) — genuinely faithful to the PDF here, no plan data needed for either leg.
- **CM-04** — the qualified-pipeline numerator is real (qualified-stage-cutoff heuristic: within
  each open pipeline, every open stage except the lowest-`displayOrder` one counts as qualified),
  but the ratio itself is always `computable: false` — unlike other metrics' plan-relative *flag*
  legs, CM-04's target is the ratio's *denominator*, so there's no partial version to ship without
  operating-plan data (G-14). New `dealRepository.findByCloseDateRange` backs the numerator query.
- CM-04/06/08 are the first metrics that vary by which CRM's funnel to read — `?provider=hubspot|
  salesforce` on the route (default hubspot), and on the dashboard they now show on the HubSpot/
  Salesforce tabs instead of the QuickBooks tab every other metric lives on.
- 7 new backend unit tests (`cmMetrics.test.ts`) — 84 total passing.

### Phase 6 — CM-05, CM-07 (marketing attribution, HubSpot-only)

- **HubSpot pull widened**: Contact gains `hs_analytics_source` (original traffic-source channel),
  Deal gains `createdate` (`dealCreatedAt` — the CRM's actual deal-creation date, distinct from
  Mongo's own `createdAt` sync-time timestamp). `Contact.analyticsSource`/`Deal.dealCreatedAt` are
  undefined on Salesforce-sourced records — no equivalent field exists there (see G-23).
- **New repository reads**: `contactRepository.findSourcesByProvider` (id + source per contact) and
  `dealRepository.findByCreateDateRange` (deals created in a window, for CM-05's "qualified pipeline
  created this period" — distinct from `findByCloseDateRange`'s "closing/closed this period").
- **`resolveQualifiedStageKeys`** — CM-04's inline qualified-stage heuristic extracted into a shared
  function, now reused by CM-05's pipeline leg.
- **CM-05** (`cmMetrics.service.ts`) — trailing-12-month marketing-sourced-pipeline % and
  marketing-sourced-revenue %, first-touch attribution via `Deal.contactIds` → `Contact.analyticsSource`
  join (`MARKETING_SOURCES` set — HubSpot's own `hs_analytics_source` enum values, confirmed live
  against a connected portal). Data-quality gate: if >25% of qualified pipeline has no resolvable
  source, the watch flag is held back rather than firing on unreliable attribution. HubSpot-only by
  design — see G-23.
- **CM-07** (`cmMetrics.service.ts`) — Pipeline ROI (marketing-sourced pipeline ÷ marketing spend) and
  Profit ROI (marketing-sourced revenue × gross margin % ÷ marketing spend), reusing CM-05 internally
  for the numerators and the new `grossMarginFromPL` export from `plMetrics.service.ts` for margin.
  Ships blended-only — no per-channel breakdown, same ad-spend-connector gap as G-16b. Not computable
  without a synced `PLSnapshot` for the quarter (same sync-and-store rule as every P&L-derived metric).
- Dashboard: CM-05/CM-07 cards render only on the HubSpot tab (not Salesforce, not QuickBooks),
  alongside CM-04/06/08.
- 18 new backend unit tests (`cmMetrics.test.ts`) — 90 total passing.

### Phase 7 — CM-03 (per-org competitor-field config — the first org-level settings feature)

The first metric needing genuine per-org configuration rather than a fixed default or a synced
field — Salesforce has no single standard field for "which competitor was in this deal" (metrics
guide gap G-11). This phase introduces the app's first org-level settings concept.

- **`Organization.settings.salesforceCompetitorField`** (`organizations/model/Organization.model.ts`)
  — new optional sub-document on the `Organization` model (previously just `name`/`slug`/`status`/
  `dbName`). Holds the Salesforce Opportunity custom field API name (commonly `Competitor__c`).
  `undefined` means competitor tracking isn't configured — CM-03 reports `computable: false` rather
  than guessing at a field name, same honest-numbers rule as every other MVP gap.
- **`GET`/`PATCH /api/v1/organizations/settings`** — the app's first settings read/write endpoint
  (previously only `POST /organizations` existed). `GET` is any-org-member; `PATCH` is owner/admin-
  gated (`requireRole`), same split as the sync module's manual-trigger endpoint. The validator
  (`updateOrganizationSettingsSchema`) enforces a strict Salesforce field-name regex
  (`^[A-Za-z][A-Za-z0-9_]*$`) before the value can ever reach a SOQL string — re-validated a second
  time inside `SalesforceService.getOpportunities` (belt-and-suspenders, since this is the first
  place in the app where an org-configurable value gets interpolated into a query string) —
  `PATCH` with `salesforceCompetitorField: null` clears the setting.
- **`SalesforceService.getOpportunities` widened** to accept an optional `competitorField` and
  append it to the SOQL SELECT list; the raw dynamic-name response field is normalized onto a fixed
  `Competitor` property so callers never touch the dynamic field name directly.
- **`Deal.competitor`** (new optional field, Salesforce-only, same pattern as `type`/`leadSource`) —
  populated by `syncSalesforceOpportunitiesAsDeals`, which now reads the org's configured field once
  per sync run (not per page) via `organizationsRepository.findById`.
- **CM-03** (`cmMetrics.service.ts`) — trailing-2-quarter (6-month) rolling win rate per named
  competitor: `Wins ÷ (Wins + Losses) × 100`, decided (closed won/lost) deals only, resolved via the
  same `PipelineStageDefinition` `isWon`/`isClosed` pattern CM-05 uses for its won-stage filter. Data-
  quality gate per the guide: alerts held back when fewer than 25% of decided deals have a competitor
  recorded. Watch flag: a competitor's win rate falls ≥10 points with ≥10 decided deals in *both* the
  current and prior 6-month window; escalates to act-now when the resulting win rate is also below
  30%. Top-level `value`/flag surface a blended figure (all named competitors combined) and the single
  worst-drop competitor; `data.competitors` carries the full per-competitor breakdown for drill-down.
- **Frontend**: new `Settings` page card ("Competitor tracking (Salesforce)") lets owners/admins type
  in the field name, shown only once Salesforce is connected; CM-03's card renders only on the
  Salesforce dashboard tab (not HubSpot/QuickBooks) — mirrors CM-05/07's HubSpot-only placement.
- Scoped to the custom-field mode only — the guide's other option, Salesforce's standard
  `OpportunityCompetitor` junction object (multiple competitors per deal), is a materially different
  shape (array, not a single field) and was deferred rather than guessed at — see new gap G-24.
- 7 new backend unit tests (`cmMetrics.test.ts`) — 97 total passing.

### Post-Phase-7 fix — open-quarter bug in VC-01/02/03 (found during manual validation, 2026-08-22)

`computeQuarterRollForward(orgId, provider, monthInQuarter)` resolves whichever quarter *contains*
`monthInQuarter` and always compares "month before quarter start" vs "quarter's 3rd month" — with no
check that the 3rd month has actually happened yet. VC-01/VC-02's flag legs and VC-03's entire value
called this with `month` (`period ?? latestClosedMonth()`) directly. Asking for an early-in-quarter
period (e.g. `period=2026-07`, July being Q3's first month) made it compare against **September**,
which had no invoices yet — not a sync gap, the month genuinely hadn't happened — and that read as a
false "100% collapse" (`growthPct: -100%`, near-0% `currentQuarterGrr`/`currentQuarterNrr`) instead of
an honest "this quarter isn't over yet."

**Fix**: new `latestClosedQuarterStart(month)` (`revenueRollForward.service.ts`) — resolves to the
quarter containing `month`, unless that quarter's last month is still in the future relative to
`latestClosedMonth()`, in which case it steps back one quarter. VC-01/VC-02 (`metrics.service.ts`)
now derive their "current quarter" flag inputs from this instead of raw `quarterStartOf(month)`; VC-03
uses it for its `quarterStart` (and therefore its `value` and the `period` it reports back — asking
for `period=2026-07` right now correctly returns `period: '2026-04'`, the latest quarter that's
actually closed, rather than a bogus Q3 number). All 97 existing tests still pass unchanged (none of
them exercised an open-quarter period). At the time, `plMetrics.service.ts`'s `PLSnapshot`-backed
metrics looked unaffected (they read a synced snapshot rather than reaching forward into un-synced
invoices) — that turned out to be wrong, see the next fix below.

### Post-Phase-7 fix — win-back customers miscounted as new logos (found during manual validation, 2026-08-23)

`computeRollForward`'s new-logo detection only ever compared a customer's revenue in the *two specific
months* being checked (e.g. March vs June) — $0 at the start, `>0` at the end, counted as "new." It
never looked further back than that, so a customer who churned long ago and came back within the
comparison window (a win-back) was indistinguishable from a genuinely brand-new customer, inflating
`newLogoRevenue`. This is exactly the corroboration the guide's own QuickBooks "first invoice date"
check exists to catch (VC-03's section) — it just wasn't built. Affects every consumer of
`RollForward.newLogoRevenue`/`newLogoCustomerCount`: VC-03 directly, and VC-06/VC-07/VC-14 indirectly
(via `computeUnitEconomicsCore`'s `newLogoCount`/CAC/LTV chain in `plMetrics.service.ts`) — none of
those three flagged it as a gap before now.

**Fix**: new `invoiceRepository.findCustomerIdsWithInvoiceBefore(orgId, provider, before)` — checks a
customer's *entire* invoice history, not just the comparison window. `computeRollForward`
(`revenueRollForward.service.ts`) now splits the old single "new logo" bucket into `newLogoRevenue`
(true new logos only) and a new `winBackRevenue`/`winBackCustomerCount` (customers with a prior
invoice further back) — win-back revenue still counts in `endingRevenue`, it's real revenue, just not
"new." VC-03 surfaces both `data.winBackRevenue`/`winBackCustomerCount` for transparency. VC-06/07/14
get more accurate `newLogoCount`/CAC/LTV automatically, no code change needed there. Still doesn't
implement the guide's other VC-03 cross-check (Salesforce `Opportunity.Type='New Business'`) — that
stays open as G-20. 98 backend tests passing (+1).

### Post-Phase-7 fix — same open-quarter bug, extended to every `PLSnapshot`-backed metric (2026-08-23)

Turned out the "no other quarter-grain metric shares this" claim above was wrong. `plMetrics.service.ts`
(VC-04/06/07/09/10/12/13/14), `cbMetrics.service.ts` (CB-07/10), and `cmMetrics.service.ts` (CM-07) all
resolved their "current quarter" the same unguarded way — `quarterStartOf(month)` directly. The failure
mode is quieter than VC-03's (no crash, no `-100%`): the **sync job itself** pulls a `PLSnapshot` for
the current, possibly still-in-progress quarter too (`quarterStartMonthsAgo(0)` in `sync.service.ts`),
calling QuickBooks' live Report API for a date range that can extend into the future. QuickBooks
doesn't error on that — it just returns whatever's posted so far. So a snapshot *exists*, `computable`
comes back `true`, and a **partial quarter's figures get silently presented as if the quarter were
final** — no "still accruing" marker anywhere.

**Fix**: every one of those `quarterStartOf(month)` call sites now uses `latestClosedQuarterStart(month)`
instead (VC-04/09/10/12/13/14's top-level `quarterStart`, `computeUnitEconomicsCore`'s internal one
shared by VC-06/07/14, and CB-07/10/CM-07's). CM-04 is the one deliberate exception — left on
`quarterStartOf` unchanged, since it's *supposed* to look at next quarter's pipeline (open deals'
`closedate` is inherently a future expected date, not a past actual — nothing to "close" first). All
98 tests still pass unchanged.

**Follow-up correction (same day):** the first pass above left `computeUnitEconomicsCore` (shared by
VC-06/07/14) and VC-14's own whole-base roll-forward call still passing the *raw, unclamped* month to
`computeQuarterRollForward` — only the `getQuarterPL`/`PLSnapshot` side had been switched to the safe
`quarterStart`. That meant the P&L half and the invoice-roll-forward half of the same metric could
silently reference **two different quarters** when asked about an in-progress period (e.g. VC-06's
CAC using Q2's S&M spend against Q3's new-logo count). Fixed by passing the already-resolved
`quarterStart` to both `computeQuarterRollForward` call sites instead of the raw month. 98 tests still
pass (none exercised this mismatch, since it only shows up when the two calls' resolved quarters
actually diverge — an in-progress-quarter request).

### Post-Phase-7 fix — VC-07's "declining two quarters running" only checked one quarter (found during manual validation, 2026-08-23)

Doc: *"Watch — below 3.0x, or above 3.0x but declining two quarters running."* Code only compared
`ratio < prevRatio` — a single quarter-over-quarter dip, not a genuine two-quarter losing streak. A
company on a strong multi-quarter rising trend (e.g. 3.0x → 4.0x → 5.0x → 6.0x) with one small, normal
dip afterward (6.0x → 5.8x) would false-fire a watch flag, even though nothing was actually trending
down. This wasn't previously tracked as a gap (VC-07's doc entry said "no gap beyond VC-01/04/06").

**Fix**: `computeVC07` now fetches a third `computeUnitEconomicsCore` call (two quarters back) and
requires `ratio < prevRatio && prevRatio < twoAgoRatio` — a genuine two-point declining sequence,
same pattern VC-10/VC-12 already use for their own "two quarters running" legs. 2 new tests
(`plMetrics.test.ts`) — one confirming the flag fires on a real two-quarter decline, one confirming a
single dip after a rise does *not* false-fire. 100 backend tests passing (+2).

### Post-Phase-7 fix — a flag could survive onto a "not computable" response (found during manual validation, 2026-08-23)

VC-13's `flag` was gated on `totalQoQ`/`recurringQoQ` (needs only the *previous* quarter's P&L), while
`computable`/`value` are gated on `totalYoY` (needs the *year-ago* quarter's P&L) — two independent
null-checks over two different comparison windows. If the year-ago snapshot was missing (common for
an org whose sync history doesn't reach back a full year yet) but the previous-quarter snapshot
existed, the card would show "Not computable" as its headline **and** a watch flag underneath it —
contradictory, since `MetricCard.tsx` renders `metric?.flag` unconditionally, with no check on
`computable`.

Auditing every other metric for the same shape (a flag branch whose own null-guard doesn't match
`computable`'s) found two more real instances:
- **VC-01** (`metrics.service.ts`) — flag gated on `currentQuarterGrr !== null` (quarterly roll-forward),
  `computable` gated on `monthlyGrr !== null` (monthly roll-forward) — different windows, same
  independence bug.
- **CB-10** (`cbMetrics.service.ts`) — the `collectionsSlowedQoQ` flag branch checked only
  `legs.daysToCollect !== null`, never `legs.cycle !== null` (what `computable` depends on) — a missing
  `accountsPayable`/`inventoryValue` report can null out `legs.cycle` while `daysToCollect` alone still
  resolves fine.

**Not the same bug, on reflection:** CB-05's single-day-drop flag is independent of `runwayMonths` too,
but that's by design, not a bug — a big one-day cash drop is a genuinely separate, still-meaningful
alert even for a self-funding company with no computable "runway" (its own `data.selfFunding` field
already exists to distinguish that case from a real gap). Left unchanged.

**Fix**: VC-13/VC-01/CB-10 now gate their flag logic on the same variable `computable` depends on. 2 new
regression tests (`metrics.test.ts`, `cbMetrics.test.ts`) confirming a flag never survives when the
relevant figure isn't computable. 102 backend tests passing (+2, on top of VC-07's +2 above).

### Post-Phase-7 build — CB-07's PDF-mandated Balance-Sheet-derived FCF fallback (2026-08-23)

Doc's own "Gap & fix" for CB-07: *"Where a company's books can't produce a reliable Cash Flow
statement (common at smaller mid-market companies), fall back to deriving FCF from Balance Sheet
period-over-period changes instead and mark the result as derived rather than primary-source — this
fallback is specified by the PDF itself, not a workaround invented here."* This didn't exist — when
the Cash Flow report was unavailable, CB-07 just went straight to `computable: false`, with no
fallback attempted at all. Not previously tracked as its own gap (only G-19, the separate leverage
cross-check, was documented for CB-07).

**What the fallback actually does** (standard indirect-method accounting):
- **Operating Cash Flow proxy** = EBITDA, adjusted for the quarter-over-quarter change in working
  capital — an A/R or Inventory *increase* is cash stuck outside the business (subtract it); an A/P
  *increase* is cash you get to keep longer (add it).
- **CapEx proxy** = the change in Net Fixed Assets versus last quarter, **plus** this quarter's D&A
  added back (fixed assets shrink from depreciation alone even with zero new spending, so the raw
  balance-sheet delta alone understates real capital spending).

**What was missing to build it**: `accountsReceivable`/`accountsPayable`/`inventoryValue` were already
synced (built for CB-10), but **no Net Fixed Assets figure existed anywhere** — not because it's hard
to get, but because the Balance Sheet report is already called daily for CB-05 (to read its
`BankAccounts` section for cash) and its `FixedAssets` section was simply never read out or persisted.

**Built**:
- `PLSnapshot.netFixedAssets` (new field, `PLSnapshot.model.ts` + `plSnapshot.repository.ts`) — as-of
  the quarter's end date, sourced from the Balance Sheet report's `FixedAssets` section total
  (`extractSectionTotals`), fetched once per quarter alongside the existing Aging/Cash-Flow calls in
  `syncQuickBooksProfitAndLoss` (`sync.service.ts`) — same report CB-05 already calls, previously
  discarding everything except `BankAccounts`.
- `balanceSheetDerivedFcf` (`cbMetrics.service.ts`) — the indirect-method calculation above, requires
  *both* quarters' A/R, A/P, Inventory, and Net Fixed Assets to all be defined (a comparison this
  indirect shouldn't be attempted on a partial data set); returns `null` otherwise.
- `computeCB07` now tries the primary Cash-Flow-report path first, falls back to the Balance-Sheet
  derivation only when the primary path's `operatingCashFlow`/`capEx` are undefined, and reports
  `data.sourceQuality: 'quickbooks-primary' | 'balance-sheet-derived' | null` so the result always says
  which one produced it — matching the doc's "mark the result as derived" instruction exactly.
- **Caveat, same category as G-18**: the `FixedAssets` group name is a documented-but-unverified
  QuickBooks Balance Sheet section name, same unverified-against-a-live-sandbox risk as
  `BankAccounts`/`OperatingActivities`/`InvestingActivities` already carry.
- 2 new tests (`cbMetrics.test.ts`) — one confirming the fallback fires with correct math, one
  confirming it still refuses to compute when the *prior* quarter also lacks Balance Sheet data.
  104 backend tests passing (+2).

### Post-Phase-7 fix — CB-07's fallback wrongly blocked on a no-inventory company (found on real data, 2026-08-23)

`balanceSheetDerivedFcf` required `inventoryValue` to be defined on *both* quarters before computing
anything at all — but plenty of real businesses (most SaaS companies among them) genuinely carry no
inventory, and CB-10 already correctly treats that as a legitimate `0`, not a data gap. Found by
walking a real connected org's data end-to-end: every quarter had `capEx` missing (so the primary path
never ran) *and* no `inventoryValue` at all (no inventory tracking), so the fallback was blocked twice
over even though A/R, A/P, and Net Fixed Assets were all present and sufficient to compute a real
number.

**Fix**: inventory now defaults to `0` on both sides of the working-capital calculation when absent,
same rule CB-10 already applies — A/R, A/P, and Net Fixed Assets stay hard requirements (their absence
much more plausibly means "the report genuinely failed" than "this business structurally has none").
1 new test (`cbMetrics.test.ts`) covering a company with no inventory report on either quarter.
105 backend tests passing (+1).

### Post-Phase-7 build — CM-03's `OpportunityCompetitor` junction-object mode (G-24, 2026-08-23)

Found while validating CM-03 against a real connected org: its Salesforce data was seeded using the
**standard `OpportunityCompetitor` object**, not a custom field — meaning CM-03 (custom-field mode
only, per Phase 7's original scoping) could never produce a real number for it, no matter what field
name got configured. This is exactly the G-24 gap, now resolved.

**Built**:
- `Organization.settings.salesforceCompetitorSource: 'field' | 'junction'` — the explicit per-org mode
  choice the guide's own gap description called for, alongside the existing `salesforceCompetitorField`
  (now only meaningful in `'field'` mode). `updateOrganizationSettingsSchema` requires the field name
  whenever `'field'` mode is selected, via a zod `.refine`.
- `SalesforceService.getOpportunityCompetitors` — batch-resolves `OpportunityId → CompetitorName[]` from
  the `OpportunityCompetitor` object, same batching pattern as `getConvertedLeadIdsByOpportunity`.
- `Deal.competitors?: string[]` (new field, alongside the existing single-value `competitor`) —
  populated by `syncSalesforceOpportunitiesAsDeals` only in `'junction'` mode; the query is wrapped in
  `.catch(() => ({}))` at the sync call site so an org that doesn't actually use this object can't break
  the whole sync over it.
- `buildCompetitorStats` (`cmMetrics.service.ts`) now reads *either* `deal.competitor` (single, field
  mode) or `deal.competitors` (array, junction mode) uniformly — a multi-competitor deal credits a
  win/loss to **every** competitor it names (a deal that beat both Competitor A and Competitor B is a
  win against both), while still counting as one deal for the "share of deals with a competitor
  recorded" data-quality check.
- Frontend: the Settings page's competitor-tracking card is now a mode selector (Not tracked / Custom
  field / Standard Competitors related list) instead of a bare text input — the field-name box only
  shows in "Custom field" mode.
- 2 new tests (`cmMetrics.test.ts`) — junction mode computing correctly without any field name
  configured, and 'field' mode still correctly reporting `configured: false` if the source is set but
  no field name was saved. 107 backend tests passing (+2).

### Post-Phase-7 fix — changing competitor-tracking settings needs a forced resync, and nothing told anyone that (found on real data, 2026-08-23)

Confirmed live: an org that was already connected and synced *before* configuring competitor
tracking got `decidedDealsCurrent: 10, decidedDealsWithCompetitorCurrent: 0` after an ordinary
"Sync now" — the setting change doesn't touch Salesforce, so incremental sync's `LastModifiedDate`
filter never revisits already-synced Opportunities to backfill `Deal.competitor`/`competitors` onto
them. This isn't unique to competitors — any newly-added synced field has this same backfill gap
(already documented for HubSpot's `dealStageHistory`) — but there was no way for an actual admin to
know a forced resync was needed, or how to trigger one (no UI for it at all; we only fixed it here
by hand-crafting a `?force=true` request).

**Fix**: `updateOrgSettings` (`organizations.service.ts`) now automatically fires a forced Salesforce
resync (fire-and-forget, same pattern as the OAuth-callback's post-connect sync kickoff) whenever
competitor-tracking settings are saved — the org doesn't need to know backfilling is even a concept.
Only fires if Salesforce is actually connected; `syncService.startSync`'s existing concurrent-sync
guard makes this safe to call even if a sync is already running. No new gap number needed — this
closes the loop on the *general* newly-added-field-backfill pattern for this one settings-driven case,
though the underlying pattern (a settings change silently needing a resync) could recur for a future
setting and should get the same treatment.

### Post-Phase-7 fix — CM-06's flag baseline was a single noisy month, not a trailing average (G-22, 2026-08-23)

Doc: *"Watch — any stage's conversion down >20% vs. **trailing 4-quarter average**... Act now —
MQL→SQL falls below half its **trailing average**."* Code compared each stage's current cohort
against only the single immediately-prior cohort month — same bug shape as the VC-07 fix earlier in
this session (one data point standing in for a proper baseline), except here it was already tracked
as part of G-22 rather than a fresh discovery.

**Fix**: new `computeTrailingAverageRates` (`cmMetrics.service.ts`) computes the trailing 4 monthly
cohorts (CM-06's natural monthly analog of the doc's "4-quarter" wording, since the metric itself
operates at monthly-cohort grain) and averages each stage's rate across whichever of those months
have data — a thin or missing month doesn't drag the average toward zero. All three flag legs
(`leadMqlDown`/`mqlSqlDown`/`sqlWonDown`/`mqlToSqlBelowHalf`) now compare against this average instead
of the single prior month. `data.trailingAvgMqlToSqlPct` surfaces the baseline for transparency. 2 new
tests (`cmMetrics.test.ts`) — one confirming the new average computes correctly, one specifically
proving a single unusually-strong prior month (which would have false-fired under the old logic) gets
correctly smoothed out and no longer triggers a flag. 108 backend tests passing (+2).

### Post-Phase-7 fix — CM-07's "declining" flag was a one-quarter comparison, not two (2026-08-23)

Doc: *"Watch — blended pipeline ROI below 5x (default) or **declining two quarters running**."*
`computeCM07`'s `declining` condition only compared the current quarter's pipeline ROI against the
single immediately-prior quarter — same bug shape as VC-07 and CM-06 above, found during the same
metric-by-metric sweep, not previously tracked under its own gap number.

**Fix** (`cmMetrics.service.ts`): added a `twoAgoQuarterStart` (`shiftMonth(quarterStart, -6)`) and a
third `computeCM05`/`getStoredProfitAndLoss` pair alongside the existing current/previous ones. A small
local `roiForQuarter` helper (shared by the previous- and two-ago-quarter calculations, to avoid
tripling the inline ROI-from-spend-and-pipeline logic) computes each quarter's pipeline ROI. `declining`
now requires the full two-step losing streak — `pipelineRoi < prevPipelineRoi && prevPipelineRoi <
twoAgoPipelineRoi` — and the flag reason spells out all three points (`"fallen two quarters running:
X → Y → Z"`) instead of just current-vs-previous. 2 new tests (`cmMetrics.test.ts`) mirroring VC-07's:
one with a genuine 3-point declining ROI sequence (10x → 8x → 6x, both still above the 5x target, to
isolate the declining branch from belowTarget) confirming the flag fires with the right reason text; one
with a rise then a small dip (6x → 12x → 11x) confirming that does *not* false-fire. 110 backend tests
passing (+2).

### Post-Phase-7 fix — CM-08's act-now leg was gated behind the watch leg's stricter condition (2026-08-23)

Doc: *"Watch — MQL volume >15% below plan for a month, or **declining two months running**. Act now —
>25% below plan for a full quarter, or **falling** while CM-06 also deteriorating."* Note the deliberate
wording difference: watch's non-plan leg says "two months running" (multi-period); act-now's non-plan
leg just says "falling" — no multi-period qualifier. `computeCM08` only ever checked CM-06 *inside* the
`decliningTwoMonthsRunning` branch, so a single bad month plus a red CM-06 never escalated — the
opposite failure mode from the VC-07/CM-06/CM-07 fixes above (those under-read a stated multi-period
requirement; this one over-required one that was never stated for this leg).

**Fix** (`cmMetrics.service.ts`): added `fallingThisMonth = current < previous` as an independent trigger
alongside `decliningTwoMonthsRunning` for deciding whether to even check CM-06. Act-now fires whenever
CM-06 is deteriorating and *either* condition holds, with the reason text distinguishing a genuine
two-month streak from a plain one-month drop; watch still only fires on the genuine two-month streak
(unchanged). 2 new tests (`cmMetrics.test.ts`): a single-month fall + red CM-06 now correctly escalates
to act_now, and a single-month fall with CM-06 healthy still produces no flag (a lone down month alone
was never a stated trigger). 112 backend tests passing (+2).

---

## 3. Open gaps (not silently glossed over — pick these up before/while building later metrics)

| ID | Gap | Why deferred | Unblocks / needed for |
|---|---|---|---|
| G-1 | No monthly/quarterly trend/series endpoint — every metric returns one period at a time (`?period=YYYY-MM`) | User explicitly deferred (2026-08-22). Now cheaper to build than originally scoped: `PLSnapshot` (added later in Phase 2) already stores one row per quarter, so a trend endpoint for the P&L metrics is mostly a read across existing rows, not new data collection | A trend chart (e.g. last 12 months/quarters plotted) |
| G-2 | VC-01's Salesforce "why" enrichment (`Opportunity.Type='Churn'` or an `Account` churn-date field) not built | PDF says it "can ship second"; this org's Salesforce `Type` picklist has no `Churn` value anyway | Richer "why did retention drop" alert narrative on VC-01 |
| G-3 | No per-org alert-threshold override store | PDF says every threshold is a firm-adjustable default; MVP hardcodes them | All metrics' flag logic |
| G-4 | Invoice sync stores per-invoice totals only, no line-item/Item/Class detail | VC-04/12 read the P&L report directly instead (see Phase 2 notes), so this stopped being a blocker for those — but the PDF's "double-checked against invoice lines at the customer level" cross-validation for VC-12 still isn't built | A stronger VC-12 (belt-and-suspenders check against Invoice line items) |
| G-5 | ~~No chart-of-accounts mapping~~ **Partially resolved (Phase 2)** — see G-13 for what's still missing | | |
| G-6 | ~~No customer dedup/grouping logic~~ **Resolved for CM-02 (Phase 4)** via QuickBooks `Customer.ParentRef` walk-to-root. VC-03 doesn't need dedup at all (it's pure QuickBooks revenue, not a Salesforce "is this account really new" check) | | |
| G-7 | ~~No funnel-role mapping~~ **Resolved for CM-04/06/08 (Phase 5)** via fixed defaults (see G-22 for what's still not per-org configurable). CM-05 still needs its own piece separately — see G-8 | | |
| G-8 | ~~HubSpot Contact pull missing `hs_analytics_source`~~ **Resolved (Phase 6)** — now synced onto `Contact.analyticsSource` | | |
| G-9 | No HubSpot Campaigns API integration (campaign cost) | Confirmed (earlier session, live portal probe) that the connected HubSpot OAuth scopes don't include Campaigns access, and ad-platform connectors (Google/Meta/LinkedIn) are permanently out of MVP scope — same root blocker as G-16b, not just a wider property list | Per-channel CM-07; blended-only ships instead (Phase 6), matching the PDF's own explicit MVP fallback wording |
| G-10 | ~~No Salesforce `Account`/`ParentId` sync, no `Opportunity.AccountId` link~~ **Resolved (Phase 4)** — both now synced (`SalesforceAccount` model, `Deal.accountId`) — but see G-21, CM-02 doesn't actually consume this yet | | |
| G-11 | ~~No per-org competitor-field configuration~~ **Resolved (Phase 7 + Post-Phase-7)** — `Organization.settings.salesforceCompetitorSource`/`salesforceCompetitorField`, editable via `PATCH /organizations/settings`. Both the custom-field case and the `OpportunityCompetitor` junction-object case (see G-24) are now handled | | |
| G-12 | ~~No QuickBooks report pulls~~ **Resolved (Phase 2 + Phase 3)** — P&L, Balance Sheet, Cash Flow, A/R/A/P Aging, and Inventory Valuation Summary are all synced now | | |
| G-13 | Expense/income classification (`classifyExpenseAccount`, `isRecurringIncomeAccount`) is a hardcoded name-keyword heuristic, not a per-org, user-editable, **versioned** mapping (the PDF explicitly requires versioning — "a mapping edit must never silently rewrite history"). Confirmed during manual validation (2026-08-23): `SALES_MARKETING_KEYWORDS` has no "ads" keyword (only "advertising"/"marketing"), so common real-world account names like "Facebook Ads"/"Google Ads" silently fall into `'other'`, understating VC-06's CAC and CM-07's Marketing ROI denominators. Same risk on the income side — `RECURRING_INCOME_KEYWORDS = ['subscription','recurring','maintenance','saas']` would miss "Monthly Plan Revenue," "Platform Fees," "License Revenue," understating VC-12/13's recurring share | Full settings UI + versioned-history store is real scope beyond MVP Phase 2 | Correctness for companies whose chart of accounts doesn't use recognizable keywords (e.g. no "G&A"/"Sales & Marketing" in account names) — currently such accounts silently fall into `'other'`/non-recurring and are excluded from the relevant category totals |
| G-14 | No operating-plan (revenue/MQL target) manual-input feature exists | PDF calls this "the one manual input," deliberately out of connector scope, but no upload/entry UI was built either | Every plan-relative flag leg across VC-04/06/09/10/13 (act-now conditions mostly need it) — they simply never fire today, `data.benchmarkAvailable:false` marks this. Peer-benchmark data is out of MVP scope entirely (needs the deferred market-data connector) |
| G-15 | ~~P&L-based metrics called the live QuickBooks Reports API on every request~~ **Resolved (Phase 2b)** — moved to a synced `PLSnapshot` store, read at request time instead. Sync itself still makes 6 report calls per QuickBooks sync (was ~20 per dashboard view before) | | |
| G-16 | VC-06/VC-07/VC-14's "new customers won" still comes from the QuickBooks invoice roll-forward (first-invoice inference), not Salesforce `Opportunity.Type='New Business'` | `Type`/`LeadSource`/`CampaignId` are now synced onto `Deal` (Phase 4), but VC-06 wasn't rewired to use them — the real remaining blocker is per-channel *ad spend*, which is a deferred connector regardless (see G-16b) | Consistency between VC-03/06/07/14's Salesforce field availability and what they actually read |
| G-16b | VC-06/CM-07's per-channel breakdown still can't be built even with `LeadSource`/`CampaignId` now synced (Phase 4) | Per-channel *cost* (the denominator) needs ad-platform spend (Google/Meta/LinkedIn), a connector entirely out of MVP scope — Salesforce fields alone only give deal counts/revenue by source, not spend | Nothing until an ad-platform connector exists; blended-only stays correct per the PDF's own explicit MVP fallback |
| G-17 | VC-14's watch flag ("fallen two quarters running AND at/below 3.5x") is approximated as just the level check (≤3.5x), not the two-quarter trend | A 5th quarter of roll-forward/P&L data would be needed on top of the 5 calls VC-14 already makes | A fully faithful VC-14 watch condition |
| G-18 | CB-05/07/10's report parsers (`reportParser.ts`'s `extractSectionTotals`/`extractFlatReportGrandTotal`) are written against *documented* QuickBooks Balance Sheet/Cash Flow/Aging/Inventory report shapes — no connected org existed in the session that built Phase 3, so none of this was verified against a live sandbox response. The `FixedAssets` Balance Sheet section name (added Post-Phase-7 for CB-07's fallback) carries the exact same unverified-assumption risk as `BankAccounts`/`OperatingActivities`/`InvestingActivities` | No org was connected when Phase 3 was built (databases had been reset for the metrics build-out) | Confidence that CB-05/07/10 actually return correct numbers — verify against a real synced QuickBooks company before trusting these in front of a client, and adjust the group-name/column-matching assumptions if QuickBooks' actual response shape differs |
| G-19 | CB-07's act-now flag leg ("conversion <30% while leverage is above target") can never fire — it depends on CB-01 (leverage), which is entirely out of MVP scope (deferred connector), not just missing config like G-14's plan-relative legs | The PDF itself flags this exact dependency: "this cross-check can't fire until leverage ships — note the dependency, don't silently drop the condition" | Nothing until CB-01 ships in some future framework version beyond this MVP |
| G-15b | `CashBalanceSnapshot` is keyed by calendar day (matching CB-05 being checked daily per the PDF), but without a scheduler it only gets a new row on OAuth-connect/manual-resync — sparse, not truly daily. Runway/burn-rate math degrades gracefully against whatever gap exists between data points, and the "single-day drop" flag only fires when two snapshots really are ~1 day apart, but a firm relying on CB-05's daily cadence for early warning won't get it until a scheduler exists | Same root cause as G-1's original context — no scheduler built yet | True daily-cadence cash monitoring — the first metric a scheduler should unlock once built |
| G-20 | VC-03 skips the PDF's Salesforce `Opportunity.Type='New Business'` cross-check entirely — built purely from the QuickBooks roll-forward's `newLogoRevenue`, same scoping choice as VC-01's G-2. (The doc's *other* corroboration — QuickBooks first-invoice-date, to catch win-back customers — is **resolved**, see Post-Phase-7 fix above: `newLogoRevenue` now excludes anyone with a prior invoice further back.) Also, the "growth rate itself declines two quarters running" act-now leg is interpreted as *this* quarter's growth rate being lower than *last* quarter's (a two-point comparison), not a stricter 3-quarter "declining in both of the last two quarters" reading — the PDF's wording is genuinely ambiguous between these | Consistent with how VC-06/07/14 already treat "new customer" detection (G-16); a stricter 3-quarter interpretation would need a 4th quarter of roll-forward data | A Salesforce-corroborated "genuinely new" check, and/or the stricter trend interpretation if the 2-point one proves too twitchy in practice |
| G-21 | CM-02 groups customers using only QuickBooks `Customer.ParentRef` — a QuickBooks customer with no native parent, whose matching Salesforce Account *does* have a `ParentId`, won't get grouped under that parent. The Salesforce `Account`/`ParentId` data now exists (Phase 4) but nothing cross-references it against QuickBooks customers by name | Fuzzy name-matching between QuickBooks `Customer.displayName` and Salesforce `Account.Name` is real, fragile-by-nature work — deferred rather than rushed | A more complete CM-02 for companies whose subsidiary hierarchy lives in Salesforce rather than QuickBooks |
| G-24 | ~~CM-03 only supported Salesforce's custom-field mode~~ **Resolved (Post-Phase-7, 2026-08-23)** — see "Post-Phase-7 build" below for the full writeup. `Organization.settings.salesforceCompetitorSource` (`'field' \| 'junction'`) now selects between the two, `Deal.competitors: string[]` stores every named competitor from the standard `OpportunityCompetitor` object, and `buildCompetitorStats` credits a win/loss to *each* competitor a multi-competitor deal names | | |
| G-23 | CM-05/CM-07 are HubSpot-only — `Contact.analyticsSource` has no Salesforce equivalent (Salesforce's `Lead.LeadSource` picklist exists but wasn't scoped into this phase, and the app's Lead→Contact mapping already leaves several HubSpot-only fields unset for Salesforce, see `crm-integrations` skill §4). A Salesforce-connected org sees no CM-05/CM-07 cards at all rather than a `computable:false` placeholder | Wiring a second attribution source was out of Phase 6's stated scope (`hs_analytics_source`/`createdate`, HubSpot only) | A Salesforce equivalent of CM-05/CM-07 sourced from `Lead.LeadSource`/`Opportunity.CreatedDate` (both already resolvable from existing synced fields) |
| G-22 | CM-04/06/08's funnel-role mapping (qualified-stage cutoff; MQL/SQL lifecycle values) is a fixed code default, not a per-org, user-editable, versioned config — same category as G-13's chart-of-accounts heuristic. A company using **custom** HubSpot lifecycle-stage values (an Enterprise feature) instead of the standard `marketingqualifiedlead`/`salesqualifiedlead` won't match at all, silently returning 0 MQLs/SQLs rather than an error. (~~CM-06's flag comparisons used a single prior cohort/period, not the PDF's "trailing-four-quarter average"~~ **Resolved, Post-Phase-7 (2026-08-23)** — now averages the trailing 4 monthly cohorts; found during manual validation that the single-prior-month comparison was prone to false-firing on ordinary month-to-month noise, same bug shape as VC-07's fix. The "maturation window" is still a flat 2 months for every stage rather than "stage-appropriate" per-stage windows) | Full settings UI + versioned-history store is real scope beyond MVP Phase 5, same reasoning as G-13 | Correctness for companies with customized HubSpot lifecycle stages |

---

## 4. Suggested phase order

1. ~~QuickBooks Invoice sync + revenue roll-forward → VC-01, VC-02~~ **(Phase 1, done)**
2. ~~QuickBooks P&L report pull + expense/income classification → VC-04, VC-06, VC-07, VC-09,
   VC-10, VC-12, VC-13, VC-14~~ **(Phase 2, done)**
3. ~~QuickBooks Balance Sheet / Cash Flow / Aging / Inventory report pulls → CB-05, CB-07, CB-10~~
   **(Phase 3, done — but verify the report-parsing assumptions against a live sandbox, G-18)**
4. ~~Salesforce: `Type`, `LeadSource`, `CampaignId` on Opportunity + `Account`/`ParentId` sync →
   VC-03, CM-02~~ **(Phase 4, done — CM-02 ended up not needing the Salesforce Account data, G-21;
   VC-06's channel breakdown still blocked on ad-spend regardless, G-16b)**
5. ~~Funnel-role mapping (fixed default) → CM-04 (numerator only), CM-06, CM-08~~ **(Phase 5, done —
   CM-04's ratio itself stays blocked on G-14 regardless; mapping isn't per-org configurable, G-22)**
6. ~~HubSpot `hs_analytics_source` (G-8) → CM-05, CM-07~~ **(Phase 6, done — CM-07 ships blended-only,
   Campaigns API/ad-spend stays permanently out of scope, G-9/G-16b; CM-05/07 are HubSpot-only, G-23)**
7. ~~Per-org competitor-field config (G-11) → CM-03~~ **(Phase 7, done — custom-field mode; extended
   Post-Phase-7 to also support the `OpportunityCompetitor` junction object, G-24 resolved)**
8. A scheduler (cron/repeatable BullMQ job calling `syncService.startSync` on a cadence) — unlocks
   true daily cash monitoring for CB-05 (G-15b) and makes every "last synced" number fresher
   without any metric-side changes
9. Cross-cutting, do whenever convenient once a few metrics exist to validate them against:
   per-org alert-threshold overrides (G-3), **a real operating-plan input feature (G-14) — the
   single biggest remaining lever, it's the only thing blocking CM-04 entirely and every
   plan-relative flag leg across VC-04/06/09/10/13**, a versioned chart-of-accounts mapping UI
   (G-13), a versioned funnel-role mapping UI (G-22), and the monthly/quarterly trend endpoint (G-1)
