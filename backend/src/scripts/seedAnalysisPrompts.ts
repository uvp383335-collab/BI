import dotenv from 'dotenv'
import mongoose from 'mongoose'
import { connectDatabase } from '../database/connection'
import { analysisPromptRepository } from '../modules/aiAnalysis/repository/analysisPrompt.repository'
import { DEFAULT_ANALYSIS_PROMPTS, LEGACY_SHARED_SYSTEM_PROMPTS, METRIC_SUMMARY_PROMPT, SHARED_SYSTEM_PROMPT } from '../modules/aiAnalysis/service/defaultPrompts'

/**
 * Inserts the default AI analysis prompt for every chart key that doesn't
 * have one yet in the control-plane `analysisprompts` collection. Never
 * overwrites an existing document — prompts are edited directly in MongoDB
 * and those edits must survive re-running this script. To reset a prompt
 * to its default, delete its document and re-run.
 *
 * `--update-system-prompts` additionally moves prompts whose system prompt
 * is still an old untouched default (see LEGACY_SHARED_SYSTEM_PROMPTS) to
 * the current one. Edited system prompts are left alone.
 *
 * Usage:
 *   npm run seed:analysis-prompts
 *   npm run seed:analysis-prompts -- --update-system-prompts
 */
dotenv.config()

async function main() {
  await connectDatabase()
  for (const prompt of [...Object.values(DEFAULT_ANALYSIS_PROMPTS), METRIC_SUMMARY_PROMPT]) {
    const inserted = await analysisPromptRepository.insertIfMissing(prompt)
    // eslint-disable-next-line no-console
    console.log(`${prompt.chartKey}: ${inserted ? 'inserted' : 'already exists, left unchanged'}`)
  }
  if (process.argv.includes('--update-system-prompts')) {
    const updated = await analysisPromptRepository.replaceSystemPromptWhereUnchanged(LEGACY_SHARED_SYSTEM_PROMPTS, SHARED_SYSTEM_PROMPT)
    // eslint-disable-next-line no-console
    console.log(`system prompt moved to the current default on ${updated} prompt(s); edited ones left unchanged`)
  }
}

main()
  .catch((err) => {
    console.error('Seeding analysis prompts failed:', err)
    process.exitCode = 1
  })
  .finally(() => mongoose.disconnect())
