import { useMutation } from '@tanstack/react-query'
import { AnalysisChartKey, analyzeChartRequest } from '../api/aiAnalysisApi'

/**
 * A mutation rather than a query: generating a report can cost a Claude
 * call, so it only runs when the user asks for it (never on mount or
 * window refocus). The server returns its cached report when the chart's
 * data and prompt haven't changed, so re-opening is cheap.
 */
export function useChartAnalysis(chartKey: AnalysisChartKey) {
  return useMutation({
    mutationKey: ['ai-analysis', chartKey],
    mutationFn: (refresh: boolean) => analyzeChartRequest(chartKey, refresh)
  })
}
