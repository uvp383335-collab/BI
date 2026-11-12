import dotenv from 'dotenv'
import mongoose from 'mongoose'
import { connectDatabase } from '../database/connection'
import { analysisPromptRepository } from '../modules/aiAnalysis/repository/analysisPrompt.repository'
import { DEFAULT_ANALYSIS_PROMPTS } from '../modules/aiAnalysis/service/defaultPrompts'

/**
 * Inserts the default AI analysis prompt for every chart key that doesn't
 * have one yet in the control-plane `analysisprompts` collection. Never
 * overwrites an existing document — prompts are edited directly in MongoDB
 * and those edits must survive re-running this script. To reset a prompt
 * to its default, delete its document and re-run.
 *
 * Usage:
 *   npm run seed:analysis-prompts
 */
dotenv.config()

async function main() {
  await connectDatabase()
  for (const prompt of Object.values(DEFAULT_ANALYSIS_PROMPTS)) {
    const inserted = await analysisPromptRepository.insertIfMissing(prompt)
    // eslint-disable-next-line no-console
    console.log(`${prompt.chartKey}: ${inserted ? 'inserted' : 'already exists, left unchanged'}`)
  }
}

main()
  .catch((err) => {
    console.error('Seeding analysis prompts failed:', err)
    process.exitCode = 1
  })
  .finally(() => mongoose.disconnect())
