import { Connection, Types } from 'mongoose'
import { getFunnelStageEventModel } from '../model/FunnelStageEvent.model'
import { getTenantConnection } from '../../../database/tenantConnection'

export interface DateRange {
  from?: Date
  to?: Date
}

function dateFieldMatch(field: string, range?: DateRange): Record<string, unknown> {
  if (!range?.from && !range?.to) return {}
  const bounds: Record<string, Date> = {}
  if (range.from) bounds.$gte = range.from
  if (range.to) bounds.$lte = range.to
  return { [field]: bounds }
}

export interface FunnelStageEventInput {
  entityType: 'lead' | 'deal'
  providerRecordId: string
  pipeline: string
  rawStage: string
  enteredAt: Date
  convertedToRecordId?: string
}

/** Resolves the FunnelStageEvent model bound to the given org's own tenant database. */
async function modelForOrg(orgId: string | Types.ObjectId) {
  const connection: Connection = await getTenantConnection(orgId.toString())
  return getFunnelStageEventModel(connection)
}

export const funnelStageEventRepository = {
  /**
   * Upserts on the (orgId, provider, entityType, providerRecordId, rawStage,
   * enteredAt) unique key — re-syncing the same transition is a no-op, only
   * genuinely new transitions land as new rows. Events are immutable once
   * written, so nothing needs updating on a repeat match.
   */
  async bulkUpsert(orgId: string | Types.ObjectId, provider: string, events: FunnelStageEventInput[]) {
    if (events.length === 0) return
    const FunnelStageEventModel = await modelForOrg(orgId)
    const orgObjectId = new Types.ObjectId(orgId)
    const operations = events.map((event) => ({
      updateOne: {
        filter: {
          orgId: orgObjectId,
          provider,
          entityType: event.entityType,
          providerRecordId: event.providerRecordId,
          rawStage: event.rawStage,
          enteredAt: event.enteredAt
        },
        update: { $setOnInsert: { orgId: orgObjectId, provider, ...event } },
        upsert: true
      }
    }))
    await FunnelStageEventModel.bulkWrite(operations, { ordered: false })
  },

  /**
   * Counts, per (pipeline, stage), how many distinct records ever reached that
   * stage — the number a funnel chart bar needs. Groups by record first so a
   * record with multiple events for the same stage (re-synced, or a stage
   * re-entered) only counts once, then unwinds each record's reached-stage
   * set into per-stage totals.
   */
  async getStageMembershipCounts(
    orgId: string | Types.ObjectId,
    provider: string,
    entityType: 'lead' | 'deal',
    pipeline?: string,
    recordIds?: string[]
  ): Promise<{ pipeline: string; rawStage: string; count: number }[]> {
    const FunnelStageEventModel = await modelForOrg(orgId)
    const match: Record<string, unknown> = { orgId: new Types.ObjectId(orgId), provider, entityType }
    if (pipeline) match.pipeline = pipeline
    if (recordIds) match.providerRecordId = { $in: recordIds }

    const rows = await FunnelStageEventModel.aggregate<{ _id: { pipeline: string; stage: string }; count: number }>([
      { $match: match },
      {
        $group: {
          _id: { providerRecordId: '$providerRecordId', pipeline: '$pipeline' },
          stages: { $addToSet: '$rawStage' }
        }
      },
      { $unwind: '$stages' },
      { $group: { _id: { pipeline: '$_id.pipeline', stage: '$stages' }, count: { $sum: 1 } } }
    ])

    return rows.map((row) => ({ pipeline: row._id.pipeline, rawStage: row._id.stage, count: row.count }))
  },

  /**
   * Records of `entityType` whose *first-ever* stage-entry event falls inside
   * `dateRange` — the "acquired in this window" cohort. Deliberately not "any
   * event in range": a per-stage count of in-range events isn't monotonic (a
   * record can reach a later stage inside the window while its earlier stages
   * happened before it — win rate could read over 100%), so a date-filtered
   * funnel is scoped by cohort membership instead, then every stage for that
   * cohort is counted across all of its events regardless of when they
   * happened — the standard cohort-funnel semantic.
   */
  async getCohortRecordIds(
    orgId: string | Types.ObjectId,
    provider: string,
    entityType: 'lead' | 'deal',
    dateRange: DateRange
  ): Promise<string[]> {
    const FunnelStageEventModel = await modelForOrg(orgId)
    const rows = await FunnelStageEventModel.aggregate<{ _id: string }>([
      { $match: { orgId: new Types.ObjectId(orgId), provider, entityType } },
      { $group: { _id: '$providerRecordId', firstEnteredAt: { $min: '$enteredAt' } } },
      { $match: dateFieldMatch('firstEnteredAt', dateRange) }
    ])
    return rows.map((row) => row._id)
  }
}
