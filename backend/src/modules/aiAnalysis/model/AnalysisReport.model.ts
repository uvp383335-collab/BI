import { Schema, Document, Types, Connection, Model } from 'mongoose'

/**
 * A generated AI analysis report for one chart, cached in the organization's
 * own tenant database. `cacheKey` hashes the chart's input data together
 * with the prompt that produced the report, so a new sync (different data)
 * or a prompt edited in MongoDB (different prompt) both miss the cache and
 * generate a fresh report; identical inputs reuse the stored one instead of
 * paying for another Claude call.
 */
export interface AnalysisReportDocument extends Document {
  _id: Types.ObjectId
  orgId: Types.ObjectId
  chartKey: string
  cacheKey: string
  report: string
  modelId: string
  windowFrom: string
  windowTo: string
  inputTokens: number
  outputTokens: number
  generatedBy: Types.ObjectId
  createdAt: Date
  updatedAt: Date
}

const REPORT_TTL_SECONDS = 30 * 24 * 60 * 60

const analysisReportSchema = new Schema<AnalysisReportDocument>(
  {
    orgId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true },
    chartKey: { type: String, required: true },
    cacheKey: { type: String, required: true },
    report: { type: String, required: true },
    modelId: { type: String, required: true },
    windowFrom: { type: String, required: true },
    windowTo: { type: String, required: true },
    inputTokens: { type: Number, default: 0 },
    outputTokens: { type: Number, default: 0 },
    generatedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true }
  },
  { timestamps: true }
)

analysisReportSchema.index({ orgId: 1, chartKey: 1, cacheKey: 1 })
// Backs "latest report for this chart" lookups.
analysisReportSchema.index({ orgId: 1, chartKey: 1, createdAt: -1 })
analysisReportSchema.index({ createdAt: 1 }, { expireAfterSeconds: REPORT_TTL_SECONDS })

const modelCache = new WeakMap<Connection, Model<AnalysisReportDocument>>()

/** Returns the AnalysisReport model bound to the given tenant connection, compiling it once per connection. */
export function getAnalysisReportModel(connection: Connection): Model<AnalysisReportDocument> {
  const cached = modelCache.get(connection)
  if (cached) return cached
  const model =
    (connection.models.AnalysisReport as Model<AnalysisReportDocument>) ||
    connection.model<AnalysisReportDocument>('AnalysisReport', analysisReportSchema)
  modelCache.set(connection, model)
  return model
}
