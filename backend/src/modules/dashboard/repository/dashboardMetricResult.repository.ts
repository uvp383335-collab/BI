import { getTenantConnection } from '../../../database/tenantConnection'
import { getDashboardMetricResultModel } from '../model/DashboardMetricResult.model'

async function modelForOrg(orgId: string) {
  return getDashboardMetricResultModel(await getTenantConnection(orgId))
}

export const dashboardMetricResultRepository = {
  async find<T>(orgId: string, key: string): Promise<T | null> {
    const Model = await modelForOrg(orgId)
    const row = await Model.findOne({ key }, { result: 1 }).lean<{ result: T }>()
    return row?.result ?? null
  },

  async save(orgId: string, key: string, result: unknown): Promise<void> {
    const Model = await modelForOrg(orgId)
    await Model.updateOne({ key }, { $set: { result, createdAt: new Date() } }, { upsert: true })
  }
}
