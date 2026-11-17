import { AnalysisPromptModel, AnalysisPromptDocument } from '../model/AnalysisPrompt.model'

export type AnalysisPrompt = Pick<
  AnalysisPromptDocument,
  'chartKey' | 'title' | 'systemPrompt' | 'userPromptTemplate' | 'modelId' | 'maxTokens' | 'effort' | 'isActive'
>

// Prompts are edited directly in MongoDB, so a short TTL keeps edits picking
// up within a minute without a restart while avoiding a DB read per click.
const CACHE_TTL_MS = 60 * 1000
const cache = new Map<string, { prompt: AnalysisPrompt | null; expiresAt: number }>()

export const analysisPromptRepository = {
  async findActiveByChartKey(chartKey: string): Promise<AnalysisPrompt | null> {
    const hit = cache.get(chartKey)
    if (hit && hit.expiresAt > Date.now()) return hit.prompt

    const doc = await AnalysisPromptModel.findOne({ chartKey, isActive: true })
      .select('chartKey title systemPrompt userPromptTemplate modelId maxTokens effort isActive')
      .lean<AnalysisPrompt>()
    cache.set(chartKey, { prompt: doc ?? null, expiresAt: Date.now() + CACHE_TTL_MS })
    return doc ?? null
  },

  /** Inserts the prompt only when its chartKey doesn't exist yet — never overwrites a prompt edited in MongoDB. */
  async insertIfMissing(prompt: Omit<AnalysisPrompt, 'isActive'>): Promise<boolean> {
    const result = await AnalysisPromptModel.updateOne({ chartKey: prompt.chartKey }, { $setOnInsert: { ...prompt, isActive: true } }, { upsert: true })
    return result.upsertedCount > 0
  },

  /** Replaces the system prompt only where it still equals one of `fromAny` — a prompt edited in MongoDB is never touched. Returns how many documents changed. */
  async replaceSystemPromptWhereUnchanged(fromAny: string[], to: string): Promise<number> {
    const result = await AnalysisPromptModel.updateMany({ systemPrompt: { $in: fromAny } }, { $set: { systemPrompt: to } })
    cache.clear()
    return result.modifiedCount
  },

  clearCache() {
    cache.clear()
  }
}
