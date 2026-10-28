import { z } from 'zod'

export const createOrganizationSchema = z.object({
  name: z.string().min(1, 'Organization name is required').max(150)
})

export type CreateOrganizationInput = z.infer<typeof createOrganizationSchema>

// Salesforce API field names: start with a letter, then letters/digits/underscores
// (custom fields end in `__c`, e.g. `Competitor__c`) — validated here so a bad value
// never reaches SOQL string interpolation in salesforce.service.ts.
const SALESFORCE_FIELD_NAME_REGEX = /^[A-Za-z][A-Za-z0-9_]*$/

export const updateOrganizationSettingsSchema = z
  .object({
    // `null` clears competitor tracking (un-configured).
    salesforceCompetitorSource: z.enum(['field', 'junction']).nullable(),
    // Only meaningful (and required) when salesforceCompetitorSource is 'field'.
    salesforceCompetitorField: z
      .string()
      .max(80)
      .regex(SALESFORCE_FIELD_NAME_REGEX, 'Must be a valid Salesforce field API name')
      .nullable()
  })
  .refine((data) => data.salesforceCompetitorSource !== 'field' || !!data.salesforceCompetitorField, {
    message: 'salesforceCompetitorField is required when salesforceCompetitorSource is "field"',
    path: ['salesforceCompetitorField']
  })

export type UpdateOrganizationSettingsInput = z.infer<typeof updateOrganizationSettingsSchema>

// Per-org custom Opportunity fields for the detail view (Order Number, Current Generator(s), etc. —
// see Organization.model.ts). Capped at 10 entries: this is a handful of manually-configured
// detail-panel fields, not a general-purpose schema mapper.
export const updateSalesforceOpportunityExtraFieldsSchema = z.object({
  fields: z
    .array(
      z.object({
        apiName: z.string().min(1).max(80).regex(SALESFORCE_FIELD_NAME_REGEX, 'Must be a valid Salesforce field API name'),
        label: z.string().min(1, 'Label is required').max(80)
      })
    )
    .max(10)
})

export type UpdateSalesforceOpportunityExtraFieldsInput = z.infer<typeof updateSalesforceOpportunityExtraFieldsSchema>

// QuickBooks account ids as they appear on report leaf rows (`ColData[0].id`) -- plain
// numeric-ish strings, not a format Intuit documents precisely, so just non-empty/bounded.
const QUICKBOOKS_ACCOUNT_ID_REGEX = /^[A-Za-z0-9_-]{1,40}$/

// CB-07/CB-10 (see Organization.model.ts) -- an org explicitly picks which QuickBooks
// accounts feed these ratios; `null` clears a single-account field back to "not configured".
export const updateCashMetricsAccountsSchema = z.object({
  cb07ExpenditureAccountIds: z.array(z.string().regex(QUICKBOOKS_ACCOUNT_ID_REGEX)).max(50),
  cb10AccountsReceivableAccountId: z.string().regex(QUICKBOOKS_ACCOUNT_ID_REGEX).nullable(),
  cb10AccountsPayableAccountId: z.string().regex(QUICKBOOKS_ACCOUNT_ID_REGEX).nullable(),
  cb10InventoryAccountId: z.string().regex(QUICKBOOKS_ACCOUNT_ID_REGEX).nullable()
})

export type UpdateCashMetricsAccountsInput = z.infer<typeof updateCashMetricsAccountsSchema>

// G&A % of Revenue (see Organization.model.ts) — an org explicitly picks which QuickBooks
// P&L Expense/Other-Expense accounts count as G&A; never guessed from account names.
export const updateGAndAAccountsSchema = z.object({
  gaExpenseAccountIds: z.array(z.string().regex(QUICKBOOKS_ACCOUNT_ID_REGEX)).max(100)
})

export type UpdateGAndAAccountsInput = z.infer<typeof updateGAndAAccountsSchema>

// Customer Acquisition Cost (see Organization.model.ts) — an org explicitly picks which
// QuickBooks P&L expense accounts count as acquisition spend, plus the non-overlapping
// window size (in months) CAC is computed over. Never guessed from account names or
// defaulted to a window size.
export const updateCACSettingsSchema = z.object({
  cacExpenseAccountIds: z.array(z.string().regex(QUICKBOOKS_ACCOUNT_ID_REGEX)).max(100),
  cacDurationMonths: z.number().int().min(1).max(12)
})

export type UpdateCACSettingsInput = z.infer<typeof updateCACSettingsSchema>

// CM-07 Marketing ROI (see Organization.model.ts) — an org explicitly picks which QuickBooks
// P&L expense accounts are marketing spend; never guessed from account names.
export const updateMarketingSpendAccountsSchema = z.object({
  marketingSpendAccountIds: z.array(z.string().regex(QUICKBOOKS_ACCOUNT_ID_REGEX)).max(100)
})

export type UpdateMarketingSpendAccountsInput = z.infer<typeof updateMarketingSpendAccountsSchema>

// HubSpot history source (see Organization.model.ts) — `true` reads the `rl_*` imported
// history, `false` goes back to HubSpot's native fields (the default).
export const updateHubSpotHistorySourceSchema = z.object({
  hubspotUseImportedHistory: z.boolean()
})

export type UpdateHubSpotHistorySourceInput = z.infer<typeof updateHubSpotHistorySourceSchema>

const MONTH_REGEX = /^\d{4}-(0[1-9]|1[0-2])$/

// Plan targets per inclusive month range (CM-04's new-business amounts, CM-08's MQL counts —
// see Organization.model.ts). `YYYY-MM` strings compare correctly as plain strings, so range
// checks need no date parsing. Ranges may not overlap: a month covered twice would have no
// single target.
const monthRange = {
  fromMonth: z.string().regex(MONTH_REGEX, 'Must be a month (YYYY-MM)'),
  toMonth: z.string().regex(MONTH_REGEX, 'Must be a month (YYYY-MM)')
}

function monthRangeTargetsSchema<T extends { fromMonth: string; toMonth: string }>(row: z.ZodType<T>) {
  return z
    .array(row.refine((t) => t.fromMonth <= t.toMonth, { message: 'From month must be on or before To month', path: ['toMonth'] }))
    .max(60)
    .superRefine((targets, ctx) => {
      const sorted = targets.map((t, index) => ({ ...t, index })).sort((a, b) => a.fromMonth.localeCompare(b.fromMonth))
      for (let i = 1; i < sorted.length; i++) {
        if (sorted[i].fromMonth <= sorted[i - 1].toMonth) {
          ctx.addIssue({
            code: 'custom',
            message: `Overlaps ${sorted[i - 1].fromMonth} – ${sorted[i - 1].toMonth}`,
            path: [sorted[i].index, 'fromMonth']
          })
        }
      }
    })
}

export const updateCm04TargetsSchema = z.object({
  targets: monthRangeTargetsSchema(z.object({ ...monthRange, targetAmount: z.number().positive('Target must be greater than 0').max(1e12) }))
})

export type UpdateCm04TargetsInput = z.infer<typeof updateCm04TargetsSchema>

export const updateCm08MqlTargetsSchema = z.object({
  targets: monthRangeTargetsSchema(z.object({ ...monthRange, targetCount: z.number().positive('Target must be greater than 0').max(1e9) }))
})

export type UpdateCm08MqlTargetsInput = z.infer<typeof updateCm08MqlTargetsSchema>
