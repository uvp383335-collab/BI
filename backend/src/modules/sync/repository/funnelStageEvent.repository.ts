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
   * Drops every event for a provider. bulkUpsert above only ever adds, so
   * this is how a switch of history *source* (e.g. HubSpot native vs.
   * imported, see Organization.model.ts) avoids the old source's timestamps
   * lingering next to the new one's — the forced resync that follows
   * rebuilds the events from the new source.
   */
  async deleteForProvider(orgId: string | Types.ObjectId, provider: string) {
    const FunnelStageEventModel = await modelForOrg(orgId)
    await FunnelStageEventModel.deleteMany({ orgId: new Types.ObjectId(orgId), provider })
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
   * Each distinct record's full set of raw stages it has ever had an event
   * for, per pipeline — the raw material funnel.service.ts needs to build a
   * genuinely monotonic funnel. A literal "count of records with an event for
   * exactly stage N" undercounts stage N whenever a record was created
   * directly at a later stage (e.g. a HubSpot contact created straight at
   * "Marketing Qualified Lead", with no recorded "Lead" transition) — that's
   * what let both a stage's "% of total" and a later stage's raw count read
   * as though more people reached it than the ones before it. The caller
   * resolves each record's highest-ranked touched stage (via
   * PipelineStageDefinition.displayOrder) and counts it toward every
   * earlier-or-equal stage too, the same way HubSpot's own native funnel
   * reports treat "currently at Customer" as implying "was a Lead at some
   * point" even without an explicit logged transition for each hop.
   */
  async getRecordStageSets(
    orgId: string | Types.ObjectId,
    provider: string,
    entityType: 'lead' | 'deal',
    recordIds?: string[]
  ): Promise<{ providerRecordId: string; pipeline: string; stages: string[] }[]> {
    const FunnelStageEventModel = await modelForOrg(orgId)
    const match: Record<string, unknown> = { orgId: new Types.ObjectId(orgId), provider, entityType }
    if (recordIds) match.providerRecordId = { $in: recordIds }

    const rows = await FunnelStageEventModel.aggregate<{ _id: { providerRecordId: string; pipeline: string }; stages: string[] }>([
      { $match: match },
      { $group: { _id: { providerRecordId: '$providerRecordId', pipeline: '$pipeline' }, stages: { $addToSet: '$rawStage' } } }
    ])
    return rows.map((row) => ({ providerRecordId: row._id.providerRecordId, pipeline: row._id.pipeline, stages: row.stages }))
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
  },

  /**
   * Counts distinct records whose *first* event for `rawStage` (not their
   * overall first-ever event — see getCohortRecordIds) falls inside
   * `dateRange` — CM-08's "MQLs generated this period" input. First entry
   * only, so a recycled lead that re-qualifies later is counted once per
   * journey, as the metrics guide asks. Deliberately not cohort-scoped:
   * CM-08 asks "how many crossed the MQL line this month", not "of the
   * leads who started this month, how many became MQLs" (that's CM-06's).
   */
  /**
   * Each record's *first* entry date into each of `stages` — the raw material
   * for CM-06's per-stage cohorts (group by when a record first entered a
   * stage, then check whether it went on to enter the next one). Records
   * with none of the stages are omitted.
   */
  async getFirstStageEntries(
    orgId: string | Types.ObjectId,
    provider: string,
    entityType: 'lead' | 'deal',
    stages: string[]
  ): Promise<{ providerRecordId: string; firstEntered: Record<string, Date> }[]> {
    const FunnelStageEventModel = await modelForOrg(orgId)
    const rows = await FunnelStageEventModel.aggregate<{ _id: string; entries: { stage: string; at: Date }[] }>([
      { $match: { orgId: new Types.ObjectId(orgId), provider, entityType, rawStage: { $in: stages } } },
      { $group: { _id: { providerRecordId: '$providerRecordId', stage: '$rawStage' }, at: { $min: '$enteredAt' } } },
      { $group: { _id: '$_id.providerRecordId', entries: { $push: { stage: '$_id.stage', at: '$at' } } } }
    ])
    return rows.map((row) => ({
      providerRecordId: row._id,
      firstEntered: Object.fromEntries(row.entries.map((entry) => [entry.stage, entry.at]))
    }))
  },

  async countRecordsFirstEnteringStage(
    orgId: string | Types.ObjectId,
    provider: string,
    entityType: 'lead' | 'deal',
    rawStage: string,
    dateRange: DateRange
  ): Promise<number> {
    const FunnelStageEventModel = await modelForOrg(orgId)
    const match: Record<string, unknown> = { orgId: new Types.ObjectId(orgId), provider, entityType, rawStage }
    const [row] = await FunnelStageEventModel.aggregate<{ count: number }>([
      { $match: match },
      { $group: { _id: '$providerRecordId', firstEnteredAt: { $min: '$enteredAt' } } },
      { $match: dateFieldMatch('firstEnteredAt', dateRange) },
      { $count: 'count' }
    ])
    return row?.count ?? 0
  }
}
