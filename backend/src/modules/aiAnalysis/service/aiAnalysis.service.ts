import { createHash } from 'crypto'
import { AppError } from '../../../shared/utils/AppError'
import { generateWithClaude } from '../../../shared/llm/claudeClient'
import { analysisPromptRepository, AnalysisPrompt } from '../repository/analysisPrompt.repository'
import { analysisReportRepository } from '../repository/analysisReport.repository'
import { AnalysisChartKey, AnalysisWindow, CHART_DATA_REGISTRY, currentAnalysisWindow } from './chartDataRegistry'

export interface ChartAnalysisResult {
  chartKey: string
  title: string
  report: string
  model: string
  window: AnalysisWindow
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
    .update(JSON.stringify([prompt.modelId, prompt.effort, prompt.maxTokens, systemPrompt, userPrompt]))
    .digest('hex')
}

async function loadActivePrompt(chartKey: AnalysisChartKey): Promise<AnalysisPrompt> {
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
    window: `${window.from} to ${window.to}`,
    asOf: window.to,
    data: JSON.stringify(data)
  })
  const cacheKey = computeCacheKey(prompt, prompt.systemPrompt, userPrompt)

  if (!options.refresh) {
    const cached = await analysisReportRepository.findByCacheKey(orgId, chartKey, cacheKey)
    if (cached) {
      return {
        chartKey,
        title: prompt.title,
        report: cached.report,
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
    user: userPrompt
  })

  const saved = await analysisReportRepository.create(orgId, {
    chartKey,
    cacheKey,
    report: generated.text,
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
    report: saved.report,
    model: saved.modelId,
    window,
    generatedAt: saved.createdAt.toISOString(),
    cached: false
  }
}

/** The most recently generated report for a chart, or null — lets the UI show the last analysis without spending a Claude call. */
export async function getLatestChartAnalysis(orgId: string, chartKey: AnalysisChartKey): Promise<ChartAnalysisResult | null> {
  const latest = await analysisReportRepository.findLatest(orgId, chartKey)
  if (!latest) return null
  const prompt = await analysisPromptRepository.findActiveByChartKey(chartKey)
  return {
    chartKey,
    title: prompt?.title ?? CHART_DATA_REGISTRY[chartKey].title,
    report: latest.report,
    model: latest.modelId,
    window: { from: latest.windowFrom, to: latest.windowTo },
    generatedAt: latest.createdAt.toISOString(),
    cached: true
  }
}
