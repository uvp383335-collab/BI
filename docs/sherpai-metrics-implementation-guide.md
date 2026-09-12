# SherpAI Insights Framework — MVP Metric-by-Metric Data Guide

Companion to `SherpAI Metrics Guide- MVP-v1.0.pdf` (v1.1-MVP, July 2026). The PDF defines what
each metric means. This document is the field-level lookup for building it: for every one of the
21 MVP metrics — the exact formula, exactly which system/object/field the number comes from, and
— where this codebase's current QuickBooks/Salesforce/HubSpot integrations don't pull that field
yet — what's missing and how to close the gap.

"Available today" below is checked against the actual current sync code
(`backend/src/modules/integrations/service/{hubspot,salesforce,quickbooks}.service.ts` and
`backend/src/modules/sync/service/sync.service.ts`), not against what the connectors could
theoretically provide. Where it says "not pulled yet," the field exists in the provider's API —
the sync code just doesn't request it today.

Three standing facts, referenced repeatedly below instead of repeated in full each time:

1. **QuickBooks currently syncs nothing but OAuth tokens.** No invoices, no reports, no chart of
   accounts. Every QuickBooks-sourced metric below needs this built first — noted per metric, not
   re-explained.
2. **Salesforce today only pulls** `Lead: Id, Email, FirstName, LastName, Status` and
   `Opportunity: Id, Name, Amount, CloseDate, StageName, OwnerId` (plus their stage-history and
   picklist metadata). No `Account` object, no `Type`, `LeadSource`, `CampaignId`, or competitor
   field.
3. **HubSpot today only pulls** `Contact: email, firstname, lastname, lifecyclestage,
   hs_lead_status` (+ lifecycle history) and `Deal: dealname, amount, closedate, pipeline,
   dealstage, hubspot_owner_id` (+ stage history), plus deal↔contact associations. No source/
   channel attribution, no campaign data.

---

## Shared building blocks

A few things aren't single-metric data pulls — they're inputs several metrics share. Each is
called out again at point of use, but defined once here.

**Customer revenue roll-forward.** GRR, NRR, new-logo growth, recurring-revenue %, LTV:CAC (both
versions), and customer concentration all read one shared per-customer-per-month table: starting
revenue, cancellations, downgrades, expansion, new-logo revenue, ending revenue. Source: every
QuickBooks Invoice line, grouped by customer and month. QuickBooks invoices carry no explicit
"this was a downgrade" or "this customer churned" event — both must be *inferred* by comparing a
customer's month-over-month invoice totals (revenue drop while still invoicing = downgrade;
revenue to zero = cancellation; revenue increase = expansion). This inference logic is the same
piece of work regardless of which metric is being built, so build it once, not per metric.

**Chart-of-accounts mapping.** COGS %, G&A %, EBITDA margin, recurring-revenue %, CAC, and cash
conversion cycle all need to know which QuickBooks accounts count as revenue, COGS, G&A, sales &
marketing, or D&A. QuickBooks's own `AccountType`/`AccountSubType` gets you most of the way there
automatically, but G&A vs. sales-&-marketing vs. "one-time, exclude" needs a one-time reviewable
mapping per company (config, not something pulled from an API) — same category as the "one
manual input" the PDF already calls out for the operating plan.

**Customer identity / deduplication.** New-logo growth and customer concentration both break if
the same real-world company appears as multiple customer records (subsidiaries, renamed
accounts). QuickBooks `Customer.ParentRef` and Salesforce `Account.ParentId` are the two
available signals; neither is pulled today (QuickBooks `Customer` isn't synced at all;
Salesforce `Account` isn't synced at all). Needs resolving before CM-02 or VC-03 can be trusted.

**Standard sales funnel / standard marketing funnel.** Pipeline coverage and marketing funnel
metrics need every company's home-grown stage names translated onto one fixed funnel. The
*deal*-stage version of this partially exists already — `PipelineStageDefinition` stores each
provider's real stage labels/order — but nothing today marks *which* stage is the "qualified"
cutoff pipeline coverage needs, or which HubSpot lifecycle-stage value counts as MQL vs. SQL.
That's a config addition on top of the existing table, not a new data pull.

**Operating plan (revenue target, MQL target).** Per the PDF, this is deliberately a manual
template upload, not pulled from any connector. Not a gap — just noted so it isn't mistaken for
one below.

---

## Value Creation

### VC-01 — Gross Revenue Retention Rate (GRR)

**What it measures:** Of the recurring revenue you started the period with, how much did you
keep (cancellations + downgrades only, upsells ignored).

**Formula:** `(Starting revenue − Cancellations − Downgrades) ÷ Starting revenue × 100`

**Data needed:**

| Data point | Source | Object / field | Available today? |
|---|---|---|---|
| Starting revenue per customer | QuickBooks | `Invoice` lines, grouped by `CustomerRef`, prior month | **No** — QuickBooks data sync doesn't exist yet |
| Cancellations, downgrades | QuickBooks (inferred) | Same `Invoice` data, month-over-month delta per customer | **No** — same gap, plus the inference logic itself doesn't exist |
| Churn reason ("why") | Salesforce | `Opportunity.Type = 'Churn'`, or a churn-date field on `Account` | **No** — `Type` isn't in the current Opportunity SOQL query; `Account` isn't synced at all |

**Gap & fix:** Build the QuickBooks Invoice sync and the customer revenue roll-forward (see
Shared Building Blocks) — this is the prerequisite for the metric to exist at all, not an
optional enhancement. Separately, widen the Salesforce Opportunity query to include `Type`, and
decide whether to sync `Account` (for a churn-date field) or rely on `Type = 'Churn'` alone —
`Type` alone is enough to compute the metric; `Account`'s churn-date only enriches the "why"
narrative attached to the alert, so it can ship second. Separately, the 90% watch benchmark
below is hardcoded, not a per-org override — see Shared Building Blocks / G-3.

**Cadence:** calculated monthly, alert checked quarterly.

**Flags:** Watch — retention down vs. last quarter, or below 90% (default). Act now — both in
the same quarter.

---

### VC-02 — Net Revenue Retention Rate (NRR)

**What it measures:** Same as GRR but upsells count — can exceed 100%.

**Formula:** `(Starting revenue − Cancellations − Downgrades + Expansion) ÷ Starting revenue × 100`

**Data needed:**

| Data point | Source | Object / field | Available today? |
|---|---|---|---|
| Expansion per customer | QuickBooks (inferred) | Same Invoice roll-forward as VC-01, positive month-over-month delta | **No** — same VC-01 gap |
| Product usage data (to classify expansion as organic vs. sales-led) | Product usage system | account-level usage records | **No connector exists for this at all** — it is not one of the three MVP connectors and is not listed in the PDF's deferred-connector appendix either |

**Gap & fix:** The core NRR number only needs the invoice-based roll-forward (VC-01's fix covers
it). The usage-data split described in the PDF is a nice-to-have refinement with no available
data source in MVP scope — compute NRR from invoice deltas only and skip the organic-vs-sales-led
breakdown until a usage-data connector is scoped; don't block the metric on it. Separately, the
90%/100% thresholds below are hardcoded, not a per-org override — see Shared Building Blocks /
G-3.

**Cadence:** calculated and checked monthly.

**Flags:** Watch — NRR below 100% latest period. Act now — below 100% two quarters running, or
below 90% in any single quarter.

---

### VC-03 — New-Logo Revenue Growth Rate

**What it measures:** Growth of revenue from brand-new customers, period over period.

**Formula:** `(New-logo revenue this period − prior period) ÷ prior period × 100`; variance vs.
plan in points.

**Data needed:**

| Data point | Source | Object / field | Available today? |
|---|---|---|---|
| New-business closed-won deals | Salesforce | `Opportunity.Type = 'New Business'`, `Amount`, `Stage`, `CloseDate` | **Partially** — Amount/Stage/CloseDate already pulled; `Type` is not |
| First invoice date per customer (confirms "new") | QuickBooks | `Customer.Id` + earliest `Invoice.TxnDate` | **No** — Invoice sync doesn't exist |
| Growth target | Operating plan | manual template | Available by design (manual input, not a gap) |

**Gap & fix:** Add `Type` to the Salesforce Opportunity SOQL query (small, contained change).
Build the QuickBooks Invoice sync (same prerequisite as VC-01). Also needs the customer
dedup/grouping step (Shared Building Blocks) — without it, a renamed or resurfaced account can
get miscounted as a new logo.

**Cadence:** calculated monthly, checked quarterly against plan.

**Flags:** Watch — new-logo growth >10% below plan. Act now — misses plan two quarters running,
or growth rate itself declines two quarters running.

---

### VC-04 — Cost of Goods Sold % and Mix (Total, by Product, by Market)

**What it measures:** Direct delivery cost as a share of revenue, company-wide and by product/
market, split into a "rate" effect (products got costlier) vs. a "mix" effect (sales shifted
toward lower-margin products).

**Formula:** `COGS % = COGS ÷ Revenue × 100` (total + per Class); `Mix % = product revenue ÷
total revenue × 100`.

**Data needed:**

| Data point | Source | Object / field | Available today? |
|---|---|---|---|
| Revenue, COGS by product/market | QuickBooks | Profit & Loss report, `summarize_column_by=Class` (or `Department` for Location tracking) | **No** — no QuickBooks report is pulled today |
| Which accounts are Income vs. COGS | QuickBooks | `Account.AccountType` | **No** — `Account` isn't synced; also needs the chart-of-accounts mapping review (Shared Building Blocks) |
| Peer benchmark | Market-data feed | n/a | **No** — market-data connector is fully deferred (not in MVP scope at all) |

**Gap & fix:** Build the QuickBooks P&L-by-Class report pull and the `Account`/`Class` sync
(prerequisite, shared with VC-06/VC-09/VC-10/VC-12/VC-13). Peer-benchmark comparison has no fix
available in MVP — the PDF itself specifies the fallback: run the Watch/Act check against plan
only, and mark the metric's `sourceQuality` as plan-only so the UI can say so rather than silently
comparing against nothing.

**Cadence:** monthly once books close, checked quarterly.

**Flags:** Watch — cost % up vs. last quarter, or above peer/plan benchmark. Act now — increase
driven mainly by "rate" (>1 point of genuine cost inflation, not mix).

---

### VC-06 — Customer Acquisition Cost (CAC) & Payback Period

**What it measures:** All-in cost to win one new customer, and months to earn that cost back in
gross profit.

**Formula:** `CAC = S&M spend ÷ new customers won`; `Payback (months) = CAC ÷ (avg new-customer
monthly revenue × gross margin)`.

**Data needed:**

| Data point | Source | Object / field | Available today? |
|---|---|---|---|
| Sales & marketing spend | QuickBooks | P&L expense accounts tagged S&M in the chart-of-accounts mapping | **No** — needs the P&L pull + mapping (same gap as VC-04) |
| New customers won + channel | Salesforce | `Opportunity.Type='New Business'`, `LeadSource`, `CampaignId` | **Partially** — new-customer count reuses VC-03's fix; `LeadSource`/`CampaignId` are not in the current SOQL query |
| Per-channel ad spend | Google/Meta/LinkedIn ad platforms | n/a | **No connector exists — deferred, not MVP scope** |
| Gross margin | (derived) | VC-04 output | depends on VC-04's fix |

**Gap & fix:** Add `LeadSource`, `CampaignId` to the Salesforce Opportunity query. Ad-platform
spend has no fix available in MVP — this is explicitly anticipated by the PDF itself: report the
**blended** CAC/payback only (all S&M spend ÷ all new customers) and skip per-channel breakdown
until an ad-platform connector exists; don't attempt to approximate channel spend from HubSpot
campaign association data alone, since HubSpot only has campaigns it ran, not raw ad-platform
cost.

**Cadence:** monthly once books close, checked quarterly.

**Flags:** Watch — payback past 18 months (default), or LTV:CAC (VC-07) below 3x. Act now — both
at once, or payback beyond 24 months.

---

### VC-07 — Lifetime Value to Acquisition Cost (New Customers)

**What it measures:** Gross profit a new customer will generate over their life vs. what it cost
to win them.

**Formula:** `LTV = monthly revenue × gross margin ÷ monthly churn rate` (capped at 7 years
modeled life); `Ratio = LTV ÷ CAC`.

**Data needed:** Entirely derived from VC-01 (churn rate), VC-04 (gross margin), and VC-06 (CAC)
— no new raw data pull.

**Gap & fix:** None beyond what VC-01/VC-04/VC-06 already require. Once those three are built,
this metric is pure arithmetic on top of them.

**Cadence:** calculated and checked monthly/quarterly.

**Flags:** Watch — below 3.0x, or above 3.0x but declining two quarters running. Act now — below
2.0x.

---

### VC-09 — G&A as % of Revenue

**What it measures:** Back-office cost (accounting, legal, finance, HR, IT, facilities) as a
share of revenue.

**Formula:** `G&A % = G&A expense ÷ Revenue × 100`

**Data needed:**

| Data point | Source | Object / field | Available today? |
|---|---|---|---|
| G&A expense | QuickBooks | P&L expense accounts tagged G&A in chart-of-accounts mapping | **No** — same P&L-pull gap as VC-04 |
| Peer benchmark | Market-data feed | n/a | **No — deferred, not MVP scope** |

**Gap & fix:** Same QuickBooks P&L pull + chart-of-accounts mapping as VC-04 (build once, reuse).
Peer benchmark: same plan-only fallback as VC-04 — no fix available until the market-data
connector ships; the PDF explicitly allows this mode.

**Cadence:** monthly, checked quarterly.

**Flags:** Watch — above peer benchmark or >1 point over plan. Act now — both, two quarters
running.

---

### VC-10 — EBITDA Margin Trend

**What it measures:** EBITDA as a share of revenue, vs. plan and peers — the headline
profitability figure.

**Formula:** `EBITDA = Operating income + D&A`; `Margin % = EBITDA ÷ Revenue × 100`

**Data needed:**

| Data point | Source | Object / field | Available today? |
|---|---|---|---|
| Operating income | QuickBooks | P&L: revenue − COGS − opex | **No** — same P&L-pull gap |
| Depreciation & amortization | QuickBooks | D&A accounts, including any D&A booked inside COGS, per chart-of-accounts mapping | **No** — needs the mapping to correctly tag D&A accounts, including any sitting inside COGS |
| Peer benchmark | Market-data feed | n/a | **No — deferred, not MVP scope** |

**Gap & fix:** Same P&L pull as VC-04/VC-09; the chart-of-accounts mapping must specifically flag
which accounts are D&A even when they're nested inside COGS (the PDF calls this out — don't just
tag D&A at the top-level expense section and miss COGS-embedded D&A). Peer benchmark: plan-only
fallback, same as VC-04/VC-09.

**Cadence:** monthly; checked monthly vs. plan, quarterly vs. peers.

**Flags:** Watch — >1 point below plan this quarter, or shrinking two quarters running. Act now —
>3 points below plan, or >5 points below peer median.

---

### VC-12 — Recurring Revenue % of Total

**What it measures:** Share of revenue that's contractually recurring vs. one-off — a big driver
of valuation multiple.

**Formula:** `Recurring % = Recurring revenue ÷ Total revenue × 100`

**Data needed:**

| Data point | Source | Object / field | Available today? |
|---|---|---|---|
| Recurring vs. non-recurring revenue accounts | QuickBooks | Income accounts tagged `isRecurring` in chart-of-accounts mapping | **No** — needs the mapping (Shared Building Blocks), plus a P&L pull |
| Customer-level cross-check | QuickBooks | `Invoice` lines | **No** — needs Invoice sync (same as VC-01) |

**Gap & fix:** Chart-of-accounts mapping needs a `isRecurring` flag per income account, decided
once at onboarding and versioned (a mapping edit must never silently rewrite history — keep prior
versions). Reuses the same Invoice sync as VC-01.

**Cadence:** monthly, checked quarterly.

**Flags:** Watch — recurring share falls two quarters running. Act now — falls >5 points over the
past year.

---

### VC-13 — Revenue Growth Rate (Recurring vs. Non-Recurring)

**What it measures:** Total revenue growth split into recurring vs. one-off components, vs. plan.

**Formula:** `Growth % = (Revenue this period − prior period) ÷ prior period × 100`, computed
separately for total, recurring, and non-recurring.

**Data needed:** Same feed as VC-12 (QuickBooks P&L + recurring tagging). No additional gap
beyond VC-12's.

**Gap & fix:** None beyond VC-12.

**Cadence:** monthly, checked quarterly.

**Flags:** Watch — total growth >10% below plan, or recurring grows slower than total. Act now —
misses plan two quarters running while recurring share (VC-12) also falling.

---

### VC-14 — Customer Lifetime Value to Acquisition Cost (Whole Base)

**What it measures:** Same LTV:CAC test as VC-07, across the entire active base rather than just
new customers.

**Formula:** `LTV = avg monthly revenue per customer (whole base) × gross margin ÷ monthly churn`;
`Ratio = LTV ÷ CAC (trailing 12 months)`.

**Data needed:** Entirely derived from VC-01 and VC-06 — no new raw data.

**Gap & fix:** None beyond VC-01/VC-06.

**Cadence:** quarterly.

**Flags:** Watch — fallen two quarters running and at/below 3.5x. Act now — below 3.0x.

---

## Capital & Balance Sheet

### CB-05 — Cash Position & Runway

**What it measures:** Unrestricted cash on hand and months of runway at current burn — the only
metric checked daily.

**Formula:** `Runway = Unrestricted cash ÷ avg monthly burn (trailing 3 months)`; self-funding
(blank) if burn ≤ 0.

**Data needed:**

| Data point | Source | Object / field | Available today? |
|---|---|---|---|
| Daily unrestricted cash balance | Bank feed (Plaid) | account balances | **No — deferred connector, not MVP scope** |
| Fallback: cash balance | QuickBooks | Balance Sheet report, bank-type accounts | **No** — no QuickBooks report is pulled today |

**Gap & fix:** Bank-feed (Plaid) is out of MVP scope entirely — no fix, by design. Build the
QuickBooks fallback instead: pull the Balance Sheet report daily, filter to bank-type accounts.
Mark this data as the deliberately lower-grade source (per the PDF — it upgrades in place to
bank-feed balances later without changing the metric definition).

**Cadence:** daily / daily.

**Flags:** Watch — runway <12 months. Act now — <6 months, or an unexplained single-day cash drop
>15%.

---

### CB-07 — Free Cash Flow Conversion

**What it measures:** Share of EBITDA that actually converts to cash after capex and working-
capital swings.

**Formula:** `FCF = Operating cash flow − CapEx`; `Conversion % = FCF ÷ EBITDA × 100`

**Data needed:**

| Data point | Source | Object / field | Available today? |
|---|---|---|---|
| Operating cash flow, CapEx | QuickBooks | Statement of Cash Flows report | **No** — not pulled today |
| EBITDA | (derived) | VC-10 output | depends on VC-10's fix |

**Gap & fix:** Build the QuickBooks Cash Flow report pull. Where a company's books can't produce
a reliable Cash Flow statement (common at smaller mid-market companies, per the PDF), fall back
to deriving FCF from Balance Sheet period-over-period changes instead and mark the result as
derived rather than primary-source — this fallback is specified by the PDF itself, not a
workaround invented here.

**Cadence:** quarterly.

**Flags:** Watch — conversion declining vs. plan/peers two quarters running. Act now — conversion
<30% while leverage is above target (leverage metric is deferred in MVP, so this cross-check
can't fire until leverage ships — note the dependency, don't silently drop the condition).

---

### CB-10 — Cash Conversion Cycle

**What it measures:** Days cash is tied up in the operating cycle (collections + inventory − pay
terms).

**Formula:** `Days to collect = A/R ÷ Revenue × days`; `Days in inventory = Inventory ÷ COGS ×
days`; `Days to pay = A/P ÷ COGS × days`; `Cycle = collect + inventory − pay`.

**Data needed:**

| Data point | Source | Object / field | Available today? |
|---|---|---|---|
| A/R balance | QuickBooks | A/R Aging Summary report | **No** — not pulled today |
| A/P balance | QuickBooks | A/P Aging Summary report | **No** — not pulled today |
| Inventory balance | QuickBooks | Inventory Valuation Summary report | **No** — not pulled today |
| Revenue, COGS | QuickBooks | P&L report | **No** — same gap as VC-04 |

**Gap & fix:** Build all three aging/valuation report pulls plus the P&L pull (P&L is shared work
with VC-04/09/10). Service companies with no inventory should produce a `0` for that leg that's
suppressed from display, not treated as a data gap — that's a display rule, not a sourcing
problem.

**Cadence:** monthly, checked quarterly.

**Flags:** Watch — cycle lengthened vs. plan/peers two quarters, or collections alone slowed >5
days quarter over quarter. Act now — cycle lengthened >15 days over two quarters.

---

## Customer & Market

### CM-02 — Customer Concentration (Top-10 Revenue %)

**What it measures:** Share of trailing-12-month revenue from the 10 (and top-5, top-1) largest
customers, with subsidiaries grouped under their parent.

**Formula:** `Top-10 % = revenue of 10 largest customers ÷ total revenue × 100` (trailing 12mo).

**Data needed:**

| Data point | Source | Object / field | Available today? |
|---|---|---|---|
| Customer-level revenue (TTM) | QuickBooks | `Invoice` lines | **No** — needs Invoice sync (VC-01 prerequisite) |
| Subsidiary grouping | Salesforce | `Account.ParentId` | **No** — `Account` isn't synced at all |

**Gap & fix:** Reuses the VC-01 Invoice sync. Needs the customer dedup/grouping work (Shared
Building Blocks) — this metric is explicitly the one the PDF warns is most sensitive to getting
grouping wrong ("three subsidiaries counted separately will understate the risk"), so don't skip
it even for a first cut. Requires adding a minimal `Account` sync (`Id`, `ParentId`, `Name` only —
no reason to pull more, per the existing narrow-sync policy) plus linking `Opportunity.AccountId`
(also not currently pulled).

**Cadence:** monthly (trailing 12mo), checked quarterly.

**Flags:** Watch — top-10 >40% (default) or risen >3 points over the year. Act now — top-10 >60%,
or any single customer >20%.

---

### CM-03 — Competitive Win Rate (vs. Named Competitors)

**What it measures:** Win rate in deals where a specific named competitor was in the running,
tracked per competitor.

**Formula:** `Win rate % = Wins ÷ (Wins + Losses) × 100` per competitor, trailing 2 quarters.

**Data needed:**

| Data point | Source | Object / field | Available today? |
|---|---|---|---|
| Competitor recorded per deal | Salesforce | a competitor field on `Opportunity` | **No** — Salesforce has no single standard field for this; it's either a custom field (commonly `Competitor__c`) or the standard `OpportunityCompetitor` junction object, and which one a given org uses varies |

**Gap & fix:** This is a genuine per-org configuration gap, not just an unpulled field — there's
no universal Salesforce field name to hardcode. Make the competitor-field mapping a per-org
setting (which custom field, or whether to query `OpportunityCompetitor` instead) captured at
onboarding. Where a connected org has no competitor tracking configured at all, the metric must
show as not computable rather than guessed at — this is exactly the PDF's own "honest numbers"
rule, and it's also explicitly anticipated: the PDF already says alerts should hold back when
fewer than a quarter of closed deals have a competitor recorded.

**Cadence:** monthly on a rolling 2-quarter window, checked quarterly.

**Flags:** Watch — win rate vs. one competitor down ≥10 points, with ≥10 decided deals in each
window. Act now — same drop, win rate now <30%.

---

### CM-04 — Pipeline Coverage Ratio

**What it measures:** Qualified pipeline closing next quarter vs. next quarter's target.

**Formula:** `Coverage = qualified pipeline closing next quarter ÷ next quarter's target`

**Data needed:**

| Data point | Source | Object / field | Available today? |
|---|---|---|---|
| Open deal amount, stage, close date | Salesforce / HubSpot | `Opportunity`/`Deal` — already synced | **Yes** |
| Which stage counts as "qualified" | Salesforce / HubSpot | stage picklist, already synced into `PipelineStageDefinition` | **Partially** — the stage labels/order are already captured; nothing today marks *where* the qualification cutoff falls |
| Next quarter's target | Operating plan | manual template | Available by design |

**Gap & fix:** The only real gap here is configuration, not data pull: add a "qualified-stage
cutoff" marker to `PipelineStageDefinition` (or an equivalent per-org setting), set once at
onboarding the same way stage labels themselves are mapped. This is the lightest-lift metric in
the CM family — most of its inputs already sync today.

**Cadence:** weekly; checked monthly and at quarter open.

**Flags:** Watch — coverage <3.0x as quarter opens. Act now — <2.0x at quarter open, or <3.0x
while win rate (CM-03) also falling.

---

### CM-05 — Marketing-Sourced Pipeline & Revenue %

**What it measures:** Share of qualified pipeline and closed new-business revenue that
originated from marketing vs. sales outbound/partners/referrals.

**Formula:** `Marketing-sourced % = marketing-originated qualified pipeline ÷ total qualified
pipeline × 100` (and the equivalent for closed revenue, trailing 12mo).

**Data needed:**

| Data point | Source | Object / field | Available today? |
|---|---|---|---|
| Deal's original source/channel | HubSpot | `hs_analytics_source` (contact property) or deal-level original-source | **No** — not in the current narrow contact/deal property list |
| Qualified pipeline | (derived) | CM-04's qualified-stage marker | depends on CM-04's fix |
| Closed new-business revenue | Salesforce | `Opportunity.Amount`/`Stage` — already synced | **Yes** |
| Revenue confirmation | QuickBooks | first-invoice date | **No** — needs Invoice sync (VC-01 prerequisite) |

**Gap & fix:** Add `hs_analytics_source` (and its detail sub-property) to the HubSpot contact
property list. Everything else reuses fixes already required elsewhere (CM-04's qualified-stage
marker, VC-01's Invoice sync).

**Cadence:** monthly, checked quarterly.

**Flags:** Watch — marketing-sourced share falls two quarters running, or below 30% (default).
Act now — falling while pipeline coverage (CM-04) also below target.

---

### CM-06 — Funnel Conversion Rates (Lead → MQL → SQL → Won)

**What it measures:** Cohort-based stage-to-stage advancement through the standard marketing-to-
sales funnel.

**Formula:** `Stage conversion % = records advancing to next stage ÷ records entering that stage
× 100`, grouped by entry-month cohort.

**Data needed:**

| Data point | Source | Object / field | Available today? |
|---|---|---|---|
| Lifecycle-stage transition history | HubSpot | `Contact.lifecycleStageHistory` | **Yes — already synced** (`propertiesWithHistory=lifecyclestage`) |
| Opportunity outcome (SQL → Won leg) | Salesforce | `Opportunity` stage history — already synced | **Yes** |
| Which lifecycle-stage value = MQL vs. SQL | HubSpot | config, not an API field | **No** — nothing today maps a company's custom lifecycle-stage values onto MQL/SQL roles |

**Gap & fix:** This is the rare case where the raw data already syncs — the gap is purely the
funnel-role mapping (Shared Building Blocks): add a per-org config step, the same shape as the
existing stage-label mapping, that tags which `lifecyclestage` values count as MQL and which
count as SQL. No new HubSpot/Salesforce pull needed.

**Cadence:** monthly as cohorts mature, checked quarterly. Alerts held back below 100 leads or 30
MQLs in a cohort.

**Flags:** Watch — any stage's conversion down >20% vs. trailing 4-quarter average. Act now — two
adjacent stages deteriorate same quarter, or MQL→SQL falls below half its trailing average.

---

### CM-07 — Marketing ROI by Channel (Pipeline per Marketing Dollar)

**What it measures:** Qualified pipeline and gross profit generated per dollar of marketing
spend, blended and by channel.

**Formula:** `Pipeline ROI = marketing-sourced qualified pipeline ÷ marketing spend`; `Profit ROI
= marketing-sourced revenue × gross margin ÷ marketing spend`.

**Data needed:**

| Data point | Source | Object / field | Available today? |
|---|---|---|---|
| Channel attribution | HubSpot | `hs_analytics_source` | **No** — same gap as CM-05 |
| Campaign cost (where recorded in HubSpot) | HubSpot | Campaigns API (`budgetItems`/cost fields) | **No** — no campaign data is pulled at all today |
| Total marketing spend | QuickBooks | P&L accounts tagged marketing | **No** — same P&L-pull + chart-of-accounts-mapping gap as VC-06 |
| Per-channel ad spend | Google/Meta/LinkedIn | n/a | **No connector — deferred, not MVP scope** |
| Gross margin | (derived) | VC-04 output | depends on VC-04's fix |

**Gap & fix:** Add `hs_analytics_source` to HubSpot's contact pull (shared with CM-05). Add a
HubSpot Campaigns API integration to pull recorded campaign cost — this is new surface area, not
just a wider property list on an existing call. Reuses the QuickBooks P&L + mapping work from
VC-06/VC-04. Per-channel figures are only meaningful once ≥80% of spend is traceable to a channel
(per the PDF's own rule) — with ad-platform spend out of MVP scope, expect the blended figure to
be the only one available at launch; don't force a per-channel number from partial data.

**Cadence:** monthly once books close, checked quarterly.

**Flags:** Watch — blended pipeline ROI below 5x (default) or declining two quarters running. Act
now — a channel with >20% of spend returns <2x for two straight quarters. Opportunity — a channel
at ≥2x the blended ROI on <15% of spend.

---

### CM-08 — Lead Volume vs. Plan (MQL Flow)

**What it measures:** MQLs generated vs. plan, and trend — the earliest demand signal in the
framework.

**Formula:** `Variance % = (Actual MQLs − Planned MQLs) ÷ Planned MQLs × 100`; period-over-period
growth %.

**Data needed:**

| Data point | Source | Object / field | Available today? |
|---|---|---|---|
| MQL transition dates | HubSpot | `Contact.lifecycleStageHistory` | **Yes — already synced** |
| Which lifecycle-stage value = MQL | HubSpot | config | depends on CM-06's funnel-role mapping fix |
| MQL target | Operating plan | manual template | Available by design |

**Gap & fix:** No new data pull at all — this metric rides entirely on CM-06's funnel-role
mapping fix. Once that config exists, CM-08 is pure counting/aggregation on data already synced.

**Cadence:** weekly, checked monthly.

**Flags:** Watch — MQL volume >15% below plan for a month, or declining two months running. Act
now — >25% below plan for a full quarter, or falling while CM-06 also deteriorating.

---

## Deferred (out of MVP scope — no metric page needed yet)

VC-05, VC-08 (payroll register), VC-11 (QoE documents), VC-15 (market data) — Value Creation.
CB-01–04, CB-06, CB-08, CB-09, CB-11–15 — Capital & Balance Sheet (bank feed, cap table, market
data, document pipeline). CM-01 (NPS — survey connector). RC and ER families entirely. None of
these have a usable data source under the current three-connector MVP; don't attempt partial
implementations against QuickBooks/Salesforce/HubSpot substitutes — the PDF's own gating logic
depends on these staying absent until their real connector ships.

---

## Cross-metric gap summary (build once, unblocks many)

| Prerequisite | Unblocks |
|---|---|
| QuickBooks Invoice sync + customer revenue roll-forward | VC-01, VC-02, VC-03, VC-07, VC-12, VC-13, VC-14, CM-02, CM-05 |
| QuickBooks P&L report pull + chart-of-accounts mapping | VC-04, VC-06, VC-09, VC-10, VC-12, VC-13, CB-07 (EBITDA input), CB-10, CM-07 |
| QuickBooks Balance Sheet / Cash Flow / Aging / Inventory report pulls | CB-05, CB-07, CB-10 |
| Salesforce: add `Type`, `LeadSource`, `CampaignId` to Opportunity query | VC-01, VC-03, VC-06 |
| Salesforce: minimal `Account` sync (`Id`, `ParentId`, `Name`) + `Opportunity.AccountId` | CM-02 |
| Salesforce: per-org competitor-field configuration | CM-03 |
| HubSpot: add `hs_analytics_source` to Contact pull | CM-05, CM-07 |
| HubSpot: Campaigns API integration (cost) | CM-07 |
| Funnel-role mapping (qualified-stage cutoff; MQL/SQL lifecycle values) | CM-04, CM-05, CM-06, CM-08 |
| Customer dedup/grouping logic | VC-03, CM-02 |

Build the QuickBooks Invoice sync and the P&L pull first — between them they unblock the majority
of the 21 metrics and every other gap above is comparatively small.
