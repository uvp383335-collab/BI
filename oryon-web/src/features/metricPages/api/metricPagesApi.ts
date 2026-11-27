import { httpClient } from '../../../shared/api/httpClient'

interface ApiEnvelope<T> {
  success: boolean
  data: T
}

/** One Oryon metric page (backend metrics/oryon/oryonPages.ts): the rows and headline rows the reference app's page shows. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type PagePayload = Record<string, any>

export async function getMetricPageRequest(page: string, query: Record<string, string>): Promise<PagePayload> {
  const res = await httpClient.get<ApiEnvelope<PagePayload>>(`/metrics/oryon/pages/${page}`, { params: query })
  return res.data.data
}

/** The drill-down behind one row (customers, accounts, deals …). */
export async function getMetricDetailRequest(page: string, query: Record<string, string>): Promise<PagePayload> {
  const res = await httpClient.get<ApiEnvelope<PagePayload>>(`/metrics/oryon/details/${page}`, { params: query })
  return res.data.data
}
