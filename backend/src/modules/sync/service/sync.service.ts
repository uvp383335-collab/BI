import { syncJobRepository } from '../repository/syncJob.repository'
import { contactRepository } from '../repository/contact.repository'
import { dealRepository } from '../repository/deal.repository'
import { HubSpotService, HubSpotContact, HubSpotDeal } from '../../integrations/service/hubspot.service'
import * as integrationsService from '../../integrations/service/integrations.service'
import { AppError } from '../../../shared/utils/AppError'

const PAGE_SIZE = 50

/**
 * Runs the (intentionally narrow) HubSpot data sync: contacts and deals only,
 * with deals carrying their `dealstage` change history so the pipeline
 * progression graph can be built without ever syncing marketing/email data.
 */
export const syncService = {
  /** Starts a new sync job for the org/provider, refusing to start a second one concurrently. */
  async startSync(orgId: string, provider: string): Promise<{ jobId: string }> {
    const existing = await syncJobRepository.findActiveByOrgAndProvider(orgId, provider)
    if (existing) {
      return { jobId: String(existing._id) }
    }

    const job = await syncJobRepository.create(orgId, provider)
    const jobId = String(job._id)

    // Fire-and-forget: the caller (HTTP request) doesn't wait for the sync to finish.
    executeSyncJob(orgId, provider, jobId).catch(() => {
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

async function executeSyncJob(orgId: string, provider: string, jobId: string): Promise<void> {
  try {
    await syncJobRepository.updateStatus(jobId, 'running')
    await syncJobRepository.updateProgress(jobId, 5, 'Starting sync')

    const accessToken = await integrationsService.getValidAccessToken(orgId, provider)

    await syncContacts(orgId, provider, jobId, accessToken)
    await syncDeals(orgId, provider, jobId, accessToken)

    await syncJobRepository.updateStatus(jobId, 'completed')
    await syncJobRepository.updateProgress(jobId, 100, 'Sync completed')
  } catch (error) {
    await syncJobRepository.updateStatus(jobId, 'failed')
    await syncJobRepository.setError(jobId, error instanceof Error ? error.message : 'Unknown error')
  }
}

async function syncContacts(
  orgId: string,
  provider: string,
  jobId: string,
  accessToken: string
): Promise<void> {
  await syncJobRepository.updateEntityProgress(jobId, 'contacts', { status: 'syncing' })
  await syncJobRepository.updateProgress(jobId, 15, 'Syncing contacts')

  let after: string | undefined
  let totalSynced = 0

  do {
    const response = await HubSpotService.getContacts(accessToken, PAGE_SIZE, after)
    const contacts = response.results.map((contact: HubSpotContact) => ({
      hubspotId: contact.id,
      email: contact.properties.email,
      firstname: contact.properties.firstname,
      lastname: contact.properties.lastname,
      lifecycleStage: contact.properties.lifecyclestage,
      leadStatus: contact.properties.hs_lead_status
    }))

    await contactRepository.bulkUpsert(orgId, provider, contacts)
    totalSynced += contacts.length
    await syncJobRepository.updateEntityProgress(jobId, 'contacts', { synced: totalSynced })
    await syncJobRepository.updateProgress(jobId, 40, `Syncing contacts (${totalSynced})`)

    after = response.paging?.next?.after
  } while (after)

  await syncJobRepository.updateEntityProgress(jobId, 'contacts', { total: totalSynced, status: 'completed' })
}

async function syncDeals(orgId: string, provider: string, jobId: string, accessToken: string): Promise<void> {
  await syncJobRepository.updateEntityProgress(jobId, 'deals', { status: 'syncing' })
  await syncJobRepository.updateProgress(jobId, 55, 'Syncing deals')

  let after: string | undefined
  let totalSynced = 0

  do {
    const response = await HubSpotService.getDeals(accessToken, PAGE_SIZE, after)
    const deals = response.results.map((deal: HubSpotDeal) => ({
      hubspotId: deal.id,
      dealname: deal.properties.dealname,
      amount: deal.properties.amount ? parseFloat(deal.properties.amount) : undefined,
      closedate: deal.properties.closedate ? new Date(deal.properties.closedate) : undefined,
      pipeline: deal.properties.pipeline,
      dealstage: deal.properties.dealstage,
      hubspotOwnerId: deal.properties.hubspot_owner_id,
      dealStageHistory: (deal.propertiesWithHistory?.dealstage || []).map((entry) => ({
        value: entry.value,
        timestamp: new Date(entry.timestamp)
      }))
    }))

    await dealRepository.bulkUpsert(orgId, provider, deals)
    totalSynced += deals.length
    await syncJobRepository.updateEntityProgress(jobId, 'deals', { synced: totalSynced })
    await syncJobRepository.updateProgress(jobId, 90, `Syncing deals (${totalSynced})`)

    after = response.paging?.next?.after
  } while (after)

  await syncJobRepository.updateEntityProgress(jobId, 'deals', { total: totalSynced, status: 'completed' })
}
