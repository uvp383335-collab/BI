# docs/server.js — Metric & Chart Gap List

`docs/server.js` is a standalone QuickBooks-only prototype (not wired into `backend/`/
`frontend/`). This tracks its coverage against the 21 MVP metrics defined in
`sherpai-metrics-implementation-guide.md`. Note: all 21 are already marked **Done** in the real
app per `sherpai-metrics-progress.md` — this file is purely about what this one prototype script
covers, not the platform's actual metric coverage.

---

## 1. Ratios implemented in `docs/server.js`

| # | Ratio | Metric ID | Formula location | Notes |
|---|---|---|---|---|
| 1 | Revenue growth % (month over month) | VC-13 (partial) | `buildMonthlyMetrics` | No recurring/non-recurring split |
| 2 | EBITDA margin % | VC-10 | `buildMonthlyMetrics` | Net Operating Income + D&A add-back |
| 3 | COGS % of revenue | VC-04 (partial) | `buildMonthlyMetrics` | No product/market mix breakdown, only single-item filter |
| 4 | G&A % of revenue | VC-09 | `buildMonthlyMetrics` | Approximated as total operating expenses, not chart-of-accounts G&A tag |
| 5 | Customer concentration (Top-N % of revenue) | CM-02 | `renderCustomerConcentrationChart` | Client-side from per-customer P&L pulls |

## 2. Ratios missing from `docs/server.js`

| # | Ratio | Metric ID | Requires |
|---|---|---|---|
| 1 | Gross Revenue Retention Rate | VC-01 | QuickBooks Invoice sync + roll-forward |
| 2 | Net Revenue Retention Rate | VC-02 | Same as VC-01 |
| 3 | New-Logo Revenue Growth Rate | VC-03 | Invoice sync + customer dedup |
| 4 | CAC & Payback Period | VC-06 | Salesforce Opportunity data + P&L S&M mapping |
| 5 | LTV:CAC (New Customers) | VC-07 | VC-01 + VC-04 + VC-06 outputs |
| 6 | Recurring Revenue % of Total | VC-12 | Invoice sync + recurring tagging |
| 7 | LTV:CAC (Whole Base) | VC-14 | VC-01 + VC-06 outputs |
| 8 | Cash Position & Runway | CB-05 | Daily cash balance snapshot |
| 9 | Free Cash Flow Conversion | CB-07 | VC-10 (EBITDA) + cash flow data |
| 10 | Cash Conversion Cycle | CB-10 | P&L + balance sheet combined |
| 11 | Competitive Win Rate | CM-03 | Salesforce competitor field/junction object |
| 12 | Pipeline Coverage Ratio | CM-04 | Salesforce pipeline + operating-plan target |
| 13 | Marketing-Sourced Pipeline & Revenue % | CM-05 | HubSpot `hs_analytics_source` + Invoice sync |
| 14 | Funnel Conversion Rates (Lead→MQL→SQL→Won) | CM-06 | HubSpot lifecycle-stage mapping |
| 15 | Marketing ROI by Channel | CM-07 | HubSpot Campaigns API + P&L marketing spend |
| 16 | Lead Volume vs. Plan (MQL Flow) | CM-08 | CM-06 mapping + operating plan |

## 3. Graphs implemented in `docs/server.js`

| # | Chart | Function | Type |
|---|---|---|---|
| 1 | Revenue growth % | `renderBarChart` (trend section) | Bar |
| 2 | EBITDA margin % | `renderBarChart` (trend section) | Bar |
| 3 | COGS % of revenue | `renderBarChart` (trend section) | Bar |
| 4 | G&A % of revenue | `renderBarChart` (trend section) | Bar |
| 5 | Revenue growth by product (single/all products) | `renderProductRevenueChart` | Multi-series bar |
| 6 | Customer concentration (Top-N % of revenue) | `renderCustomerConcentrationChart` | Multi-series bar w/ tooltip breakdown |

## 4. Graphs missing from `docs/server.js`

One chart per missing ratio in §2 — none exist yet for:

- Gross/Net Revenue Retention (VC-01, VC-02)
- New-Logo Revenue Growth (VC-03)
- CAC & Payback Period, LTV:CAC new/whole-base (VC-06, VC-07, VC-14)
- Recurring Revenue % of Total (VC-12)
- Cash Position & Runway (CB-05)
- Free Cash Flow Conversion (CB-07)
- Cash Conversion Cycle (CB-10)
- Competitive Win Rate (CM-03)
- Pipeline Coverage Ratio (CM-04)
- Marketing-Sourced Pipeline & Revenue % (CM-05)
- Funnel Conversion Rates (CM-06)
- Marketing ROI by Channel (CM-07)
- Lead Volume vs. Plan (CM-08)

## 5. Why the gap exists

`docs/server.js` only pulls from QuickBooks (`BalanceSheet`, `CashFlow`, `ProfitAndLoss`,
`Item`, `Customer`, `Department` — no Salesforce or HubSpot calls). Every missing ratio above
needs Salesforce (Opportunity/Account/competitor fields) or HubSpot
(`hs_analytics_source`, lifecycle-stage, Campaigns API) data per the gap table in
`sherpai-metrics-implementation-guide.md` §"Cross-metric gap summary" — none of that plumbing
exists in this file.
