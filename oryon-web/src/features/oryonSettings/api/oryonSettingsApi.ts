import { httpClient } from '../../../shared/api/httpClient'

interface ApiEnvelope<T> {
  success: boolean
  data: T
}

/**
 * Oryon metric settings (backend `metrics/oryon/oryonSettings.service.ts`): the
 * same sections, values and automatic suggestions as the reference Python
 * app's Settings page. Every section is saved on its own and can be reset to
 * the automatic choices.
 */
// The payload is wide and section-specific; each section component reads its own slice.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type OryonSettings = Record<string, any>

export async function getOryonSettingsRequest(): Promise<OryonSettings> {
  const res = await httpClient.get<ApiEnvelope<OryonSettings>>('/metrics/oryon/settings')
  return res.data.data
}

export async function saveOryonSettingsRequest(section: string, body: unknown): Promise<void> {
  await httpClient.put(`/metrics/oryon/settings/${section}`, body)
}

export async function resetOryonSettingsRequest(section: string): Promise<void> {
  await httpClient.delete(`/metrics/oryon/settings/${section}`)
}
