import { httpClient } from '../../../shared/api/httpClient'

/**
 * Client for the screen-shaped portfolio API (backend `modules/dashboard`,
 * /api/v1/dashboard). Goes through the shared axios client, so it carries the
 * session's access token and the silent refresh like every other request.
 * The organization comes from the token, never the URL.
 */
export interface PortfolioView {
  gran: 'M' | 'Q'
  month: string | null
  quarter: string | null
  window: 'P' | 'TTM'
  span: number
  /** 'All', or one or more QuickBooks item labels (as listed in meta.products) to filter by. */
  product?: 'All' | string[]
}

export interface PortfolioAlert {
  id: string
  period: string
  flag: 'Act now' | 'Watch'
  why: string
}

export interface PortfolioAlertsResult {
  quarters: string[]
  alerts: PortfolioAlert[]
}

export function viewParams(v: PortfolioView): URLSearchParams {
  const p = new URLSearchParams()
  const asOf = v.gran === 'M' ? v.month : v.quarter
  if (asOf) p.set('asOf', asOf)
  p.set('window', v.window)
  p.set('span', String(v.span))
  // Backend reads the first comma-separated label and matches it against ctx.products by label (dashboard.service.ts parseView).
  if (v.product && v.product !== 'All' && v.product.length > 0) p.set('product', v.product.join(','))
  return p
}

async function get<T>(path: string, params?: URLSearchParams): Promise<T> {
  try {
    const res = await httpClient.get<{ success: boolean; data: T }>(`/dashboard${path}`, { params })
    return res.data.data
  } catch (err) {
    const message = (err as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message
    throw new Error(message || (err as Error).message || 'Request failed')
  }
}

export const portfolioApi = {
  meta: () => get<Record<string, unknown>>('/meta'),
  overview: (v: PortfolioView, extra: Record<string, string> = {}) => {
    const p = viewParams(v)
    for (const [k, x] of Object.entries(extra)) p.set(k, x)
    return get<Record<string, unknown>>('/overview', p)
  },
  family: (family: string, v: PortfolioView) => get<Record<string, unknown>>(`/families/${family}`, viewParams(v)),
  metric: (metricId: string, v: PortfolioView) => get<Record<string, unknown>>(`/metrics/${metricId}`, viewParams(v)),
  alerts: (v: PortfolioView | null, n?: number) => {
    const p = v ? viewParams(v) : new URLSearchParams()
    if (n) p.set('n', String(n))
    return get<PortfolioAlertsResult>('/alerts', p)
  }
}
