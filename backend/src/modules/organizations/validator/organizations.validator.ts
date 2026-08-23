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
