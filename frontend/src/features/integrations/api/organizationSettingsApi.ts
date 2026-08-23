import { httpClient } from '../../../shared/api/httpClient'

interface ApiEnvelope<T> {
  success: boolean
  data: T
}

export type SalesforceCompetitorSource = 'field' | 'junction'

export interface OrganizationSettings {
  salesforceCompetitorSource?: SalesforceCompetitorSource
  /** Only meaningful when salesforceCompetitorSource is 'field'. */
  salesforceCompetitorField?: string
}

export async function getOrganizationSettingsRequest(): Promise<OrganizationSettings> {
  const res = await httpClient.get<ApiEnvelope<OrganizationSettings>>('/organizations/settings')
  return res.data.data
}

/** Pass `source: null` to clear competitor tracking entirely (un-configured). */
export async function updateOrganizationSettingsRequest(
  source: SalesforceCompetitorSource | null,
  field: string | null
): Promise<OrganizationSettings> {
  const res = await httpClient.patch<ApiEnvelope<OrganizationSettings>>('/organizations/settings', {
    salesforceCompetitorSource: source,
    salesforceCompetitorField: field
  })
  return res.data.data
}
