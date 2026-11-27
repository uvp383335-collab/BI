import { Request, Response } from 'express'
import { asyncHandler } from '../../../shared/utils/asyncHandler'
import { sendSuccess } from '../../../shared/utils/apiResponse'
import { AppError } from '../../../shared/utils/AppError'
import { analyzeChart, analyzeMetric, getLatestChartAnalysis } from '../service/aiAnalysis.service'
import { AnalyzeChartBody, AnalyzeMetricBody, analysisChartParamsSchema, analysisMetricParamsSchema } from '../validator/aiAnalysis.validator'
import { AnalysisChartKey } from '../service/chartDataRegistry'

function parseChartKey(req: Request): AnalysisChartKey {
  const result = analysisChartParamsSchema.safeParse(req.params)
  if (!result.success) {
    throw AppError.notFound('No AI analysis is available for this chart', 'ANALYSIS_CHART_NOT_FOUND')
  }
  return result.data.chartKey
}

/** Generates (or returns the cached) AI analysis report for one chart, always across all products — see aiAnalysis.service.ts's analyzeChart. */
export const analyzeChartHandler = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const chartKey = parseChartKey(req)
  const { refresh } = req.body as AnalyzeChartBody
  const result = await analyzeChart(req.auth!.orgId!, req.auth!.userId, chartKey, { refresh })
  sendSuccess(res, result)
})

/** The last report generated for a chart (or null), without calling Claude. */
export const getLatestChartAnalysisHandler = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const chartKey = parseChartKey(req)
  const result = await getLatestChartAnalysis(req.auth!.orgId!, chartKey)
  sendSuccess(res, result)
})

/** Short summary readout of one Oryon metric for the selection on screen — see aiAnalysis.service.ts's analyzeMetric. */
export const analyzeMetricHandler = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const params = analysisMetricParamsSchema.safeParse(req.params)
  if (!params.success) throw AppError.notFound('Unknown metric', 'METRIC_NOT_FOUND')
  const { refresh, view } = req.body as AnalyzeMetricBody
  const result = await analyzeMetric(req.auth!.orgId!, req.auth!.userId, params.data.metricId, view ?? {}, { refresh })
  sendSuccess(res, result)
})
