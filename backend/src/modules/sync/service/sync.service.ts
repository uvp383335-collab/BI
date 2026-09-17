import { syncJobRepository } from '../repository/syncJob.repository'
import { contactRepository } from '../repository/contact.repository'
import { dealRepository } from '../repository/deal.repository'
import { quickBooksCustomerRepository } from '../repository/quickBooksCustomer.repository'
import { invoiceRepository } from '../repository/invoice.repository'
import { plSnapshotRepository } from '../repository/plSnapshot.repository'
import { plItemSnapshotRepository } from '../repository/plItemSnapshot.repository'
import { salesforceAccountRepository } from '../repository/salesforceAccount.repository'
import { cashBalanceSnapshotRepository } from '../repository/cashBalanceSnapshot.repository'
// Parsing a QuickBooks Report response is P&L-specific interpretation logic
// that lives with the metrics module (tested there, reused by
// plMetrics.service.ts) — reused here rather than duplicated.
import { parseProfitAndLoss } from '../../metrics/service/plParser'
import { extractSectionTotals, extractFlatReportGrandTotal } from '../../metrics/service/reportParser'
import { funnelStageEventRepository, FunnelStageEventInput } from '../repository/funnelStageEvent.repository'
import { pipelineStageDefinitionRepository, PipelineStageDefinitionInput } from '../repository/pipelineStageDefinition.repository'
import { productRepository } from '../repository/product.repository'
import { HubSpotService, HubSpotContact, HubSpotDeal } from '../../integrations/service/hubspot.service'
import { SalesforceService } from '../../integrations/service/salesforce.service'
import { QuickBooksService, mapWithConcurrency } from '../../integrations/service/quickbooks.service'
import * as integrationsService from '../../integrations/service/integrations.service'
import { integrationsRepository } from '../../integrations/repository/integrations.repository'
import { organizationsRepository } from '../../organizations/repository/organizations.repository'
import { IntegrationProvider } from '../../integrations/model/Integration.model'
import { AppError } from '../../../shared/utils/AppError'

const PAGE_SIZE = 50
const QUICKBOOKS_PAGE_SIZE = 100

// HubSpot has no separate "pipeline" object for contacts/leads — the
// lifecyclestage property's options play that role, so FunnelStageEvent and
// PipelineStageDefinition rows for the lead lifecycle share this fixed
// pipeline id instead of a real HubSpot pipeline id. Exported so funnel.service
// can resolve the lead-funnel's pipeline without re-deriving it. Reused as-is
// for Salesforce Leads (this app's Contact entity there too) — safe since
// every row is additionally scoped by `provider`.
export const CONTACTS_PIPELINE = 'contacts-default'

// Salesforce has no separate multi-pipeline concept for Opportunities by
// default (a single Sales Process/Stage set unless the org uses Record Types)
// — so, mirroring CONTACTS_PIPELINE above, deal-stage rows share this fixed
// synthetic pipeline id instead of a real Salesforce pipeline id.
export const OPPORTUNITIES_PIPELINE = 'opportunities-default'

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
    const [contacts, deals, customers, invoices] = await Promise.all([
      contactRepository.count(orgId, provider),
      dealRepository.count(orgId, provider),
      quickBooksCustomerRepository.count(orgId, provider),
      invoiceRepository.count(orgId, provider)
    ])
    return { contacts, deals, customers, invoices }
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

    if (provider === 'salesforce') {
      const instanceUrl = integration?.instanceUrl
      if (!instanceUrl) {
        throw AppError.badRequest('Missing Salesforce instance URL for this connection', 'SALESFORCE_INSTANCE_URL_MISSING')
      }
      await syncSalesforcePipelineStageDefinitions(orgId, provider, accessToken, instanceUrl)
      await syncSalesforceProducts(orgId, provider, accessToken, instanceUrl)
      await syncSalesforceAccounts(orgId, provider, jobId, accessToken, instanceUrl, since)
      await syncSalesforceLeadsAsContacts(orgId, provider, jobId, accessToken, instanceUrl, since)
      await syncSalesforceOpportunitiesAsDeals(orgId, provider, jobId, accessToken, instanceUrl, since)
    } else if (provider === 'quickbooks') {
      const realmId = integration?.accountId
      if (!realmId) {
        throw AppError.badRequest('Missing QuickBooks company id for this connection', 'QUICKBOOKS_REALM_ID_MISSING')
      }
      await syncQuickBooksCustomers(orgId, provider, jobId, accessToken, realmId, since)
      await syncQuickBooksInvoices(orgId, provider, jobId, accessToken, realmId, since)
      const items = await syncQuickBooksItems(orgId, provider, jobId, accessToken, realmId)
      await syncQuickBooksProfitAndLoss(orgId, provider, jobId, accessToken, realmId)
      await syncQuickBooksItemProfitAndLoss(orgId, provider, jobId, accessToken, realmId, items)
      await syncQuickBooksCashBalance(orgId, provider, jobId, accessToken, realmId)
    } else {
      await syncPipelineStageDefinitions(orgId, provider, accessToken)
      await syncProducts(orgId, provider, accessToken)
      await syncContacts(orgId, provider, jobId, accessToken, since)
      await syncDeals(orgId, provider, jobId, accessToken, since)
    }

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

/**
 * Refreshes the Product catalog (id + name), the label source for the
 * funnel product-filter dropdown. Cheap, run once per sync job like
 * syncPipelineStageDefinitions.
 *
 * Requires the `crm.objects.line_items.read`/`crm.objects.products.read`
 * scopes added alongside this feature — an org connected before this
 * shipped won't have consented to them yet, so a 403 here is expected
 * until they reconnect. Swallowed rather than failing the whole sync:
 * missing product labels shouldn't block contacts/deals from syncing.
 */
async function syncProducts(orgId: string, provider: string, accessToken: string): Promise<void> {
  try {
    const products = await HubSpotService.getProducts(accessToken)
    await productRepository.bulkUpsert(
      orgId,
      provider,
      products.map((product) => ({ providerRecordId: product.id, name: product.properties.name || product.id }))
    )
  } catch (err) {
    console.error(`Product sync skipped for org ${orgId} (likely missing product/line-item scope):`, err)
  }
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
      analyticsSource: contact.properties.hs_analytics_source,
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

    // Deal -> product is two hops in HubSpot (deal -> line item -> product),
    // both batched once per page like the contact associations above.
    // Swallowed on failure for the same reason as syncProducts: an org that
    // hasn't reconnected for the new scope yet should still get its
    // contacts/deals, just without productIds until it does.
    let dealToProductIds: Record<string, string[]> = {}
    try {
      const dealLineItems = await HubSpotService.getDealLineItemAssociations(
        accessToken,
        response.results.map((deal) => deal.id)
      )
      const allLineItemIds = Array.from(new Set(Object.values(dealLineItems).flat()))
      const lineItemProducts = await HubSpotService.getLineItemProducts(accessToken, allLineItemIds)
      dealToProductIds = Object.fromEntries(
        Object.entries(dealLineItems).map(([dealId, lineItemIds]) => [
          dealId,
          Array.from(new Set(lineItemIds.map((id) => lineItemProducts[id]).filter((id): id is string => !!id)))
        ])
      )
    } catch (err) {
      console.error(`Deal product association skipped for org ${orgId} (likely missing product/line-item scope):`, err)
    }

    const deals = response.results.map((deal: HubSpotDeal, index: number) => ({
      providerRecordId: deal.id,
      dealname: deal.properties.dealname,
      amount: deal.properties.amount ? parseFloat(deal.properties.amount) : undefined,
      closedate: deal.properties.closedate ? new Date(deal.properties.closedate) : undefined,
      pipeline: deal.properties.pipeline,
      dealstage: deal.properties.dealstage,
      ownerId: deal.properties.hubspot_owner_id,
      dealCreatedAt: deal.properties.createdate ? new Date(deal.properties.createdate) : undefined,
      contactIds: associations[deal.id] ?? [],
      productIds: dealToProductIds[deal.id] ?? [],
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

/**
 * Refreshes PipelineStageDefinition from Salesforce's own Lead Status /
 * Opportunity Stage picklist configuration — same rationale as
 * syncPipelineStageDefinitions above, run once per sync job.
 */
async function syncSalesforcePipelineStageDefinitions(
  orgId: string,
  provider: string,
  accessToken: string,
  instanceUrl: string
): Promise<void> {
  const [opportunityStages, leadStatuses] = await Promise.all([
    SalesforceService.getOpportunityStages(accessToken, instanceUrl),
    SalesforceService.getLeadStatuses(accessToken, instanceUrl)
  ])

  const dealStages: PipelineStageDefinitionInput[] = opportunityStages.map((stage) => ({
    entityType: 'deal' as const,
    pipeline: OPPORTUNITIES_PIPELINE,
    rawStage: stage.apiName,
    label: stage.label,
    displayOrder: stage.sortOrder,
    isClosed: stage.isClosed,
    isWon: stage.isWon
  }))

  const leadStages: PipelineStageDefinitionInput[] = leadStatuses.map((status) => ({
    entityType: 'lead' as const,
    pipeline: CONTACTS_PIPELINE,
    rawStage: status.apiName,
    label: status.label,
    displayOrder: status.sortOrder,
    isClosed: status.isClosed,
    isWon: status.isWon
  }))

  await pipelineStageDefinitionRepository.bulkUpsert(orgId, provider, [...dealStages, ...leadStages])
}

/**
 * Refreshes the Product catalog (id + name) from Salesforce's `Product2`
 * object — the label source for the funnel product-filter dropdown, same
 * role as HubSpot's syncProducts. Swallowed on failure rather than failing
 * the whole sync: some orgs restrict Product2 access at the profile/
 * permission-set level even though the object always exists, and missing
 * product labels shouldn't block accounts/leads/opportunities from syncing.
 */
async function syncSalesforceProducts(orgId: string, provider: string, accessToken: string, instanceUrl: string): Promise<void> {
  try {
    let nextRecordsUrl: string | undefined
    const products: { providerRecordId: string; name: string }[] = []
    do {
      const response = await SalesforceService.getProducts(accessToken, instanceUrl, PAGE_SIZE, nextRecordsUrl)
      products.push(...response.records.map((product) => ({ providerRecordId: product.Id, name: product.Name || product.Id })))
      nextRecordsUrl = response.done ? undefined : response.nextRecordsUrl
    } while (nextRecordsUrl)

    await productRepository.bulkUpsert(orgId, provider, products)
  } catch (err) {
    console.error(`Product sync skipped for org ${orgId} (likely restricted Product2 access):`, err)
  }
}

/**
 * Syncs Salesforce Accounts — narrow (`Id`/`Name`/`ParentId` only), solely to
 * resolve subsidiary hierarchy for CM-02's customer-concentration grouping
 * (metrics guide). Not this app's Contact entity (see syncSalesforceLeadsAsContacts).
 */
async function syncSalesforceAccounts(
  orgId: string,
  provider: string,
  jobId: string,
  accessToken: string,
  instanceUrl: string,
  since?: Date
): Promise<void> {
  await syncJobRepository.updateEntityProgress(jobId, 'accounts', { status: 'syncing' })
  await syncJobRepository.updateProgress(jobId, 10, since ? 'Syncing accounts (changes since last sync)' : 'Syncing accounts')

  let nextRecordsUrl: string | undefined
  let totalSynced = 0

  do {
    const response = await SalesforceService.getAccounts(accessToken, instanceUrl, PAGE_SIZE, since, nextRecordsUrl)

    const accounts = response.records.map((account) => ({
      providerRecordId: account.Id,
      name: account.Name ?? undefined,
      parentRecordId: account.ParentId ?? undefined
    }))

    await salesforceAccountRepository.bulkUpsert(orgId, provider, accounts)

    totalSynced += accounts.length
    await syncJobRepository.updateEntityProgress(jobId, 'accounts', { synced: totalSynced })

    nextRecordsUrl = response.done ? undefined : response.nextRecordsUrl
  } while (nextRecordsUrl)

  await syncJobRepository.updateEntityProgress(jobId, 'accounts', { total: totalSynced, status: 'completed' })
}

/**
 * Syncs Salesforce Leads into this app's generic Contact entity — see
 * crm-integrations skill, Salesforce section, for why a Lead (not
 * Salesforce's separate Contact object) plays that role here.
 */
async function syncSalesforceLeadsAsContacts(
  orgId: string,
  provider: string,
  jobId: string,
  accessToken: string,
  instanceUrl: string,
  since?: Date
): Promise<void> {
  await syncJobRepository.updateEntityProgress(jobId, 'contacts', { status: 'syncing' })
  await syncJobRepository.updateProgress(jobId, 15, since ? 'Syncing leads (changes since last sync)' : 'Syncing leads')

  let nextRecordsUrl: string | undefined
  let totalSynced = 0

  do {
    const response = await SalesforceService.getLeads(accessToken, instanceUrl, PAGE_SIZE, since, nextRecordsUrl)

    const leadIds = response.records.map((lead) => lead.Id)
    // Batched once per page, mirroring the anti-N+1 shape used throughout the
    // HubSpot sync above.
    const statusHistories = await SalesforceService.getLeadStatusHistory(accessToken, instanceUrl, leadIds)
    const historyByLead = new Map<string, { value: string; timestamp: Date }[]>()
    for (const entry of statusHistories) {
      const list = historyByLead.get(entry.recordId) ?? []
      list.push({ value: entry.value, timestamp: new Date(entry.timestamp) })
      historyByLead.set(entry.recordId, list)
    }

    const contacts = response.records.map((lead) => ({
      providerRecordId: lead.Id,
      email: lead.Email ?? undefined,
      firstname: lead.FirstName ?? undefined,
      lastname: lead.LastName ?? undefined,
      lifecycleStage: lead.Status ?? undefined,
      lifecycleStageHistory: historyByLead.get(lead.Id) ?? []
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
    await syncJobRepository.updateProgress(jobId, 40, `Syncing leads (${totalSynced})`)

    nextRecordsUrl = response.done ? undefined : response.nextRecordsUrl
  } while (nextRecordsUrl)

  await syncJobRepository.updateEntityProgress(jobId, 'contacts', { total: totalSynced, status: 'completed' })
}

/**
 * Syncs Salesforce Opportunities into this app's generic Deal entity.
 * `contactIds` is populated via Lead.ConvertedOpportunityId — the native
 * Salesforce field linking a converted Lead to the Opportunity it became —
 * rather than OpportunityContactRole, since Leads (not Contacts) are this
 * app's contact entity for Salesforce.
 */
async function syncSalesforceOpportunitiesAsDeals(
  orgId: string,
  provider: string,
  jobId: string,
  accessToken: string,
  instanceUrl: string,
  since?: Date
): Promise<void> {
  await syncJobRepository.updateEntityProgress(jobId, 'deals', { status: 'syncing' })
  await syncJobRepository.updateProgress(
    jobId,
    55,
    since ? 'Syncing opportunities (changes since last sync)' : 'Syncing opportunities'
  )

  // CM-03's per-org competitor tracking mode (gap G-11/G-24) — read once per sync run, not per page.
  const org = await organizationsRepository.findById(orgId)
  const competitorSource = org?.settings?.salesforceCompetitorSource
  const competitorField = competitorSource === 'field' ? org?.settings?.salesforceCompetitorField : undefined
  const useCompetitorJunctionObject = competitorSource === 'junction'

  let nextRecordsUrl: string | undefined
  let totalSynced = 0

  do {
    const response = await SalesforceService.getOpportunities(accessToken, instanceUrl, PAGE_SIZE, since, nextRecordsUrl, competitorField)
    const opportunityIds = response.records.map((opportunity) => opportunity.Id)

    const [stageHistories, convertedLeadsByOpportunity, competitorsByOpportunity, productIdsByOpportunity] = await Promise.all([
      SalesforceService.getOpportunityStageHistory(accessToken, instanceUrl, opportunityIds),
      SalesforceService.getConvertedLeadIdsByOpportunity(accessToken, instanceUrl, opportunityIds),
      // Only queried in 'junction' mode -- an org that doesn't use OpportunityCompetitor at all
      // shouldn't have this object's absence/inaccessibility break the whole sync.
      useCompetitorJunctionObject
        ? SalesforceService.getOpportunityCompetitors(accessToken, instanceUrl, opportunityIds).catch(() => ({}) as Record<string, string[]>)
        : Promise.resolve({} as Record<string, string[]>),
      // Same rationale as syncSalesforceProducts: some orgs restrict Product2/
      // OpportunityLineItem access, so a failure here degrades to no
      // productIds rather than breaking the whole opportunity sync.
      SalesforceService.getOpportunityLineItemProducts(accessToken, instanceUrl, opportunityIds).catch(
        () => ({}) as Record<string, string[]>
      )
    ])
    const historyByOpportunity = new Map<string, { value: string; timestamp: Date }[]>()
    for (const entry of stageHistories) {
      const list = historyByOpportunity.get(entry.recordId) ?? []
      list.push({ value: entry.value, timestamp: new Date(entry.timestamp) })
      historyByOpportunity.set(entry.recordId, list)
    }

    const deals = response.records.map((opportunity) => ({
      providerRecordId: opportunity.Id,
      dealname: opportunity.Name ?? undefined,
      amount: opportunity.Amount ?? undefined,
      closedate: opportunity.CloseDate ? new Date(opportunity.CloseDate) : undefined,
      pipeline: OPPORTUNITIES_PIPELINE,
      dealstage: opportunity.StageName ?? undefined,
      ownerId: opportunity.OwnerId ?? undefined,
      contactIds: convertedLeadsByOpportunity[opportunity.Id] ?? [],
      dealStageHistory: historyByOpportunity.get(opportunity.Id) ?? [],
      type: opportunity.Type ?? undefined,
      leadSource: opportunity.LeadSource ?? undefined,
      campaignId: opportunity.CampaignId ?? undefined,
      accountId: opportunity.AccountId ?? undefined,
      competitor: opportunity.Competitor ?? undefined,
      competitors: useCompetitorJunctionObject ? (competitorsByOpportunity[opportunity.Id] ?? undefined) : undefined,
      productIds: productIdsByOpportunity[opportunity.Id] ?? []
    }))

    await dealRepository.bulkUpsert(orgId, provider, deals)

    const events: FunnelStageEventInput[] = deals.flatMap((deal) =>
      deal.dealStageHistory.map((entry) => ({
        entityType: 'deal' as const,
        providerRecordId: deal.providerRecordId,
        pipeline: OPPORTUNITIES_PIPELINE,
        rawStage: entry.value,
        enteredAt: entry.timestamp
      }))
    )
    await funnelStageEventRepository.bulkUpsert(orgId, provider, events)

    totalSynced += deals.length
    await syncJobRepository.updateEntityProgress(jobId, 'deals', { synced: totalSynced })
    await syncJobRepository.updateProgress(jobId, 90, `Syncing opportunities (${totalSynced})`)

    nextRecordsUrl = response.done ? undefined : response.nextRecordsUrl
  } while (nextRecordsUrl)

  await syncJobRepository.updateEntityProgress(jobId, 'deals', { total: totalSynced, status: 'completed' })
}

/**
 * Syncs QuickBooks Customers — the billing-customer entity every invoice
 * (and, later, CM-02's concentration grouping) keys off. Pagination is QB's
 * STARTPOSITION/MAXRESULTS, not a cursor, unlike HubSpot/Salesforce.
 */
async function syncQuickBooksCustomers(
  orgId: string,
  provider: string,
  jobId: string,
  accessToken: string,
  realmId: string,
  since?: Date
): Promise<void> {
  await syncJobRepository.updateEntityProgress(jobId, 'customers', { status: 'syncing' })
  await syncJobRepository.updateProgress(jobId, 15, since ? 'Syncing customers (changes since last sync)' : 'Syncing customers')

  let startPosition = 1
  let totalSynced = 0
  let hasMore = true

  while (hasMore) {
    const page = await QuickBooksService.getCustomers(accessToken, realmId, startPosition, QUICKBOOKS_PAGE_SIZE, since)

    const customers = page.records.map((customer) => ({
      providerRecordId: customer.Id,
      displayName: customer.DisplayName,
      parentRecordId: customer.ParentRef?.value,
      active: customer.Active ?? true
    }))

    await quickBooksCustomerRepository.bulkUpsert(orgId, provider, customers)

    totalSynced += customers.length
    await syncJobRepository.updateEntityProgress(jobId, 'customers', { synced: totalSynced })
    await syncJobRepository.updateProgress(jobId, 40, `Syncing customers (${totalSynced})`)

    hasMore = page.hasMore
    startPosition += QUICKBOOKS_PAGE_SIZE
  }

  await syncJobRepository.updateEntityProgress(jobId, 'customers', { total: totalSynced, status: 'completed' })
}

/**
 * Syncs QuickBooks Invoices — the raw material for the customer revenue
 * roll-forward that VC-01/VC-02 (and every other QuickBooks-revenue metric)
 * read from. Only the per-invoice total and date are kept; see Invoice.model.ts
 * for why line-item detail isn't pulled yet.
 */
async function syncQuickBooksInvoices(
  orgId: string,
  provider: string,
  jobId: string,
  accessToken: string,
  realmId: string,
  since?: Date
): Promise<void> {
  await syncJobRepository.updateEntityProgress(jobId, 'invoices', { status: 'syncing' })
  await syncJobRepository.updateProgress(jobId, 55, since ? 'Syncing invoices (changes since last sync)' : 'Syncing invoices')

  let startPosition = 1
  let totalSynced = 0
  let hasMore = true

  while (hasMore) {
    const page = await QuickBooksService.getInvoices(accessToken, realmId, startPosition, QUICKBOOKS_PAGE_SIZE, since)

    const invoices = page.records.map((invoice) => ({
      providerRecordId: invoice.Id,
      customerRecordId: invoice.CustomerRef.value,
      txnDate: new Date(invoice.TxnDate),
      totalAmount: invoice.TotalAmt
    }))

    await invoiceRepository.bulkUpsert(orgId, provider, invoices)

    totalSynced += invoices.length
    await syncJobRepository.updateEntityProgress(jobId, 'invoices', { synced: totalSynced })
    await syncJobRepository.updateProgress(jobId, 90, `Syncing invoices (${totalSynced})`)

    hasMore = page.hasMore
    startPosition += QUICKBOOKS_PAGE_SIZE
  }

  await syncJobRepository.updateEntityProgress(jobId, 'invoices', { total: totalSynced, status: 'completed' })
}

/** "YYYY-MM" of the first month of the calendar quarter `monthsAgo` quarters before now. */
function quarterStartMonthsAgo(quartersAgo: number): string {
  const now = new Date()
  const currentQuarterFirstMonth = Math.floor(now.getUTCMonth() / 3) * 3
  const d = new Date(Date.UTC(now.getUTCFullYear(), currentQuarterFirstMonth - quartersAgo * 3, 1))
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

/** "YYYY-MM-DD" start/end dates for the quarter starting "YYYY-MM". */
function quarterDateRange(quarterStart: string): { startDate: string; endDate: string } {
  const [year, month] = quarterStart.split('-').map(Number)
  const startDate = `${year}-${String(month).padStart(2, '0')}-01`
  const end = new Date(Date.UTC(year, month - 1 + 3, 0)) // last day of the quarter's 3rd month
  const endDate = `${end.getUTCFullYear()}-${String(end.getUTCMonth() + 1).padStart(2, '0')}-${String(end.getUTCDate()).padStart(2, '0')}`
  return { startDate, endDate }
}

/**
 * Refreshes `PLSnapshot` for the trailing 6 quarters (18 months) — covers
 * every P&L metric's furthest back-reference (VC-12/13's year-ago-quarter
 * comparison, 4 quarters back) with a quarter of buffer. Metric computation
 * (plMetrics.service.ts) reads only from this stored snapshot, never
 * QuickBooks directly, so a dashboard view never blocks on a live report
 * call — see docs/sherpai-metrics-progress.md gap G-15.
 */
async function syncQuickBooksProfitAndLoss(
  orgId: string,
  provider: string,
  jobId: string,
  accessToken: string,
  realmId: string
): Promise<void> {
  await syncJobRepository.updateEntityProgress(jobId, 'plSnapshots', { status: 'syncing' })
  await syncJobRepository.updateProgress(jobId, 95, 'Syncing profit & loss snapshots')

  const TRAILING_QUARTERS = 6
  const quarterStarts = Array.from({ length: TRAILING_QUARTERS }, (_, i) => quarterStartMonthsAgo(i))

  const fetchedAt = new Date()
  let synced = 0
  const snapshots = []
  for (const quarterStart of quarterStarts) {
    const { startDate, endDate } = quarterDateRange(quarterStart)
    let report
    try {
      report = await QuickBooksService.getProfitAndLossReport(accessToken, realmId, startDate, endDate, 'Class')
    } catch {
      // Not every QuickBooks company has Class tracking enabled (an opt-in
      // Advanced accounting setting) -- Intuit's Reports API rejects
      // summarize_column_by=Class outright when it isn't, which used to abort
      // the whole sync. Falls back to a Total-only report instead: every
      // metric that reads the Total column still works, VC-04's per-Class
      // Mix % just isn't available for a company that doesn't track classes.
      report = await QuickBooksService.getProfitAndLossReport(accessToken, realmId, startDate, endDate, 'Total')
    }
    const parsed = parseProfitAndLoss(report)

    // CB-07/CB-10's inputs — each fetched independently and allowed to fail
    // without aborting the sync. A report a company's books genuinely can't
    // produce (e.g. no inventory tracking) should degrade to "not available
    // this quarter" (undefined, not 0), not break the P&L snapshot that
    // already fetched successfully.
    const [accountsReceivable, accountsPayable, inventoryValue, cashFlowTotals, balanceSheetTotals] = await Promise.all([
      QuickBooksService.getAgedReceivablesReport(accessToken, realmId, endDate)
        .then((r) => extractFlatReportGrandTotal(r))
        .catch(() => null),
      QuickBooksService.getAgedPayablesReport(accessToken, realmId, endDate)
        .then((r) => extractFlatReportGrandTotal(r))
        .catch(() => null),
      QuickBooksService.getInventoryValuationSummaryReport(accessToken, realmId, endDate)
        .then((r) => extractFlatReportGrandTotal(r, 'value'))
        .catch(() => null),
      QuickBooksService.getCashFlowReport(accessToken, realmId, startDate, endDate)
        .then((r) => extractSectionTotals(r))
        .catch(() => null),
      // Pulled for CB-07's Balance-Sheet-derived CapEx fallback (used only when the Cash Flow
      // report above isn't available for this quarter) -- same report CB-05 already calls daily
      // for its own BankAccounts section, just read for a different section here.
      QuickBooksService.getBalanceSheetReport(accessToken, realmId, endDate)
        .then((r) => extractSectionTotals(r))
        .catch(() => null)
    ])

    const operatingCashFlow = cashFlowTotals?.OperatingActivities?.Total
    // Investing-activities cash flow is reported as a negative (cash out); CapEx is a positive cost.
    const investingActivities = cashFlowTotals?.InvestingActivities?.Total
    const capEx = investingActivities !== undefined ? Math.abs(investingActivities) : undefined
    const netFixedAssets = balanceSheetTotals?.FixedAssets?.Total

    snapshots.push({
      quarterStart,
      startDate,
      endDate,
      columns: parsed.columns,
      income: parsed.income,
      cogs: parsed.cogs,
      expenses: parsed.expenses,
      otherExpenses: parsed.otherExpenses,
      sectionTotals: parsed.sectionTotals,
      accountsReceivable: accountsReceivable ?? undefined,
      accountsPayable: accountsPayable ?? undefined,
      inventoryValue: inventoryValue ?? undefined,
      operatingCashFlow,
      capEx,
      netFixedAssets,
      fetchedAt
    })
    synced += 1
    await syncJobRepository.updateEntityProgress(jobId, 'plSnapshots', { synced })
  }

  await plSnapshotRepository.upsertMany(orgId, provider, snapshots)
  await syncJobRepository.updateEntityProgress(jobId, 'plSnapshots', { total: quarterStarts.length, status: 'completed' })
}

// QuickBooks' Reports API only accepts a sellable Item as a report `item`
// filter — Category/Discount/Payment/Subtotal/Description are rejected.
// Same set docs/server.js's per-product report filtering uses.
const SELLABLE_ITEM_TYPES = new Set(['Service', 'Inventory', 'NonInventory', 'Bundle', 'Group'])

/**
 * Syncs QuickBooks Items (Products/Services), sellable types only — the
 * label source (via the shared `Product` catalog, `provider: 'quickbooks'`)
 * for the per-product filter on the VC-04/09/10/13 P&L trend cards. Returns
 * the synced items so `syncQuickBooksItemProfitAndLoss` doesn't need to
 * re-fetch them.
 */
async function syncQuickBooksItems(
  orgId: string,
  provider: string,
  jobId: string,
  accessToken: string,
  realmId: string
): Promise<{ providerRecordId: string; name: string }[]> {
  await syncJobRepository.updateEntityProgress(jobId, 'items', { status: 'syncing' })
  await syncJobRepository.updateProgress(jobId, 92, 'Syncing products & services')

  let startPosition = 1
  let hasMore = true
  const items: { providerRecordId: string; name: string }[] = []

  while (hasMore) {
    const page = await QuickBooksService.getItems(accessToken, realmId, startPosition, QUICKBOOKS_PAGE_SIZE)
    const sellable = page.records.filter((item) => item.Type && SELLABLE_ITEM_TYPES.has(item.Type))
    items.push(...sellable.map((item) => ({ providerRecordId: item.Id, name: item.Name || item.Id })))

    hasMore = page.hasMore
    startPosition += QUICKBOOKS_PAGE_SIZE
  }

  await productRepository.bulkUpsert(orgId, provider, items)
  await syncJobRepository.updateEntityProgress(jobId, 'items', { total: items.length, status: 'completed' })
  return items
}

/**
 * Refreshes `PLItemSnapshot` for the same trailing 6 quarters as
 * `syncQuickBooksProfitAndLoss`, one item-filtered P&L report per
 * (item, quarter) pair — the data behind the VC-04/09/10/13 product filter.
 * Concurrency-capped (`mapWithConcurrency`, limit 3) since this is N items ×
 * 6 report calls on top of the ~30 calls a QuickBooks sync already makes
 * (crm-integrations skill's explicit "worth watching under real load" gap);
 * `QuickBooksService.getReport`'s 429 retry/backoff covers the rest. A
 * single (item, quarter) failure is skipped, not fatal — same
 * "not computable" honesty rule as the whole-company snapshot, just scoped
 * to that one row instead of aborting every other item's sync.
 */
async function syncQuickBooksItemProfitAndLoss(
  orgId: string,
  provider: string,
  jobId: string,
  accessToken: string,
  realmId: string,
  items: { providerRecordId: string; name: string }[]
): Promise<void> {
  await syncJobRepository.updateEntityProgress(jobId, 'plItemSnapshots', { status: 'syncing' })
  await syncJobRepository.updateProgress(jobId, 94, 'Syncing per-product profit & loss snapshots')

  if (items.length === 0) {
    await syncJobRepository.updateEntityProgress(jobId, 'plItemSnapshots', { total: 0, status: 'completed' })
    return
  }

  const TRAILING_QUARTERS = 6
  const quarterStarts = Array.from({ length: TRAILING_QUARTERS }, (_, i) => quarterStartMonthsAgo(i))
  const tasks = items.flatMap((item) => quarterStarts.map((quarterStart) => ({ item, quarterStart })))

  const fetchedAt = new Date()
  let completed = 0

  const results = await mapWithConcurrency(tasks, 3, async ({ item, quarterStart }) => {
    const { startDate, endDate } = quarterDateRange(quarterStart)
    try {
      const report = await QuickBooksService.getProfitAndLossReport(accessToken, realmId, startDate, endDate, 'Total', item.providerRecordId)
      const parsed = parseProfitAndLoss(report)
      completed += 1
      await syncJobRepository.updateEntityProgress(jobId, 'plItemSnapshots', { synced: completed })
      return {
        itemId: item.providerRecordId,
        quarterStart,
        startDate,
        endDate,
        columns: parsed.columns,
        income: parsed.income,
        cogs: parsed.cogs,
        expenses: parsed.expenses,
        otherExpenses: parsed.otherExpenses,
        sectionTotals: parsed.sectionTotals,
        fetchedAt
      }
    } catch (err) {
      console.error(`Skipping PLItemSnapshot for item ${item.providerRecordId}, quarter ${quarterStart}:`, err)
      completed += 1
      await syncJobRepository.updateEntityProgress(jobId, 'plItemSnapshots', { synced: completed })
      return null
    }
  })

  // `fn` above never rejects (it catches internally so one item/quarter's
  // failure doesn't stop the rest) — every result is 'fulfilled', with a
  // `null` value standing in for a skipped (item, quarter) pair.
  const snapshots = results.flatMap((r) => (r.status === 'fulfilled' && r.value ? [r.value] : []))

  await plItemSnapshotRepository.upsertMany(orgId, provider, snapshots)
  await syncJobRepository.updateEntityProgress(jobId, 'plItemSnapshots', { total: tasks.length, status: 'completed' })
}

/**
 * Refreshes `CashBalanceSnapshot` for today — CB-05's unrestricted-cash
 * input (Balance Sheet's bank-type accounts, the QuickBooks-fallback mode
 * per the metrics guide; bank-feed/Plaid is out of MVP scope). One call,
 * cheap; runs every sync alongside the other QuickBooks steps.
 */
async function syncQuickBooksCashBalance(orgId: string, provider: string, jobId: string, accessToken: string, realmId: string): Promise<void> {
  await syncJobRepository.updateEntityProgress(jobId, 'cashBalance', { status: 'syncing' })
  await syncJobRepository.updateProgress(jobId, 98, 'Syncing cash balance')

  const today = new Date().toISOString().slice(0, 10)
  const report = await QuickBooksService.getBalanceSheetReport(accessToken, realmId, today)
  const sectionTotals = extractSectionTotals(report)
  const unrestrictedCash = sectionTotals.BankAccounts?.Total ?? 0

  await cashBalanceSnapshotRepository.upsert(orgId, provider, { asOfDate: today, unrestrictedCash, fetchedAt: new Date() })
  await syncJobRepository.updateEntityProgress(jobId, 'cashBalance', { total: 1, synced: 1, status: 'completed' })
}
