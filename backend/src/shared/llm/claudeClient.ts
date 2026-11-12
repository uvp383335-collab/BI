import Anthropic from '@anthropic-ai/sdk'
import { AppError } from '../utils/AppError'

export type ClaudeEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max'

export interface ClaudeGenerateInput {
  model: string
  maxTokens: number
  effort: ClaudeEffort
  system: string
  user: string
}

export interface ClaudeGenerateResult {
  text: string
  /** The model that actually served the response — differs from the requested one when a refusal fallback ran. */
  model: string
  inputTokens: number
  outputTokens: number
}

let client: Anthropic | null = null

/** Lazily built so a missing ANTHROPIC_API_KEY only fails the AI endpoints, not app startup or unrelated tests. */
function getClient(): Anthropic {
  if (!client) {
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new AppError('AI analysis is not configured on this server', 503, 'AI_NOT_CONFIGURED')
    }
    client = new Anthropic({ timeout: 120_000, maxRetries: 2 })
  }
  return client
}

/**
 * Single-shot text generation against Claude. Uses the server-side refusal
 * fallback (`fallbacks: 'default'`) so a classifier false positive on a
 * financial report is re-run on a fallback model instead of failing the
 * request outright.
 */
export async function generateWithClaude(input: ClaudeGenerateInput): Promise<ClaudeGenerateResult> {
  let response: Anthropic.Beta.BetaMessage
  try {
    response = await getClient().beta.messages.create({
      model: input.model,
      max_tokens: input.maxTokens,
      system: input.system,
      messages: [{ role: 'user', content: input.user }],
      output_config: { effort: input.effort },
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default'
    })
  } catch (err) {
    if (err instanceof Anthropic.RateLimitError) {
      throw new AppError('AI analysis is busy, please try again shortly', 503, 'AI_RATE_LIMITED')
    }
    if (err instanceof Anthropic.APIError) {
      console.error(`Claude request failed (status ${err.status}):`, err.message)
      throw new AppError('AI analysis failed, please try again later', 502, 'AI_UPSTREAM_ERROR')
    }
    throw err
  }

  if (response.stop_reason === 'refusal') {
    throw new AppError('AI analysis could not be generated for this chart', 502, 'AI_REFUSED')
  }

  const text = response.content
    .filter((block): block is Anthropic.Beta.BetaTextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('\n')
    .trim()

  if (!text) {
    throw new AppError('AI analysis returned an empty report', 502, 'AI_EMPTY_RESPONSE')
  }

  return {
    text,
    model: response.model,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens
  }
}
