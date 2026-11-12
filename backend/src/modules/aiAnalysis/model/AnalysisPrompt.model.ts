import { Schema, model, Document, Types } from 'mongoose'

export type AnalysisEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max'

/**
 * Platform-wide AI analysis prompt for one dashboard chart. Lives in the
 * control-plane database (not a tenant database): every organization's
 * "Analyze" button on a given chart uses the same prompt.
 *
 * There is deliberately no API to edit these — they're managed by editing
 * the document directly in MongoDB. `seedAnalysisPrompts` only inserts
 * missing chart keys and never overwrites an edited prompt.
 *
 * `userPromptTemplate` placeholders, filled in by aiAnalysis.service.ts:
 * `{{chartTitle}}`, `{{window}}`, `{{asOf}}`, `{{data}}` (the chart's
 * unfiltered, all-products data as JSON).
 */
export interface AnalysisPromptDocument extends Document {
  _id: Types.ObjectId
  chartKey: string
  title: string
  systemPrompt: string
  userPromptTemplate: string
  modelId: string
  maxTokens: number
  effort: AnalysisEffort
  isActive: boolean
  createdAt: Date
  updatedAt: Date
}

const analysisPromptSchema = new Schema<AnalysisPromptDocument>(
  {
    chartKey: { type: String, required: true, unique: true, trim: true },
    title: { type: String, required: true, trim: true },
    systemPrompt: { type: String, required: true },
    userPromptTemplate: { type: String, required: true },
    modelId: { type: String, required: true, default: 'claude-opus-5-5' },
    maxTokens: { type: Number, required: true, default: 16000, min: 256, max: 64000 },
    effort: { type: String, enum: ['low', 'medium', 'high', 'xhigh', 'max'], default: 'medium' },
    isActive: { type: Boolean, default: true }
  },
  { timestamps: true }
)

export const AnalysisPromptModel = model<AnalysisPromptDocument>('AnalysisPrompt', analysisPromptSchema)
