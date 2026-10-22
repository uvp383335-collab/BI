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
