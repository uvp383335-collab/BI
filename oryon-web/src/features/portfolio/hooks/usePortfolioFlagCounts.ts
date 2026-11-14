import { useQuery } from '@tanstack/react-query'
import { useAuthContext } from '../../../shared/context/AuthContext'
import { portfolioApi } from '../api/portfolioApi'

export type FlagCounts = Record<string, { n: number; hot: boolean }>

/** Flags raised in the latest completed quarter, per metric family plus a total, for the sidebar badges. */
export function usePortfolioFlagCounts(): FlagCounts {
  const { isAuthenticated, organization } = useAuthContext()
  const { data } = useQuery({
    queryKey: ['portfolio', 'flag-counts', organization?.id],
    queryFn: () => portfolioApi.alerts(null, 1),
    enabled: isAuthenticated,
    staleTime: 5 * 60 * 1000
  })
  const counts: FlagCounts = {}
  if (!data) return counts
  const add = (key: string, hot: boolean) => {
    const c = (counts[key] ??= { n: 0, hot: false })
    c.n += 1
    c.hot ||= hot
  }
  for (const a of data.alerts) {
    add(a.id.slice(0, 2), a.flag === 'Act now')
    add('alerts', a.flag === 'Act now')
  }
  return counts
}
