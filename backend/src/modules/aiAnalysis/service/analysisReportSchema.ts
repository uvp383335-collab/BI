import { z } from 'zod'

/**
 * The fixed shape of every AI analysis report, rendered by the frontend's
 * analysis drawer as: status pill, period line, headline (with one figure
 * highlighted), "What is happening", "What is driving it", "Why it
 * matters", and a "What to do" box ending with one question for management.
 *
 * Claude is constrained to this JSON with structured outputs, so prompts in
 * MongoDB control the wording but not the layout.
 */
export const ANALYSIS_STATUSES = ['Improving', 'Stable', 'Mixed', 'Worsening', 'Not enough data'] as const

export const analysisReportSchema = z.object({
  status: z.enum(ANALYSIS_STATUSES),
  periodLabel: z.string(),
  basis: z.string(),
  headline: z.string(),
  headlineFigure: z.string(),
  whatIsHappening: z.array(z.string()),
  whatIsDrivingIt: z.array(z.string()),
  whyItMatters: z.string(),
  whatToDo: z.array(z.string()),
  askManagement: z.string()
})

export type AnalysisReport = z.infer<typeof analysisReportSchema>

/** JSON Schema sent as `output_config.format` — mirrors `analysisReportSchema`. */
export const ANALYSIS_REPORT_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['status', 'periodLabel', 'basis', 'headline', 'headlineFigure', 'whatIsHappening', 'whatIsDrivingIt', 'whyItMatters', 'whatToDo', 'askManagement'],
  properties: {
    status: { type: 'string', enum: [...ANALYSIS_STATUSES] },
    periodLabel: { type: 'string' },
    basis: { type: 'string' },
    headline: { type: 'string' },
    headlineFigure: { type: 'string' },
    whatIsHappening: { type: 'array', items: { type: 'string' } },
    whatIsDrivingIt: { type: 'array', items: { type: 'string' } },
    whyItMatters: { type: 'string' },
    whatToDo: { type: 'array', items: { type: 'string' } },
    askManagement: { type: 'string' }
  }
}

/**
 * Bumped whenever the report shape changes. Part of the cache key, so
 * reports stored in an older shape are never served as the new one.
 */
export const REPORT_FORMAT_VERSION = 'structured-v1'

/** Parses a stored report; null for anything not in the current shape (e.g. a Markdown report from before the template). */
export function parseStoredReport(raw: string): AnalysisReport | null {
  try {
    const parsed = analysisReportSchema.safeParse(JSON.parse(raw))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}
