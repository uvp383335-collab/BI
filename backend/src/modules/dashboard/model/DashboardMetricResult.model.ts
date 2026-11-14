import { Connection, Model, Schema } from 'mongoose'

/**
 * Persisted metric results for the portfolio screens (tenant database). The key embeds the org's
 * data version, so a sync or settings change simply stops matching old rows; the TTL index then
 * clears them out. Lets results survive process restarts and be shared across instances, since
 * several CRM metrics take seconds per period to compute.
 */
export interface DashboardMetricResultDocument {
  key: string
  result: unknown
  createdAt: Date
}

const dashboardMetricResultSchema = new Schema<DashboardMetricResultDocument>(
  {
    key: { type: String, required: true, unique: true },
    result: { type: Schema.Types.Mixed, required: true },
    createdAt: { type: Date, default: Date.now }
  },
  { versionKey: false, minimize: false }
)
dashboardMetricResultSchema.index({ createdAt: 1 }, { expireAfterSeconds: 7 * 24 * 60 * 60 })

const modelCache = new WeakMap<Connection, Model<DashboardMetricResultDocument>>()

export function getDashboardMetricResultModel(connection: Connection): Model<DashboardMetricResultDocument> {
  const cached = modelCache.get(connection)
  if (cached) return cached
  const model =
    (connection.models.DashboardMetricResult as Model<DashboardMetricResultDocument>) ||
    connection.model<DashboardMetricResultDocument>('DashboardMetricResult', dashboardMetricResultSchema)
  modelCache.set(connection, model)
  return model
}
