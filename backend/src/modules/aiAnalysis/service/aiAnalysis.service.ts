import { createHash } from 'crypto'
import { AppError } from '../../../shared/utils/AppError'
import { generateWithClaude } from '../../../shared/llm/claudeClient'
import { analysisPromptRepository, AnalysisPrompt } from '../repository/analysisPrompt.repository'
import { analysisReportRepository } from '../repository/analysisReport.repository'
import { AnalysisChartKey, AnalysisWindow, CHART_DATA_REGISTRY, currentAnalysisWindow, describeCoverage } from './chartDataRegistry'
import { getMetric, DashboardQuery } from '../../dashboard/service/dashboard.service'
import { METRIC_SUMMARY_PROMPT_KEY } from './defaultPrompts'
import { ANALYSIS_REPORT_JSON_SCHEMA, AnalysisReport, REPORT_FORMAT_VERSION, analysisReportSchema, parseStoredReport } from './analysisReportSchema'

export interface ChartAnalysisResult {
  chartKey: string
  title: string
  report: AnalysisReport
  model: string
  window: AnalysisWindow
  /** What the analyzed data covers in words — the window, or e.g. "All time" for charts that aren't windowed. */
  coverage: string
  generatedAt: string
  cached: boolean
}

export interface AnalyzeChartOptions {
  /** Skip the cached report and always generate a new one. */
  refresh?: boolean
}

/** Replaces each `{{name}}` placeholder; unknown placeholders are left as-is so a typo in a MongoDB-edited prompt is visible in the output rather than silently blank. */
export function renderTemplate(template: string, values: Record<string, string>): string {
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (match, name: string) => (name in values ? values[name] : match))
}

function computeCacheKey(prompt: AnalysisPrompt, systemPrompt: string, userPrompt: string): string {
  return createHash('sha256')
    .update(JSON.stringify([REPORT_FORMAT_VERSION, prompt.modelId, prompt.effort, prompt.maxTokens, systemPrompt, userPrompt]))
    .digest('hex')
}

/** Structured outputs guarantee the shape; this still validates so a bad response fails loudly instead of being cached. */
function parseGeneratedReport(text: string): AnalysisReport {
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch {
    throw new AppError('AI analysis returned an unreadable report', 502, 'AI_INVALID_REPORT')
  }
  const parsed = analysisReportSchema.safeParse(json)
  if (!parsed.success) {
    throw new AppError('AI analysis returned an unreadable report', 502, 'AI_INVALID_REPORT')
  }
  return parsed.data
}

async function loadActivePrompt(chartKey: string): Promise<AnalysisPrompt> {
  const prompt = await analysisPromptRepository.findActiveByChartKey(chartKey)
  if (!prompt) {
    throw new AppError('AI analysis is not configured for this chart', 404, 'ANALYSIS_PROMPT_NOT_FOUND')
  }
  return prompt
}

/**
 * Generates (or returns the cached) AI analysis report for one chart. The
 * chart's data is always loaded server-side with every dashboard filter
 * off — see chartDataRegistry.ts — so the report covers all products no
 * matter what the user has selected on the chart itself.
 */
export async function analyzeChart(orgId: string, userId: string, chartKey: AnalysisChartKey, options: AnalyzeChartOptions = {}): Promise<ChartAnalysisResult> {
  const prompt = await loadActivePrompt(chartKey)
  const definition = CHART_DATA_REGISTRY[chartKey]
  const window = currentAnalysisWindow()
  const data = await definition.load({ orgId, window })

  const userPrompt = renderTemplate(prompt.userPromptTemplate, {
    chartTitle: definition.title,
    window: describeCoverage(definition, window),
    asOf: window.to,
    data: JSON.stringify(data)
  })
  const cacheKey = computeCacheKey(prompt, prompt.systemPrompt, userPrompt)

  if (!options.refresh) {
    const cached = await analysisReportRepository.findByCacheKey(orgId, chartKey, cacheKey)
    const cachedReport = cached ? parseStoredReport(cached.report) : null
    if (cached && cachedReport) {
      return {
        chartKey,
        title: prompt.title,
        report: cachedReport,
        model: cached.modelId,
        window: { from: cached.windowFrom, to: cached.windowTo },
        coverage: describeCoverage(definition, { from: cached.windowFrom, to: cached.windowTo }),
        generatedAt: cached.createdAt.toISOString(),
        cached: true
      }
    }
  }

  const generated = await generateWithClaude({
    model: prompt.modelId,
    maxTokens: prompt.maxTokens,
    effort: prompt.effort,
    system: prompt.systemPrompt,
    user: userPrompt,
    jsonSchema: ANALYSIS_REPORT_JSON_SCHEMA
  })

  const report = parseGeneratedReport(generated.text)

  const saved = await analysisReportRepository.create(orgId, {
    chartKey,
    cacheKey,
    report: JSON.stringify(report),
    modelId: generated.model,
    windowFrom: window.from,
    windowTo: window.to,
    inputTokens: generated.inputTokens,
    outputTokens: generated.outputTokens,
    generatedBy: userId
  })

  return {
    chartKey,
    title: prompt.title,
    report,
    model: saved.modelId,
    window,
    coverage: describeCoverage(definition, window),
    generatedAt: saved.createdAt.toISOString(),
    cached: false
  }
}

/** The most recently generated report for a chart, or null — lets the UI show the last analysis without spending a Claude call. */
export async function getLatestChartAnalysis(orgId: string, chartKey: AnalysisChartKey): Promise<ChartAnalysisResult | null> {
  const latest = await analysisReportRepository.findLatest(orgId, chartKey)
  const report = latest ? parseStoredReport(latest.report) : null
  if (!latest || !report) return null
  const prompt = await analysisPromptRepository.findActiveByChartKey(chartKey)
  return {
    chartKey,
    title: prompt?.title ?? CHART_DATA_REGISTRY[chartKey].title,
    report,
    model: latest.modelId,
    window: { from: latest.windowFrom, to: latest.windowTo },
    coverage: describeCoverage(CHART_DATA_REGISTRY[chartKey], { from: latest.windowFrom, to: latest.windowTo }),
    generatedAt: latest.createdAt.toISOString(),
    cached: true
  }
}

/** Fields of the drawer's metric payload that carry figures or meaning; display-only flags are left out of the prompt. */
const METRIC_FIELDS_FOR_PROMPT = [
  'id', 'name', 'family', 'unit', 'dir', 'threshold', 'period', 'periodLabel', 'window', 'grain', 'scope', 'win',
  'value', 'abs', 'subs', 'prev', 'delta', 'alert', 'series', 'detail', 'definition', 'source'
] as const

export interface MetricAnalysisResult extends ChartAnalysisResult {
  metricId: string
}

/**
 * Generates (or returns the cached) short summary readout of one Oryon metric
 * for the oryon-web metric drawer. Unlike chart analyses, this one follows the
 * selection on screen (period, window, span, product): the metric is loaded
 * through the same dashboard service the drawer reads, so the report describes
 * exactly the figures the user is looking at. Different selections hash to
 * different cache keys.
 */
export async function analyzeMetric(
  orgId: string,
  userId: string,
  metricId: string,
  view: DashboardQuery,
  options: AnalyzeChartOptions = {}
): Promise<MetricAnalysisResult> {
  const prompt = await loadActivePrompt(METRIC_SUMMARY_PROMPT_KEY)
  const metric = (await getMetric(orgId, metricId, view)) as Record<string, unknown>
  const data = Object.fromEntries(METRIC_FIELDS_FOR_PROMPT.filter((k) => k in metric).map((k) => [k, metric[k]]))

  const series = (metric.series as { period: string }[] | undefined) ?? []
  const period = String(metric.period ?? '')
  const window: AnalysisWindow = { from: series[0]?.period ?? period, to: period }
  const product = view.product ? `product ${view.product}` : 'all products'
  const coverage = `${metric.periodLabel ?? period} · ${metric.window === 'TTM' ? 'trailing 12 months' : String(metric.win ?? 'period')} · ${product}`
  const reportKey = `metric:${metricId}`

  const userPrompt = renderTemplate(prompt.userPromptTemplate, {
    chartTitle: `${metricId} ${String(metric.name ?? '')}`.trim(),
    window: coverage,
    asOf: period,
    data: JSON.stringify(data)
  })
  const cacheKey = computeCacheKey(prompt, prompt.systemPrompt, userPrompt)
  const base = { chartKey: reportKey, metricId, title: String(metric.name ?? metricId), coverage }

  if (!options.refresh) {
    const cached = await analysisReportRepository.findByCacheKey(orgId, reportKey, cacheKey)
    const cachedReport = cached ? parseStoredReport(cached.report) : null
    if (cached && cachedReport) {
      return {
        ...base,
        report: cachedReport,
        model: cached.modelId,
        window: { from: cached.windowFrom, to: cached.windowTo },
        generatedAt: cached.createdAt.toISOString(),
        cached: true
      }
    }
  }

  const generated = await generateWithClaude({
    model: prompt.modelId,
    maxTokens: prompt.maxTokens,
    effort: prompt.effort,
    system: prompt.systemPrompt,
    user: userPrompt,
    jsonSchema: ANALYSIS_REPORT_JSON_SCHEMA
  })
  const report = parseGeneratedReport(generated.text)

  const saved = await analysisReportRepository.create(orgId, {
    chartKey: reportKey,
    cacheKey,
    report: JSON.stringify(report),
    modelId: generated.model,
    windowFrom: window.from,
    windowTo: window.to,
    inputTokens: generated.inputTokens,
    outputTokens: generated.outputTokens,
    generatedBy: userId
  })

  return { ...base, report, model: saved.modelId, window, generatedAt: saved.createdAt.toISOString(), cached: false }
}
