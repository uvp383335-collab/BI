import { Connection, Types } from 'mongoose'
import { getAnalysisReportModel } from '../model/AnalysisReport.model'
import { getTenantConnection } from '../../../database/tenantConnection'

export interface AnalysisReportInput {
  chartKey: string
  cacheKey: string
  report: string
  modelId: string
  windowFrom: string
  windowTo: string
  inputTokens: number
  outputTokens: number
  generatedBy: string
}

/** Resolves the AnalysisReport model bound to the given org's own tenant database. */
async function modelForOrg(orgId: string | Types.ObjectId) {
  const connection: Connection = await getTenantConnection(orgId.toString())
  return getAnalysisReportModel(connection)
}

export const analysisReportRepository = {
  async findByCacheKey(orgId: string, chartKey: string, cacheKey: string) {
    const Model = await modelForOrg(orgId)
    return Model.findOne({ orgId, chartKey, cacheKey }).sort({ createdAt: -1 }).lean()
  },

  async findLatest(orgId: string, chartKey: string) {
    const Model = await modelForOrg(orgId)
    return Model.findOne({ orgId, chartKey }).sort({ createdAt: -1 }).lean()
  },

  async create(orgId: string, input: AnalysisReportInput) {
    const Model = await modelForOrg(orgId)
    const doc = await Model.create({ ...input, orgId: new Types.ObjectId(orgId), generatedBy: new Types.ObjectId(input.generatedBy) })
    return doc.toObject()
  }
}
