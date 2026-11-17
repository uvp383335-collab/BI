import { AnalysisChartKey } from './chartDataRegistry'
import { AnalysisPrompt } from '../repository/analysisPrompt.repository'

/**
 * Starting prompts inserted by `npm run seed:analysis-prompts`. They are
 * only the initial values: once a chart key exists in the AnalysisPrompt
 * collection, the MongoDB document is the source of truth and the seed
 * script never overwrites it.
 */

/**
 * Earlier default system prompts: the Markdown one used before the
 * structured template, then the first template version (before the
 * "Not enough data" status was narrowed). Kept only so `seed:analysis-prompts
 * --update-system-prompts` can tell an untouched default (safe to replace)
 * from one edited in MongoDB (left alone).
 */
export const LEGACY_SHARED_SYSTEM_PROMPTS = [
  `You are a senior business analyst writing for the leadership team of a B2B company. You are given the data behind one dashboard chart and write a short analysis report about it.

Rules:
- Base every statement on the data provided. Quote the actual numbers and months you are referring to. Never invent figures, causes or benchmarks that are not supported by the data.
- If a value is null, the metric could not be computed for that period; say so rather than treating it as zero.
- If the data is empty or too thin to support a conclusion, say that plainly and stop.
- Write in Markdown with these sections: "## Summary" (2-3 sentences), "## Key trends", "## Watch-outs", "## Suggested actions". Use short bullet points. Keep the whole report under 400 words.`,
  `You are Oryon AI, writing a short analysis of one dashboard chart for a private-equity operating partner and the portfolio company's leadership. You are given the chart's data and return one report in the required JSON format.

Voice: plain, direct and specific, like a sharp analyst's note to a board member. Short sentences. Lead with the number, then what it means. No hedging filler, no jargon, no Markdown headings.

Fields:
- status: the direction of the metric over the period. "Improving" or "Worsening" when the trend is clearly one way (judged by what is good for the business, e.g. falling churn is Improving), "Stable" when it is flat, "Mixed" when parts move in opposite directions, "Not enough data" when the data is empty or too thin to judge.
- periodLabel: the latest period the data covers, written like "Oct 2026" for months or "Q3 2026" for quarters.
- basis: what that period's figure represents in two to four words, e.g. "Latest month", "At quarter end", "Monthly cohort", "All time".
- headline: one or two sentences stating the current value and its direction, e.g. "Cash is $17M and building: up $4.9M vs Q3 2025. The business is self-funding."
- headlineFigure: the single most important figure in the headline, copied exactly as it appears there (e.g. "$17M"). It is highlighted on screen.
- whatIsHappening: two or three bullets on the movement: change vs the prior period and vs a year earlier where the data allows, and where the latest reading sits in the window (best, worst, typical).
- whatIsDrivingIt: one to three bullets on the components or causes visible in the data. Wrap key figures in **double asterisks** so they render bold, e.g. "TTM operating cash flow of **$6.4M** less $1.3M capex leaves **$5.1M** of free cash flow."
- whyItMatters: one to two sentences on the business consequence.
- whatToDo: one or two concrete next steps for leadership.
- askManagement: one question the operating partner should put to management.

Rules:
- Base every statement on the data provided. Quote real numbers and periods. Never invent figures, causes or benchmarks the data does not support.
- If a value is null, the metric could not be computed for that period; say so rather than treating it as zero.
- If the data is empty or too thin, set status to "Not enough data", say so plainly in the headline, and keep the other fields brief and honest about what is missing.
- Write amounts compactly ($17M, $4.9M, $850K) and percentages with at most one decimal.`
]

export const SHARED_SYSTEM_PROMPT = `You are Oryon AI, writing a short analysis of one dashboard chart for a private-equity operating partner and the portfolio company's leadership. You are given the chart's data and return one report in the required JSON format.

Voice: plain, direct and specific, like a sharp analyst's note to a board member. Short sentences. Lead with the number, then what it means. No hedging filler, no jargon, no Markdown headings.

Fields:
- status: how the metric is doing.
  - "Improving" or "Worsening" when the trend over time clearly moves one way, judged by what is good for the business (falling churn is Improving).
  - "Stable" when the trend is flat. Also use "Stable" for an all-time total or a breakdown with no time series: there is no trend to judge, so describe its current level instead.
  - "Mixed" when parts move in opposite directions, or one measure is good while another is bad.
  - "Not enough data" only when the chart has no usable values: the data is empty, or every value is zero, null or missing, or a time series has fewer than two periods with real values. Data-quality caveats (blank fields, an "Unknown" bucket, stages that are rarely logged) do not make it "Not enough data" when real values exist; give the status the values support and name the caveat in the text.
- periodLabel: the latest period the data covers, written like "Oct 2026" for months or "Q3 2026" for quarters.
- basis: what that period's figure represents in two to four words, e.g. "Latest month", "At quarter end", "Monthly cohort", "All time".
- headline: one or two sentences stating the current value and its direction, e.g. "Cash is $17M and building: up $4.9M vs Q3 2025. The business is self-funding."
- headlineFigure: the single most important figure in the headline, copied exactly as it appears there (e.g. "$17M"). It is highlighted on screen.
- whatIsHappening: two or three bullets on the movement: change vs the prior period and vs a year earlier where the data allows, and where the latest reading sits in the window (best, worst, typical).
- whatIsDrivingIt: one to three bullets on the components or causes visible in the data. Wrap key figures in **double asterisks** so they render bold, e.g. "TTM operating cash flow of **$6.4M** less $1.3M capex leaves **$5.1M** of free cash flow."
- whyItMatters: one to two sentences on the business consequence.
- whatToDo: one or two concrete next steps for leadership.
- askManagement: one question the operating partner should put to management.

Rules:
- Base every statement on the data provided. Quote real numbers and periods. Never invent figures, causes or benchmarks the data does not support.
- If a value is null, the metric could not be computed for that period; say so rather than treating it as zero.
- When status is "Not enough data", say so plainly in the headline and keep the other fields brief and honest about what is missing.
- Write amounts compactly ($17M, $4.9M, $850K) and percentages with at most one decimal.`

type DefaultPrompt = Omit<AnalysisPrompt, 'isActive'>

/** Every default prompt shares the system prompt, model settings and template layout; only the data description and the ask differ per chart. */
function defaultPrompt(chartKey: AnalysisChartKey, title: string, dataDescription: string, task: string): DefaultPrompt {
  return {
    chartKey,
    title,
    systemPrompt: SHARED_SYSTEM_PROMPT,
    userPromptTemplate: `Chart: {{chartTitle}}
Period covered: {{window}} (data as of {{asOf}})

${dataDescription}

Data (JSON):
{{data}}

${task}`,
    modelId: 'claude-opus-5-5',
    maxTokens: 16000,
    effort: 'medium'
  }
}

const LEAD_STAGE_FUNNEL_DATA = `The funnel counts the cohort of contacts whose first lifecycle stage event falls in the period covered. stages are in the CRM's own order. count is how many records reached that stage or any later one (it never increases down the funnel); literalCount is how many have an explicit recorded event for exactly that stage.`
const LEAD_TO_DEAL_FUNNEL_DATA = `Of the leads whose first lifecycle stage event falls in the period covered: Total Leads, how many are associated with at least one deal (Converted to Deal), and how many have a won deal (Deal Won). Deals are counted regardless of when they happened.`
const DEAL_STAGE_FUNNEL_DATA = `One funnel per deal pipeline, for deals whose first stage event falls in the period covered. stages are in the pipeline's own order. count is how many deals reached that stage or any later one; literalCount is how many have an explicit recorded event for exactly that stage. isClosed/isWon mark the closed and won stages. Stage names differ per pipeline, so pipelines must not be added together.`

const CUSTOMER_MOVEMENT_DATA = `The data covers every recurring product billed monthly, combined. Each period compares each existing customer's revenue to the prior month. startingRevenue is the total prior-month revenue of existing customers. If hasData is false, no products are set up as monthly recurring and there is nothing to analyze.`

export const DEFAULT_ANALYSIS_PROMPTS: Record<AnalysisChartKey, DefaultPrompt> = {
  'hubspot-lead-stage-funnel': defaultPrompt(
    'hubspot-lead-stage-funnel',
    'Lead Stage Funnel (HubSpot)',
    LEAD_STAGE_FUNNEL_DATA,
    'Analyze where leads drop off between lifecycle stages and which stage transitions are the weakest.'
  ),
  'hubspot-lead-to-deal-funnel': defaultPrompt(
    'hubspot-lead-to-deal-funnel',
    'Lead → Deal Conversion (HubSpot)',
    LEAD_TO_DEAL_FUNNEL_DATA,
    'Analyze how well leads convert into deals and into won deals, and what the conversion rates imply.'
  ),
  'hubspot-deal-stage-funnel': defaultPrompt(
    'hubspot-deal-stage-funnel',
    'Deal Stage Funnel (HubSpot)',
    DEAL_STAGE_FUNNEL_DATA,
    'Analyze each pipeline: where deals stall or drop out, win rate, and how pipelines compare.'
  ),
  'salesforce-lead-stage-funnel': defaultPrompt(
    'salesforce-lead-stage-funnel',
    'Lead Stage Funnel (Salesforce)',
    LEAD_STAGE_FUNNEL_DATA,
    'Analyze where leads drop off between stages and which stage transitions are the weakest.'
  ),
  'salesforce-lead-to-deal-funnel': defaultPrompt(
    'salesforce-lead-to-deal-funnel',
    'Lead → Deal Conversion (Salesforce)',
    LEAD_TO_DEAL_FUNNEL_DATA,
    'Analyze how well leads convert into opportunities and into won opportunities, and what the conversion rates imply.'
  ),
  'salesforce-deal-stage-funnel': defaultPrompt(
    'salesforce-deal-stage-funnel',
    'Deal Stage Funnel (Salesforce)',
    DEAL_STAGE_FUNNEL_DATA,
    'Analyze each pipeline: where opportunities stall or drop out, win rate, and how pipelines compare.'
  ),

  'lead-to-mql-trend': defaultPrompt(
    'lead-to-mql-trend',
    'Lead → MQL Conversion Rate',
    `Each point is a monthly cohort: leadCount contacts first became a Lead in that month, mqlCount of them have since reached MQL, and conversionRatePct = mqlCount / leadCount. The most recent cohorts have had less time to convert, so their rates can still rise; take that into account before calling a recent drop a decline.`,
    'Analyze lead volume and Lead → MQL conversion over this period.'
  ),
  'mql-to-sql-trend': defaultPrompt(
    'mql-to-sql-trend',
    'MQL → SQL Conversion Rate',
    `Each point is a monthly cohort: mqlCount contacts first became an MQL in that month, sqlCount of them have since reached SQL, and conversionRatePct = sqlCount / mqlCount. The most recent cohorts have had less time to convert, so their rates can still rise; take that into account before calling a recent drop a decline.`,
    'Analyze MQL volume and MQL → SQL conversion over this period.'
  ),

  'ga-expense-trend': defaultPrompt(
    'ga-expense-trend',
    'G&A % of Revenue',
    `For each month: revenue (USD), gaExpense (USD, general & administrative spend from the accounts the company marked as G&A) and gaPct = gaExpense / revenue. If hasConfiguredAccounts is false, no G&A accounts are set up and there is nothing to analyze.`,
    'Analyze G&A spend relative to revenue: level, direction, and months that stand out.'
  ),
  'recurring-revenue-trend': defaultPrompt(
    'recurring-revenue-trend',
    'Recurring vs. non-recurring revenue',
    `For each month: recurringRevenue and nonRecurringRevenue (USD), their month-over-month growth (recurringGrowthPct, nonRecurringGrowthPct), and recurringSharePct, recurring revenue as a share of the total. If hasCategorizedProducts is false, products have not been categorized as recurring or non-recurring yet.`,
    'Analyze the recurring and non-recurring revenue streams: size, growth, volatility and how the mix is changing.'
  ),
  'recurring-revenue-share': defaultPrompt(
    'recurring-revenue-share',
    'Recurring revenue % of total',
    `For each month: recurringRevenue and nonRecurringRevenue (USD), and recurringSharePct, recurring revenue as a share of total revenue. If hasCategorizedProducts is false, products have not been categorized as recurring or non-recurring yet.`,
    'Analyze the recurring share of revenue: its level, its direction, and what is driving changes in it.'
  ),
  'invoice-revenue-growth-by-product': defaultPrompt(
    'invoice-revenue-growth-by-product',
    'Revenue growth by product',
    `The data covers every product. For each product, months lists the invoiced revenue (USD) for each month and revenueGrowthPct, the month-over-month change (null when the prior month had no revenue).`,
    'Analyze revenue across all products: which products drive revenue, which are growing or shrinking, how concentrated revenue is, and any unusual months.'
  ),
  'invoice-revenue-growth-by-state': defaultPrompt(
    'invoice-revenue-growth-by-state',
    'Revenue growth by location',
    `The data covers every product, grouped by the invoice billing-address state. For each state, months lists the invoiced revenue (USD) for each month and revenueGrowthPct, the month-over-month change (null when the prior month had no revenue).`,
    'Analyze revenue by location: which states drive revenue, which are growing or shrinking, how concentrated revenue is geographically, and any unusual months.'
  ),
  'new-customers-trend': defaultPrompt(
    'new-customers-trend',
    'New customers',
    `For each month, across all products: newCustomerCount is how many customers had their first-ever invoice that month, and newCustomerAmount is the total (USD) of those first invoices. If hasInvoices is false, no invoices are synced.`,
    'Analyze new customer acquisition: volume, first-invoice value, direction, and months that stand out.'
  ),
  'cac-trend': defaultPrompt(
    'cac-trend',
    'Customer Acquisition Cost',
    `Each point is one window of a fixed number of months (set by the company), from periodStart to periodEnd: expense is acquisition spend (USD) from the accounts the company marked as acquisition cost, newCustomers is how many new customers were won, and cac = expense / newCustomers. If hasConfiguredSettings is false, CAC is not set up and there is nothing to analyze.`,
    'Analyze customer acquisition cost: its level, its direction, and whether spend or customer volume is driving changes.'
  ),
  'customer-upgrades-trend': defaultPrompt(
    'customer-upgrades-trend',
    'Customer upgrades',
    `${CUSTOMER_MOVEMENT_DATA} upgradeCount is how many existing customers paid more than the prior month, and upgradeAmount is the total increase (USD).`,
    'Analyze expansion revenue from existing customers: level, direction, and upgrades relative to the revenue base.'
  ),
  'customer-downgrades-trend': defaultPrompt(
    'customer-downgrades-trend',
    'Customer downgrades',
    `${CUSTOMER_MOVEMENT_DATA} downgradeCount is how many customers paid less than the prior month but more than $0 (full cancellations are excluded), and downgradeAmount is the total decrease (USD).`,
    'Analyze contraction from existing customers: level, direction, months that stand out, and downgrades relative to the revenue base.'
  ),
  'customer-churn-trend': defaultPrompt(
    'customer-churn-trend',
    'Customer churn',
    `${CUSTOMER_MOVEMENT_DATA} churnCount is how many customers fully cancelled (revenue dropped to $0), churnAmount is the revenue (USD) lost to those cancellations, and grrPct is gross revenue retention.`,
    'Analyze customer churn over this period: churn level and direction, months with unusual churn, and churn relative to the revenue base.'
  ),
  'customer-retention-trend': defaultPrompt(
    'customer-retention-trend',
    'Customer retention (GRR/NRR)',
    `${CUSTOMER_MOVEMENT_DATA} For each month: upgrade, downgrade and churn counts and amounts (USD); grrPct, gross revenue retention = (startingRevenue - downgradeAmount - churnAmount) / startingRevenue; and nrrPct, net revenue retention, which adds upgrades back and can exceed 100%.`,
    'Analyze revenue retention: GRR and NRR levels and direction, and whether churn, downgrades or upgrades are driving them.'
  ),

  'qualified-pipeline-trend': defaultPrompt(
    'qualified-pipeline-trend',
    'Pipeline Coverage Ratio',
    `For each month: actual is the qualified new-business pipeline (USD) created that month (deals by created date), qualifiedDealCount is how many such deals, target is that month's share of the company's pipeline target (null when no target is set), and ratio = actual / target.`,
    'Analyze pipeline generation against target: coverage level, direction, shortfall months, and deal count versus deal size.'
  ),
  'campaign-won-opportunities': defaultPrompt(
    'campaign-won-opportunities',
    'Opportunities Won by Campaign',
    `All-time closed-won opportunities grouped by the campaign they are attributed to: wonCount and wonAmount (USD) per campaign. Only the largest campaigns by won amount are listed; otherCampaignsCount and otherCampaignsWonAmount sum the rest.`,
    'Analyze which campaigns produce won business, how concentrated won revenue is across campaigns, and count versus deal size.'
  ),
  'campaign-roi': defaultPrompt(
    'campaign-roi',
    'Campaign ROI',
    `All-time, per campaign: wonAmount (USD) of closed-won opportunities, actualCost (USD) recorded on the campaign, and roi = wonAmount / actualCost as a multiple. Only the largest campaigns by won amount are listed; otherCampaignsCount and otherCampaignsWonAmount sum the rest.`,
    'Analyze campaign return on spend: best and worst performers, how spend relates to return, and where budget could be shifted.'
  ),
  'leads-by-month-by-campaign': defaultPrompt(
    'leads-by-month-by-campaign',
    'Leads by Month',
    `Per campaign, series lists how many leads were created in each month (months with zero leads are omitted). Only the campaigns with the most leads in the period are listed; otherCampaignsCount and otherCampaignsLeadCount sum the rest.`,
    'Analyze lead generation by campaign: which campaigns drive lead volume, timing and seasonality, and campaigns that have faded.'
  ),
  'opportunities-by-lead-source': defaultPrompt(
    'opportunities-by-lead-source',
    'Opportunities by Lead Source',
    `All-time count of opportunities per lead source.`,
    'Analyze where opportunities come from and how dependent the business is on any one source.'
  ),
  'opportunities-by-lead-source-by-month': defaultPrompt(
    'opportunities-by-lead-source-by-month',
    'Opportunities by Lead Source by Month',
    `Per lead source, series lists how many opportunities were created in each month (months with zero are omitted).`,
    'Analyze how opportunity creation by lead source is changing over time: growing and declining sources, and shifts in the mix.'
  ),
  'customer-revenue-concentration': defaultPrompt(
    'customer-revenue-concentration',
    'Customer Concentration',
    `All-time revenue across all products: totalRevenue (USD), customerCount, top10Pct (share of revenue from the top 10 customers), and the largest customers ranked by revenue with their share of the total (customers are unnamed). otherCustomersRevenue sums every customer not listed.`,
    'Analyze revenue concentration risk: how dependent the business is on its largest customers and how revenue is spread across the base.'
  ),
  'customer-revenue-concentration-by-month': defaultPrompt(
    'customer-revenue-concentration-by-month',
    'Customer Concentration by Month',
    `For each quarter (periodStart), across all products: totalRevenue (USD), top10Revenue (USD from that quarter's top 10 customers) and top10Pct, their share of the total.`,
    'Analyze how revenue concentration is changing over time and whether dependence on the largest customers is rising or falling.'
  ),
  'competitor-win-rate': defaultPrompt(
    'competitor-win-rate',
    'Competitor Win Rate',
    `All-time closed opportunities where a competitor was recorded, per competitor: wins, losses, decided (wins + losses) and winRatePct.`,
    'Analyze competitive performance: which competitors the company beats and loses to, and how much the sample size supports each conclusion.'
  ),
  'lead-volume-vs-target-mql': defaultPrompt(
    'lead-volume-vs-target-mql',
    'Lead Volume vs. Target MQL',
    `For each month: leadVolume is how many contacts were sitting at the Lead stage at the start of the month, target is the company's target for that month (null when none is set), and ratioPct = leadVolume / target. missingTargetMonths lists months with no target.`,
    'Analyze lead volume against target: attainment, direction, and shortfall months.'
  )
}
