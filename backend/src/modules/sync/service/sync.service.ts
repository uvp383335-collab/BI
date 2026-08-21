import { syncJobRepository } from '../repository/syncJob.repository'
import { contactRepository } from '../repository/contact.repository'
import { dealRepository } from '../repository/deal.repository'
import { funnelStageEventRepository, FunnelStageEventInput } from '../repository/funnelStageEvent.repository'
import { pipelineStageDefinitionRepository, PipelineStageDefinitionInput } from '../repository/pipelineStageDefinition.repository'
import { HubSpotService, HubSpotContact, HubSpotDeal } from '../../integrations/service/hubspot.service'
import * as integrationsService from '../../integrations/service/integrations.service'
import { integrationsRepository } from '../../integrations/repository/integrations.repository'
import { IntegrationProvider } from '../../integrations/model/Integration.model'
import { AppError } from '../../../shared/utils/AppError'

const PAGE_SIZE = 50

// HubSpot has no separate "pipeline" object for contacts/leads — the
// lifecyclestage property's options play that role, so FunnelStageEvent and
// PipelineStageDefinition rows for the lead lifecycle share this fixed
// pipeline id instead of a real HubSpot pipeline id. Exported so funnel.service
// can resolve the lead-funnel's pipeline without re-deriving it.
export const CONTACTS_PIPELINE = 'contacts-default'

/**
 * Runs the (intentionally narrow) HubSpot data sync: contacts and deals only,
 * with deals carrying their `dealstage` change history so the pipeline
 * progression graph can be built without ever syncing marketing/email data.
 */
export const syncService = {
  /**
   * Starts a new sync job for the org/provider, refusing to start a second one
   * concurrently. `force: true` ignores `lastSyncedAt` and re-fetches the
   * whole portal — needed the first time a new synced field ships, so it
   * backfills onto records that haven't changed on the CRM side since (an
   * incremental sync would otherwise never touch them).
   */
  async startSync(orgId: string, provider: string, options: { force?: boolean } = {}): Promise<{ jobId: string }> {
    const existing = await syncJobRepository.findActiveByOrgAndProvider(orgId, provider)
    if (existing) {
      return { jobId: String(existing._id) }
    }

    const job = await syncJobRepository.create(orgId, provider)
    const jobId = String(job._id)

    // Fire-and-forget: the caller (HTTP request) doesn't wait for the sync to finish.
    executeSyncJob(orgId, provider, jobId, options.force ?? false).catch(() => {
      // executeSyncJob already persists failures onto the job document.
    })

    return { jobId }
  },

  async getStatus(orgId: string, provider: string) {
    const job = await syncJobRepository.findLatestByOrgAndProvider(orgId, provider)
    return job
  },

  async getJobById(orgId: string, jobId: string) {
    const job = await syncJobRepository.findByIdForOrg(jobId, orgId)
    if (!job) {
      throw AppError.notFound('Sync job not found', 'SYNC_JOB_NOT_FOUND')
    }
    return job
  },

  async getEntityCounts(orgId: string, provider: string) {
    const [contacts, deals] = await Promise.all([
      contactRepository.count(orgId, provider),
      dealRepository.count(orgId, provider)
    ])
    return { contacts, deals }
  }
}

async function executeSyncJob(orgId: string, provider: string, jobId: string, force = false): Promise<void> {
  try {
    await syncJobRepository.updateStatus(jobId, 'running')
    await syncJobRepository.updateProgress(jobId, 5, 'Starting sync')

    const accessToken = await integrationsService.getValidAccessToken(orgId, provider)

    // getValidAccessToken above already validated `provider`, so it's safe to
    // treat it as a known IntegrationProvider from here on.
    const integration = await integrationsRepository.findByOrgAndProvider(orgId, provider as IntegrationProvider)
    const since = force ? undefined : integration?.lastSyncedAt ?? undefined

    // Captured before fetching so the *next* sync's `since` covers anything
    // changed while this sync was still running — using the completion time
    // instead would leave a gap for records modified mid-sync.
    const syncStartedAt = new Date()

    await syncPipelineStageDefinitions(orgId, provider, accessToken)
    await syncContacts(orgId, provider, jobId, accessToken, since)
    await syncDeals(orgId, provider, jobId, accessToken, since)

    await integrationsRepository.updateLastSyncedAt(orgId, provider as IntegrationProvider, syncStartedAt)

    await syncJobRepository.updateStatus(jobId, 'completed')
    await syncJobRepository.updateProgress(jobId, 100, 'Sync completed')
  } catch (error) {
    await syncJobRepository.updateStatus(jobId, 'failed')
    await syncJobRepository.setError(jobId, error instanceof Error ? error.message : 'Unknown error')
  }
}

/**
 * Refreshes PipelineStageDefinition from the portal's own pipeline/property
 * configuration — cheap, run once per sync job (not per page/record) so
 * the funnel chart always has current stage order + closed-won/lost flags,
 * even if the client renamed or reordered stages since the last sync.
 */
async function syncPipelineStageDefinitions(orgId: string, provider: string, accessToken: string): Promise<void> {
  const [pipelines, lifecycleOptions] = await Promise.all([
    HubSpotService.getDealPipelines(accessToken),
    HubSpotService.getContactLifecycleStageOptions(accessToken)
  ])

  const dealStages: PipelineStageDefinitionInput[] = pipelines.flatMap((pipeline) =>
    pipeline.stages.map((stage) => ({
      entityType: 'deal' as const,
      pipeline: pipeline.id,
      rawStage: stage.id,
      label: stage.label,
      displayOrder: stage.displayOrder,
      isClosed: stage.metadata?.isClosed === 'true',
      isWon: stage.metadata?.probability === '1' || stage.metadata?.probability === '1.0'
    }))
  )

  const leadStages: PipelineStageDefinitionInput[] = lifecycleOptions.map((option) => ({
    entityType: 'lead' as const,
    pipeline: CONTACTS_PIPELINE,
    rawStage: option.value,
    label: option.label,
    displayOrder: option.displayOrder,
    // HubSpot's lifecyclestage has no native isClosed/isWon concept — "customer" is the closed/won marker.
    isClosed: option.value === 'customer',
    isWon: option.value === 'customer'
  }))

  await pipelineStageDefinitionRepository.bulkUpsert(orgId, provider, [...dealStages, ...leadStages])
}

async function syncContacts(
  orgId: string,
  provider: string,
  jobId: string,
  accessToken: string,
  since?: Date
): Promise<void> {
  await syncJobRepository.updateEntityProgress(jobId, 'contacts', { status: 'syncing' })
  await syncJobRepository.updateProgress(jobId, 15, since ? 'Syncing contacts (changes since last sync)' : 'Syncing contacts')

  let after: string | undefined
  let totalSynced = 0

  do {
    const response = await HubSpotService.getContacts(accessToken, PAGE_SIZE, after, since)

    // HubSpot's Search API (used when `since` is set) can't return
    // propertiesWithHistory, so backfill each changed contact's lifecycle
    // stage history with one follow-up detail request — bounded to just
    // this page's contacts, not the whole portal (same pattern as deals).
    const lifecycleHistories = since
      ? await Promise.all(
          response.results.map((contact) => HubSpotService.getContactLifecycleHistory(accessToken, contact.id))
        )
      : undefined

    const contacts = response.results.map((contact: HubSpotContact, index: number) => ({
      providerRecordId: contact.id,
      email: contact.properties.email,
      firstname: contact.properties.firstname,
      lastname: contact.properties.lastname,
      lifecycleStage: contact.properties.lifecyclestage,
      leadStatus: contact.properties.hs_lead_status,
      lifecycleStageHistory: (lifecycleHistories ? lifecycleHistories[index] : contact.propertiesWithHistory?.lifecyclestage || []).map(
        (entry) => ({
          value: entry.value,
          timestamp: new Date(entry.timestamp)
        })
      )
    }))

    await contactRepository.bulkUpsert(orgId, provider, contacts)

    const events: FunnelStageEventInput[] = contacts.flatMap((contact) =>
      contact.lifecycleStageHistory.map((entry) => ({
        entityType: 'lead' as const,
        providerRecordId: contact.providerRecordId,
        pipeline: CONTACTS_PIPELINE,
        rawStage: entry.value,
        enteredAt: entry.timestamp
      }))
    )
    await funnelStageEventRepository.bulkUpsert(orgId, provider, events)

    totalSynced += contacts.length
    await syncJobRepository.updateEntityProgress(jobId, 'contacts', { synced: totalSynced })
    await syncJobRepository.updateProgress(jobId, 40, `Syncing contacts (${totalSynced})`)

    after = response.paging?.next?.after
  } while (after)

  await syncJobRepository.updateEntityProgress(jobId, 'contacts', { total: totalSynced, status: 'completed' })
}

async function syncDeals(
  orgId: string,
  provider: string,
  jobId: string,
  accessToken: string,
  since?: Date
): Promise<void> {
  await syncJobRepository.updateEntityProgress(jobId, 'deals', { status: 'syncing' })
  await syncJobRepository.updateProgress(jobId, 55, since ? 'Syncing deals (changes since last sync)' : 'Syncing deals')

  let after: string | undefined
  let totalSynced = 0

  do {
    const response = await HubSpotService.getDeals(accessToken, PAGE_SIZE, after, since)

    // HubSpot's Search API (used when `since` is set) can't return
    // propertiesWithHistory, so backfill each changed deal's stage history
    // with one follow-up detail request — bounded to just this page's deals,
    // not the whole portal.
    const dealStageHistories = since
      ? await Promise.all(response.results.map((deal) => HubSpotService.getDealStageHistory(accessToken, deal.id)))
      : undefined

    // Batched once for the whole page (not per-deal) — mirrors the
    // anti-N+1 shape already used for the history backfills above.
    const associations = await HubSpotService.getDealContactAssociations(
      accessToken,
      response.results.map((deal) => deal.id)
    )

    const deals = response.results.map((deal: HubSpotDeal, index: number) => ({
      providerRecordId: deal.id,
      dealname: deal.properties.dealname,
      amount: deal.properties.amount ? parseFloat(deal.properties.amount) : undefined,
      closedate: deal.properties.closedate ? new Date(deal.properties.closedate) : undefined,
      pipeline: deal.properties.pipeline,
      dealstage: deal.properties.dealstage,
      ownerId: deal.properties.hubspot_owner_id,
      contactIds: associations[deal.id] ?? [],
      dealStageHistory: (dealStageHistories ? dealStageHistories[index] : deal.propertiesWithHistory?.dealstage || []).map(
        (entry) => ({
          value: entry.value,
          timestamp: new Date(entry.timestamp)
        })
      )
    }))

    await dealRepository.bulkUpsert(orgId, provider, deals)

    const events: FunnelStageEventInput[] = deals
      .filter((deal) => deal.pipeline)
      .flatMap((deal) =>
        deal.dealStageHistory.map((entry) => ({
          entityType: 'deal' as const,
          providerRecordId: deal.providerRecordId,
          pipeline: deal.pipeline as string,
          rawStage: entry.value,
          enteredAt: entry.timestamp
        }))
      )
    await funnelStageEventRepository.bulkUpsert(orgId, provider, events)

    totalSynced += deals.length
    await syncJobRepository.updateEntityProgress(jobId, 'deals', { synced: totalSynced })
    await syncJobRepository.updateProgress(jobId, 90, `Syncing deals (${totalSynced})`)

    after = response.paging?.next?.after
  } while (after)

  await syncJobRepository.updateEntityProgress(jobId, 'deals', { total: totalSynced, status: 'completed' })
}
