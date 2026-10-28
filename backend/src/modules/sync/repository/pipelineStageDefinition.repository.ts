import { Connection, Types } from 'mongoose'
import { getPipelineStageDefinitionModel } from '../model/PipelineStageDefinition.model'
import { getTenantConnection } from '../../../database/tenantConnection'

export interface PipelineStageDefinitionInput {
  entityType: 'lead' | 'deal'
  pipeline: string
  rawStage: string
  label: string
  displayOrder: number
  isClosed: boolean
  isWon: boolean
}

/** Resolves the PipelineStageDefinition model bound to the given org's own tenant database. */
async function modelForOrg(orgId: string | Types.ObjectId) {
  const connection: Connection = await getTenantConnection(orgId.toString())
  return getPipelineStageDefinitionModel(connection)
}

export const pipelineStageDefinitionRepository = {
  /** Upserts stage metadata — labels/order/closed-won flags overwrite on every sync so a client's pipeline reconfiguration is reflected, not just the first-seen shape. */
  async bulkUpsert(orgId: string | Types.ObjectId, provider: string, stages: PipelineStageDefinitionInput[]) {
    if (stages.length === 0) return
    const PipelineStageDefinitionModel = await modelForOrg(orgId)
    const orgObjectId = new Types.ObjectId(orgId)
    const operations = stages.map((stage) => ({
      updateOne: {
        filter: {
          orgId: orgObjectId,
          provider,
          entityType: stage.entityType,
          pipeline: stage.pipeline,
          rawStage: stage.rawStage
        },
        update: { $set: { orgId: orgObjectId, provider, ...stage } },
        upsert: true
      }
    }))
    await PipelineStageDefinitionModel.bulkWrite(operations, { ordered: false })
  },

  /** All synced stage metadata for a provider — the join target for turning raw FunnelStageEvent counts into an ordered, labeled funnel. */
  async findAllForOrg(orgId: string | Types.ObjectId, provider: string) {
    const PipelineStageDefinitionModel = await modelForOrg(orgId)
    return PipelineStageDefinitionModel.find({ orgId, provider }).lean()
  }
}
