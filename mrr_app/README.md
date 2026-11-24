# Oryon MRR app

A small Flask app that calculates monthly MRR / ARR from the Oryon MongoDB invoices,
with a Settings page where every QuickBooks product is mapped to how it counts in MRR.

## Run
```bash
pip install -r requirements.txt
python app.py                      # http://localhost:5050
```
Connection (optional environment variables):
| Variable | Default |
|---|---|
| `MONGO_URI` | `mongodb://localhost:27017` |
| `MONGO_DB` | `tenant_6b053ce9f7b1f33b5dc92236` |
| `PORT` | `5050` |

## Metric codes (sidebar)
The left sidebar lists every metric on its own line, by Oryon spec code (no dropdowns); metrics without a page yet
are greyed out. Every page title shows its code(s):

| Group | Code | Page |
|---|---|---|
| Value creation | VC-01 · VC-02 | Retention (GRR, NRR) |
| | VC-03 | New logos |
| | VC-04 | COGS % and mix |
| | VC-06 | CAC & payback |
| | VC-07 · VC-14 | LTV / CAC (new customers · whole base) |
| | VC-09 | G&A % of revenue |
| | VC-10 | EBITDA margin |
| | VC-12 | Recurring revenue % |
| | VC-13 | Revenue growth |
| Capital & balance sheet | CB-05 | Cash & runway |
| | CB-07 | FCF conversion |
| | CB-10 | Cash conversion cycle |
| | CB-15 | not built yet |
| Customer & market | CM-02 | Customer concentration |
| | CM-03 | Competitive win rate |
| | CM-06 | Funnel conversion |
| | CM-07 | Marketing ROI by channel |
| | CM-08 | Lead volume vs plan (MQLs) |
| | CM-05 | Marketing-sourced pipeline % |
| | CM-01, CM-04 | not built yet |
| Exit readiness | ER-05 | Customer & revenue diversification |

The catalogue is `METRIC_GROUPS` in `app.py`; set a page endpoint on a row to add it to the sidebar.

## Pages
- **Settings** – every product found on the invoices (plus the `products` collection), with its
  QuickBooks class, Oryon category, number of invoice lines, amount invoiced and the months it was used.
  An **automatic mapping is pre-selected** (★) from the product name and the Oryon category; change
  anything that's wrong and click **Save mapping**. Also: first month shown, early-invoice day,
  Canadian billing countries and the CAD→USD rate per month.
- **MRR** – MRR, ARR, active customers and ARR per customer; stacked chart (subscription + retainer)
  with the customer count; monthly table with MoM %; **Download CSV**; click *customers* on any month
  for the per-customer breakdown (also downloadable).

- **Retention** – GRR and NRR, monthly or quarterly, TTM window (vs 12 months earlier) or period window
  (vs prior month / prior quarter end), all recurring or subscription-only. KPI cards, a GRR/NRR chart
  with the 90% / 100% benchmarks, an ARR bridge (kept, downgrades, churn, upgrades), the table with
  S, C, Dn, U, K, E, the formula and method, **Download CSV**, and a per-customer drill-down
  (click *customers*; filter by churn / downgrade / upgrade / flat; downloadable).

- **New logos** – new-logo ARR by quarter or month, dated to the Salesforce close month, split by
  Salesforce segment, with 12-month growth (overall and by segment), a stacked chart, YoY growth chart,
  table, method, **Download CSV**, and a per-period list of the new customers with their Salesforce
  account, segment, how they were linked, first-month MRR and ARR.

- **CAC** – CAC, CAC payback and S&M per $1 of new ARR for every month (trailing 12 months), with
  KPI cards (vs a year ago), a payback chart against the 18-month threshold, a CAC / S&M-per-$1 chart,
  the table, the method, **Download CSV**, and a per-month drill-down (*details*) with S&M by account
  and month, the gross-margin inputs and the new logos in the window (S&M breakdown downloadable).
- **Settings → CAC expense accounts** – every expense / other-expense account in `plmonthlysnapshots`
  with its last-12-month and all-time spend. Sales & marketing accounts are **auto-selected** (★)
  by account number: 6010–6050 Sales, 6110–6115 Marketing payroll, 6120–6160 Marketing programs
  (Customer Success 6210–6216 is left out). Tick / untick and **Save CAC accounts**; *Reset* goes back
  to the automatic selection.

- **COGS %** – COGS as a share of revenue, total and by product line (Platform, Services, Hardware),
  monthly or quarterly, per period or trailing 12 months: KPI cards (vs a year ago), COGS % and
  excl.-capitalized-software chart, product-line COGS % chart, stacked COGS dollars, the table,
  method, **Download CSV**, and a per-period account breakdown (*accounts*, downloadable).
- **Settings → COGS % accounts** – every income and COGS account in `plmonthlysnapshots` with a
  product line pre-selected (★): 40xx / 50xx Platform, 41xx / 51xx Services, 42xx / 52xx Hardware;
  5040 is ticked as capitalized-software amortization; unnumbered QuickBooks demo accounts are
  excluded. "Company only" keeps an account in the total but in no product line.

- **G&A %** – G&A as a share of revenue, monthly or quarterly, per period or trailing 12 months: KPI
  cards (vs a year ago), G&A % chart, G&A dollars stacked by account, the table, method,
  **Download CSV**, and a per-period account × month breakdown (*accounts*, downloadable).
- **Settings → G&A expense accounts** – every expense account in `plmonthlysnapshots` with G&A
  auto-selected (★): 6410–6485, 6495 and the unnumbered *Insurance* account (Ridgeline's prepaid
  insurance amortization); 6490 transaction & deal fees and 6510 / 6520 D&A are left out.

- **EBITDA** – EBITDA and EBITDA margin, quarterly (default) or monthly, per period or trailing 12
  months, with vs plan when a plan is loaded: KPI cards, margin chart (with plan), EBITDA dollars,
  a bridge table (revenue − COGS − opex + D&A), method, **Download CSV**, and a per-period account
  breakdown grouped by category (*accounts*, downloadable).
- **Settings → EBITDA account classification** – every P&L account auto-classified (★): income →
  Revenue; COGS → COGS (5040 added back); 6xxx → Opex (6510 / 6520 added back; 6490 deal fees not
  added back); 7010 interest and 8010 tax → Below EBITDA; QuickBooks demo accounts → Exclude.
- **Settings → EBITDA plan** – optional `YYYY-MM, plan EBITDA, plan revenue` lines from the budget.

- **LTV/CAC** – LTV/CAC for new customers at quarter ends (default) or every month: KPI cards (vs a
  year ago), LTV/CAC vs the threshold, LTV and CAC bars, lifetime and TTM GRR, the table (GRR, churn,
  lifetime with "cap", GM, gross profit per logo, LTV, CAC), method, **Download CSV**, and a
  step-by-step page per month (*details*).
  Also **whole base (VC-14)**: the same with the average MRR of all active customers (ARR ÷ customers
  ÷ 12) in place of new-logo MRR – shown alongside in the cards, chart, table, CSV and details.
- **Settings → LTV / CAC** – lifetime cap (84 months), threshold (3.0x) and the GRR used for churn
  (all recurring), pre-set to the spec. CAC inputs come from the CAC settings.

- **Recurring %** – recurring revenue as a share of GL revenue, quarterly (default) or monthly, per
  period or trailing 12 months: KPI cards, MRR-basis vs account-tagged chart, a revenue split
  (subscription MRR / retainer MRR / non-recurring), the table, method, **Download CSV**, and a
  per-period page with each month and GL revenue by account (*details*).
- **Settings → Recurring revenue % accounts** – the income accounts for the account-tagged basis,
  auto-selected (★) 4010 + 4015.

- **Growth** – revenue growth vs the same window a year earlier, quarterly (default) or monthly, per
  period or trailing 12 months: KPI cards (growth and its change vs last year's growth, revenue
  added, recurring / non-recurring YoY, vs plan), growth chart, this-year-vs-last-year revenue bars,
  the table, method, **Download CSV**, and per-period revenue by account (*accounts*). No new
  settings: revenue accounts from the COGS % mapping, MRR from the product mapping, plan revenue
  from the plan settings (shared with EBITDA).

- **Cash** – CB-05 cash position and runway at month end or quarter end from
  `balancesheetmonthlysnapshots`: KPI cards (cash, runway / "Self-funding", average monthly change,
  change vs prior month, A/R), cash chart with an optional data-quality line (cash + negative A/R),
  monthly change chart, table, method, **Download CSV**, per-month details. Months identical to the
  month before (not synced yet) are hidden.
- **Settings → Cash & runway** – **bank account classification** table (like the EBITDA one): every
  bank account from the monthly Balance Sheet snapshots with its latest balance and a dropdown –
  Unrestricted cash / Restricted cash (not in runway) / Exclude. Auto: 1010 / 1015 / 1020-type →
  Unrestricted, 1030 / collateral → Restricted, QuickBooks' sample Checking / Savings → Exclude. Needs the backend
  sync to store `accounts` on each `balancesheetmonthlysnapshots` row; until a resync it falls back to
  the BankAccounts section total minus a restricted-cash amount ($500,000). Also: runway look-back
  (3 months) and the data-quality line on/off.
- **FCF** – CB-07 FCF conversion, trailing 12 months (spec) or single month: KPI cards (FCF %, FCF,
  OCF, capex, EBITDA, FCF % without the A/R swing), FCF % chart with the data-quality line, OCF /
  capex / EBITDA / FCF chart, table (net income + D&A − Δ working capital = OCF, capex, FCF, EBITDA,
  FCF %), method, **Download CSV**, per-month details with the 12 months and capex by account.
- **Settings → FCF conversion (capex accounts)** – **capex account classification** table: every
  fixed-asset and other-asset account on the Balance Sheet snapshots with a dropdown – Capex
  (purchases) / Accumulated depreciation / amortization / Exclude. Auto: 1510 / 1520 cost accounts →
  Capex, 1590 / 1595 / 1795 → Accumulated, other assets and QuickBooks' sample assets (Truck) →
  Exclude. Needs `accounts` on the snapshots (same backend update as Cash); until a resync it falls
  back to change in the FixedAssets total + the D&A on those assets (5040, 6510 ticked). Plus a
  **working capital account classification** table: every current asset / liability account with a
  dropdown – AR / Prepaid / Inventory / AP / Credit card / Accrued / Deferred revenue / Exclude (pick
  the AR account here; Exclude removes it). Auto: Accounts Receivable → AR, prepaid, inventory, A/P,
  credit cards, accrued, deferred revenue; undeposited funds, sales-tax payables, loans → Exclude.
  Without per-account balances the same dropdown is per Balance Sheet section. Data-quality line on/off.
- **CCC** – CB-10 cash conversion cycle at each quarter end (spec) or each month (3 months ending):
  KPI cards (CCC with a "Quarterly" tag, DSO, DIO, DPO, working capital), CCC / DSO / DIO / DPO chart,
  working-capital chart (AR + inventory − AP), table, method, **Download CSV**, per-quarter details.
- **Settings → Cash conversion cycle** – **AR / inventory / AP account classification** table: every
  current asset / liability account with a dropdown – AR / Inventory / AP / Exclude. Auto: Accounts
  Receivable (1100 / 1105) → AR, Inventory (1300) → Inventory, Accounts Payable (2000) → AP. Until the
  resync it picks by Balance Sheet section (inventory is inside OtherCurrentAssets, so DIO shows "-").
  Also the COGS basis: include D&A in cost of sales (5040) – on by default, matches the reference DPO.
- **Concentration** – CM-02 customer concentration, trailing 12 months, every month from "First month
  shown": KPI cards (top-N share, largest customer, top-N invoiced basis, top-N revenue, customer groups),
  share chart, top-N share by QuickBooks class (Platform / Services / Hardware / No class), table, class
  filter, **Download CSV** (all classes + each class), per-month top-customer ranking.
- **Settings → Customer concentration** – **Top N customers** (10), **group customers under their parent**
  (Salesforce account via the customer link walked up ParentId, else the QuickBooks parent, else itself).
  Product lines are the QuickBooks class on each invoice line (`lines.className`), nothing to set. Reuses
  the item mapping (annual subscriptions are spread 1/12), the CAD→USD rates and the early-invoice day.
- **Win rate** – CM-03 win rate vs each tracked competitor from the `deals` collection, trailing 6 months
  (spec) or 12 months (TTM), monthly or quarterly (quarter-end months, e.g. Q3-2026), segment filter: KPI cards per competitor (headline
  highlighted) and competitor-logging rate, win-rate chart, logging chart, table, **Download CSV**, per-month
  details (deals, no-decision dropped, decided, won, lost).
- **Settings → Competitor win rate** – CRM; **custom field with the competitor name** (every
  `customFields` label on the deals, or the standard `competitor` / `competitors` fields; auto: the label
  containing "competitor"); custom field with the loss reason (auto: a "loss reason" label, else none) and
  the loss reasons that aren't a decision (No Decision / Status Quo); deal types counted as New Business;
  headline competitor (Verdance FSM); window (6). Won / lost from `pipelinestagedefinitions`, else the stage name.
- **Funnel** – CM-06 funnel conversion from the `contacts` collection: Lead → MQL, MQL → SQL (headline),
  SQL → opportunity, opportunity → won and SQL → won; monthly or quarterly cohorts, cohort period or TTM (12 months pooled); KPI cards with
  "Immature" tags, conversion chart (immature periods dashed), cohort-size chart, table, **Download CSV**,
  per-period details by cohort month.
- **Settings → Funnel conversion** – CRM (HubSpot); the lifecycle stages used as created / MQL / SQL /
  opportunity (dropdowns of the stages found in the contacts' history); **SQL cohort = contacts with an SQL
  date that also have an MQL date** (on: reproduces the Oryon report exactly); original sources counted as
  marketing-sourced for Lead → MQL (auto: all but OFFLINE); one contact per email; immature days
  (MQL → SQL 60, Lead → MQL 90, SQL → won 180, SQL → opportunity 60, opportunity → won 180).
- **Diversification** (`/diversification`) – ER-05: share of TTM recognized revenue from the 5 largest customer
  groups, rolling monthly; KPI cards, top-5 / largest-group chart, table (quarter ends in bold, link to the top
  groups), **Download CSV** (with the five group names). Same build as CM-02.
- **Settings → Customer & revenue diversification** – top N (5, preselected) and an optional flag threshold; grouping,
  item mapping and FX come from the CM-02 / calculation settings. No marketing-source settings apply.
- **Marketing-sourced** (`/marketing-sourced`) – CM-05: share of new-business ARR created from marketing lead
  sources, plus the share of new-logo ARR won (TTM); quarterly or monthly, period or TTM; KPI cards, share chart,
  marketing vs other ARR chart, table, per-period deal list (duplicates / repeat wins greyed), **Download CSV**.
- **Settings → Marketing-sourced pipeline** – CRM; deal value (ARR / amount); **which lead sources are marketing**
  (auto-ticked: all but Outbound Prospecting, Partner, Customer Referral); new-business deal types; exclude
  duplicate-account deals (name = another account's name + extra words - finds Stonebridge HVAC Group (Denver
  branch), Freeman Appliance Repair Company Inc, Northstar Building Services Holdings); true new logos only.
- **Marketing ROI** (`/marketing-roi`) – CM-07: new-business pipeline created ÷ marketing spend, quarterly
  (complete quarters) or monthly, period or TTM; KPI cards (blended, programs, every channel), blended/programs
  chart, channel chart, table with pipeline / spend per channel, per-period deal list, **Download CSV**.
- **Settings → Marketing ROI by channel** – CRM; pipeline value (deal ARR, or amount); marketing lead sources
  (auto: all but Outbound / Partner / Customer Referral); new-business deal types; P&L accounts for blended
  (auto: 61xx) and programs (auto: 61xx minus salaries / payroll & benefits); channels - name, lead sources and
  the P&L accounts that hold its spend (default: Events = Trade Show ÷ 6130). Only MongoDB data is used - a
  channel whose spend has no P&L account of its own (e.g. Google Ads, LinkedIn inside 6120) can't be split out.
- **MQLs** – CM-08 lead volume vs plan: MQLs (first MQL date) vs the budgeted MQL target, monthly or
  quarterly, period or TTM; KPI cards (% vs plan, MQLs, plan, count difference), MQLs-vs-plan chart,
  % chart, table (quarterly view shows each month's MQLs / plan), **Download CSV**.
- **Settings → Lead volume vs plan** – **budgeted MQL target per quarter**, preloaded from the Budget tabs
  of `Ridgeline_Operating_Plan_Submission.xlsx` (2023-Q1 … 2026-Q4; e.g. 2026-Q3 = 149 + 165 + 242 = 556);
  edit, clear or add quarters; alert threshold (0%). CRM and MQL stage come from the Funnel settings. Net income, D&A and EBITDA follow the
  EBITDA classification.

## Mapping types
| Mapping | How it counts |
|---|---|
| Subscription – monthly | full amount in its invoice month |
| Subscription – quarterly | amount ÷ 3 in each of 3 months |
| Subscription – annual | amount ÷ 12 in each of 12 months |
| Retainer – only when repeated monthly | counts only when the same customer is billed the same amount in an adjacent month (Professional Services: retainers vs one-off projects) |
| Retainer – always recurring | full amount in its invoice month |
| Not MRR | never counts (overage, implementation, training, hardware, credits …) |

Quarterly/annual invoices dated on or after the *early-invoice day* (default 16) start the next month,
because renewals are invoiced up to 15 days early.

## Formula
MRR(customer, month) = monthly lines + Σ annual lines ÷ 12 + Σ quarterly lines ÷ 3 + retainers,
converted to USD at the month's CAD rate for Canadian customers.
MRR(month) = Σ customers · Active customers = customers with MRR > 0 · ARR = MRR × 12.

## Retention formula (Oryon spec "Retention")
Cohort = customers with MRR > 0 in the start month m0 (TTM: 12 months back; period: prior month or
prior quarter end). For each: a = MRR at m0, b = MRR at the end month, both at m0's CAD rate.
churn b = 0 → C += a · downgrade 0 < b < a → Dn += a − b · upgrade b > a → U += b − a · flat otherwise.
S = Σa, K = S − C − Dn, E = K + U · **GRR = K / S × 100 · NRR = E / S × 100**.
Points whose cohort starts within the first 11 months of MRR data are marked "partial data"
(annual invoices from before the data began aren't captured, so S is understated).

## New-logo formula (matches the Oryon report VC-03)
New logo = a QuickBooks customer whose MRR is above $0 for the first time (win-backs excluded).
Close month = first billing month − *New-logo billing lag* (Settings, default 1).
New-logo ARR = first-month MRR × 12 (annual deals: the first-year contract value).
Segment comes from the Salesforce account, joined on `qboCustomerId` (QBO_Customer_Id__c) or, when
that's empty, QuickBooks `displayName` = Account `name` after normalizing. Subsidiaries count as new
logos unless *Count a new subsidiary of a paying parent as expansion* is ticked in Settings.
New logos are counted from 12 months after MRR data begins; periods whose deals haven't billed yet
are marked incomplete. Growth = (period − same period last year) ÷ same period last year.

## CAC formula (Oryon spec VC-06)
For each month e, over the 12 months ending at e:
- S&M = sum of the selected expense accounts (`expenses[].amounts.Total`)
- new logos, new-logo ARR = counted new logos by close month (same list as the New logos page)
- GM = (sum of `income[]` − sum of `cogs[]`) ÷ sum of `income[]` (the lines, not `sectionTotals`)
- **CAC = S&M ÷ new logos**
- **CAC payback (months) = CAC ÷ ((new-logo ARR ÷ new logos ÷ 12) × GM)** – above 18 months is a warning
- **S&M per $1 of new ARR = S&M ÷ new-logo ARR**

A month is incomplete when its window has close months after the last complete one (deals that bill
after the last invoice month), starts before new logos are reliable, or is missing P&L months.

## COGS % formula (Oryon spec VC-04)
For a window W (month, quarter or trailing 12 months):
- **COGS % = 100 × COGS(W) ÷ Revenue(W)** – COGS includes capitalized-software amortization
- **Excl. capitalized software = 100 × (COGS − amortization) ÷ Revenue**
- **Product-line COGS % = 100 × line COGS ÷ line revenue**; **Platform share = 100 × Platform revenue ÷ revenue**

The snapshot has no QuickBooks Class, so product lines come from the account mapping. The Oryon
report splits by Class and keeps unclassed COGS (~$8k/month) unallocated, so Platform / Services
here run slightly higher than the report.

## G&A % formula (Oryon spec VC-09)
- **G&A %(W) = 100 × Σ G&A ÷ Revenue(W)**; TTM = 12 months' G&A ÷ 12 months' revenue
- G&A = the selected accounts; revenue = income accounts not excluded on the COGS % mapping

## EBITDA formula (Oryon spec VC-10)
- **EBITDA = Revenue − COGS − Opex + D&A**; **margin = 100 × EBITDA ÷ Revenue**
- **vs plan = margin − plan margin**, plan margin = Σ plan EBITDA ÷ Σ plan revenue over the period's months

## LTV / CAC formula (Oryon spec VC-07)
- **c = 1 − (GRR_TTM ÷ 100)^(1/12)**; **lifetime = min(1 ÷ c, 84)** (ltv_capped when the cap binds)
- **LTV = new-logo ARR ÷ (new logos × 12) × GM_TTM × lifetime**; **LTV/CAC = LTV ÷ CAC**
- equivalently LTV/CAC = lifetime ÷ CAC payback
- **VC-14 whole base: LTV_base = ARR(e) ÷ (active customers(e) × 12) × GM_TTM × lifetime**; ÷ CAC

## Recurring revenue % formula (Oryon spec VC-12)
- **Recurring % = 100 × Σ months Σ customers MRR (USD at each month's rate) ÷ GL revenue**
- **Account-tagged % = 100 × revenue on 4010 + 4015 ÷ GL revenue** (data-quality contrast)

## Revenue growth formula (Oryon spec VC-13)
- **Growth(W) = 100 × (Revenue(W) ÷ Revenue(W − 1y) − 1)**; revenue added = Revenue(W) − Revenue(W − 1y)
- recurring YoY on summed MRR; non-recurring YoY on revenue − MRR
- **vs plan = 100 × (Revenue(W) ÷ plan total revenue(W) − 1)**

## Cash & runway formula (Oryon spec CB-05)
- **Cash(e) = month-end balances of the selected unrestricted cash accounts** (1010 + 1015 + 1020;
  1030 restricted cash excluded) – fallback: BankAccounts total − restricted-cash amount
- **Runway = Cash(e) ÷ ((Cash(e−3) − Cash(e)) ÷ 3)**; null / "Self-funding" when cash did not fall

## FCF conversion formula (Oryon spec CB-07)
- **OCF_TTM = Net income_TTM + D&A_TTM − ΔWC**; ΔWC = [(AR + Prepaid + Inventory) − (AP + Cards +
  Accrued + Deferred rev.)] at e minus the same at e − 12; NI (after interest, FX, tax) and D&A
  (cogs D&A + D&A) from the EBITDA settings
- **Capex = increase in the month-end balances of the Capex accounts** (1510 + 1520 – the QuickBooks
  Statement of Cash Flows "Investing activities" lines) – fallback: Δ FixedAssets + D&A on fixed assets
- **FCF conversion % = (OCF − capex) ÷ EBITDA**, each summed over the trailing 12 months

## Cash conversion cycle formula (Oryon spec CB-10)
- **DSO = AR(e) ÷ Revenue_q × D**, **DIO = Inventory(e) ÷ COGS_q × D**, **DPO = AP(e) ÷ COGS_q × D**,
  **CCC = DSO + DIO − DPO**; e = the quarter's last month, D = calendar days in the quarter (92 for Q3);
  revenue and COGS (cogs + cogs D&A) from the EBITDA classification; $ view = AR + inventory − AP

## Customer concentration formula (Oryon spec CM-02)
- **Top-N share = 100 × Σ revenue of the N largest customer groups ÷ Σ revenue of all groups**, over the
  12 months ending at e; groups = top Salesforce parent, else QuickBooks parent, else the customer
- recognized revenue: annual-subscription lines spread 1/12 per month from the service start (invoice
  month, or the next month on/after the early-invoice day); other lines in their month; CAD → USD
- subs: largest group's share; top-N on invoice totals by invoice date

## Win rate formula (Oryon spec CM-03)
- deals = closed (won or lost) New Business deals with a close date in the trailing 6 months (12 on TTM)
- **Win rate vs c = 100 × won ÷ decided**, decided = deals naming c minus losses with a "no decision"
  loss reason; skipped when nothing was decided
- **Competitor logged = deals with a competitor ÷ all closed New Business deals** in the window

## Funnel conversion formula (Oryon spec CM-06)
- **MQL → SQL** = contacts with an MQL date in the cohort that have an SQL date ÷ those contacts
- **Lead → MQL** = marketing-sourced, non-duplicate contacts created in the cohort with an MQL date ÷ those
- **SQL cohort** = contacts with an SQL date in the cohort that also have an MQL date; **SQL → opportunity**
  = those with an opportunity date; **opportunity → won** = of those, on a won deal; **SQL → won** = SQL
  cohort on a won deal
- stage dates from `lifecycleStageHistory`; TTM pools 12 cohort months; immature under 60 / 90 / 180 days

## Diversification formula (Oryon spec ER-05)
- **Top-5 share = 100 × Σ revenue of the 5 largest customer groups ÷ Σ all groups**, TTM recognized revenue, rolling
  monthly - CM-02 with N = 5. Sep-2026: 8.48% vs the Oryon report's 8.38%.

## Marketing-sourced pipeline formula (Oryon spec CM-05)
- **Marketing-sourced % = 100 × Σ ARR (marketing lead source) ÷ Σ ARR (all)** of New Business deals created in W,
  duplicate-account deals excluded; sub = the same split of won new-logo ARR, close date in the trailing 12 months,
  accounts with an earlier win dropped. Matches the Oryon report on every quarter Q4-2023 … Q3-2026 (45.13% /
  54.17% for Q3-2026).

## Marketing ROI formula (Oryon spec CM-07)
- **ROI(W) = pipeline(W) ÷ spend(W)**; pipeline = ARR of new-business deals CREATED in W (any stage) with a
  marketing lead source; blended ÷ all marketing accounts, programs ÷ non-people marketing accounts, channel =
  that channel's deals ÷ its P&L accounts. Blended, programs and events match the Oryon report on every quarter
  Q1-2024 … Q3-2026 (Q4-2023 differs: the Oct-2023 P&L shows 6120 = $6,220).

## Lead volume vs plan formula (Oryon spec CM-08)
- **MQLs vs plan = 100 × (MQLs ÷ plan − 1)**; MQLs = contacts whose first MQL date is in W (recycled
  MQLs count once); plan = the Budget sheet's MQL targets in W (a month carries a third of its quarter)

## Data
Reads `invoices`, `products`, `quickbookscustomers`, `salesforceaccounts`, `plmonthlysnapshots` and
`balancesheetmonthlysnapshots` (override with `BS_MONTHLY_COLLECTION`)
(override with `PL_MONTHLY_COLLECTION`)
(override the last two with `QBO_CUSTOMERS_COLLECTION` / `SF_ACCOUNTS_COLLECTION`). Writes only its own collections, `mrr_product_mapping` and
`mrr_settings` (incl. `cac_account_ids`, `cogs_account_map`, `cogs_da_ids`, `ga_account_ids`, `ebitda_account_map`, `ebitda_da_ids`, `ebitda_plan`, `ltv_cap_months`, `ltv_threshold`, `ltv_grr_scope`, `recurring_tag_ids`, `cash_sections`, `cash_lookback_months`, `cash_show_ar_check`, `cash_account_map`, `cash_restricted_adjust`) – the backend's `products` collection is never changed.
