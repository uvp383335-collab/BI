import { z } from 'zod'
import { ANALYSIS_CHART_KEYS } from '../service/chartDataRegistry'
import { dashboardQuerySchema, metricParamsSchema } from '../../dashboard/validator/dashboard.validator'

// Only chart keys that have a server-side data loader are accepted — the
// client names the chart, never supplies its data.
export const analysisChartParamsSchema = z.object({
  chartKey: z.enum(ANALYSIS_CHART_KEYS)
})

export type AnalysisChartParams = z.infer<typeof analysisChartParamsSchema>

// POST /ai-analysis/:chartKey
export const analyzeChartBodySchema = z
  .object({
    refresh: z.boolean().optional()
  })
  .strict()

export type AnalyzeChartBody = z.infer<typeof analyzeChartBodySchema>

// POST /ai-analysis/metrics/:metricId — the drawer's current selection travels in the body.
export const analysisMetricParamsSchema = metricParamsSchema

export const analyzeMetricBodySchema = z
  .object({
    refresh: z.boolean().optional(),
    view: dashboardQuerySchema.pick({ asOf: true, window: true, span: true, product: true }).strict().optional()
  })
  .strict()

export type AnalyzeMetricBody = z.infer<typeof analyzeMetricBodySchema>
