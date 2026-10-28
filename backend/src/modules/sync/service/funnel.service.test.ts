import { funnelService } from './funnel.service'
import { funnelStageEventRepository } from '../repository/funnelStageEvent.repository'
import { pipelineStageDefinitionRepository } from '../repository/pipelineStageDefinition.repository'
import { contactRepository } from '../repository/contact.repository'
import { dealRepository } from '../repository/deal.repository'

jest.mock('../repository/funnelStageEvent.repository')
jest.mock('../repository/pipelineStageDefinition.repository')
jest.mock('../repository/contact.repository')
jest.mock('../repository/deal.repository')

const mockedGetStageMembershipCounts = funnelStageEventRepository.getStageMembershipCounts as jest.Mock
const mockedGetRecordStageSets = funnelStageEventRepository.getRecordStageSets as jest.Mock
const mockedGetCohortRecordIds = funnelStageEventRepository.getCohortRecordIds as jest.Mock
const mockedFindAllForOrg = pipelineStageDefinitionRepository.findAllForOrg as jest.Mock
const mockedContactCount = contactRepository.count as jest.Mock
const mockedFindContactAssociationsForFunnel = dealRepository.findContactAssociationsForFunnel as jest.Mock

const CONTACTS_PIPELINE = 'contacts-default'
const DEFS = [
  { entityType: 'lead', pipeline: CONTACTS_PIPELINE, rawStage: 'subscriber', label: 'Subscriber', displayOrder: 1, isClosed: false, isWon: false },
  { entityType: 'lead', pipeline: CONTACTS_PIPELINE, rawStage: 'lead', label: 'Lead', displayOrder: 2, isClosed: false, isWon: false },
  { entityType: 'lead', pipeline: CONTACTS_PIPELINE, rawStage: 'mql', label: 'MQL', displayOrder: 3, isClosed: false, isWon: false },
  { entityType: 'lead', pipeline: CONTACTS_PIPELINE, rawStage: 'sql', label: 'SQL', displayOrder: 4, isClosed: false, isWon: false },
  { entityType: 'lead', pipeline: CONTACTS_PIPELINE, rawStage: 'customer', label: 'Customer', displayOrder: 5, isClosed: false, isWon: false }
]

describe('funnelService.getFunnels — rank-based cumulative membership stays monotonic', () => {
  beforeEach(() => {
    mockedGetStageMembershipCounts.mockReset()
    mockedGetRecordStageSets.mockReset()
    mockedGetCohortRecordIds.mockReset()
    mockedFindAllForOrg.mockReset()
    mockedContactCount.mockReset()
    mockedFindContactAssociationsForFunnel.mockReset()
    mockedContactCount.mockResolvedValue(0)
    mockedFindContactAssociationsForFunnel.mockResolvedValue([])
    mockedFindAllForOrg.mockResolvedValue(DEFS)
    // Not exercised by these tests (no pipeline filter -> resolvedDealPipeline falls
    // back to dealCounts[0]?.pipeline, which is undefined here -> empty deal funnel).
    mockedGetStageMembershipCounts.mockResolvedValue([])
    mockedGetRecordStageSets.mockResolvedValue([])
  })

  it('a stage never exceeds the one above it, even when records skip straight to a later stage', async () => {
    // 10 contacts total. Only 6 have an explicit "subscriber" event; 4 of the
    // "customer" contacts were created directly there with no earlier history at all.
    mockedGetStageMembershipCounts.mockImplementation((_orgId, _provider, entityType) =>
      Promise.resolve(
        entityType === 'lead'
          ? [
              { pipeline: CONTACTS_PIPELINE, rawStage: 'subscriber', count: 6 },
              { pipeline: CONTACTS_PIPELINE, rawStage: 'lead', count: 5 },
              { pipeline: CONTACTS_PIPELINE, rawStage: 'mql', count: 4 },
              { pipeline: CONTACTS_PIPELINE, rawStage: 'sql', count: 2 },
              { pipeline: CONTACTS_PIPELINE, rawStage: 'customer', count: 3 }
            ]
          : []
      )
    )
    mockedGetRecordStageSets.mockImplementation((_orgId, _provider, entityType) =>
      Promise.resolve(
        entityType === 'lead'
          ? [
              { providerRecordId: 'c1', pipeline: CONTACTS_PIPELINE, stages: ['subscriber'] },
              { providerRecordId: 'c2', pipeline: CONTACTS_PIPELINE, stages: ['subscriber', 'lead'] },
              { providerRecordId: 'c3', pipeline: CONTACTS_PIPELINE, stages: ['subscriber', 'lead', 'mql'] },
              { providerRecordId: 'c4', pipeline: CONTACTS_PIPELINE, stages: ['lead'] },
              { providerRecordId: 'c5', pipeline: CONTACTS_PIPELINE, stages: ['mql'] },
              { providerRecordId: 'c6', pipeline: CONTACTS_PIPELINE, stages: ['subscriber', 'lead', 'mql', 'sql'] },
              { providerRecordId: 'c7', pipeline: CONTACTS_PIPELINE, stages: ['customer'] },
              { providerRecordId: 'c8', pipeline: CONTACTS_PIPELINE, stages: ['subscriber', 'customer'] },
              { providerRecordId: 'c9', pipeline: CONTACTS_PIPELINE, stages: ['subscriber'] },
              { providerRecordId: 'c10', pipeline: CONTACTS_PIPELINE, stages: ['lead', 'mql', 'sql', 'customer'] }
            ]
          : []
      )
    )

    const result = await funnelService.getFunnels('org1', 'hubspot', {})

    expect(result.leadStage.totalEntered).toBe(10)
    const byStage = Object.fromEntries(result.leadStage.stages.map((s) => [s.rawStage, s]))
    expect(byStage.subscriber.count).toBe(10)
    expect(byStage.lead.count).toBe(8)
    expect(byStage.mql.count).toBe(6)
    expect(byStage.sql.count).toBe(4)
    expect(byStage.customer.count).toBe(3)

    // Strictly non-increasing top to bottom — the whole point of the fix.
    const counts = result.leadStage.stages.map((s) => s.count)
    for (let i = 1; i < counts.length; i++) {
      expect(counts[i]).toBeLessThanOrEqual(counts[i - 1])
    }

    // The literal (explicitly-recorded) counts are preserved separately, unchanged.
    expect(byStage.subscriber.literalCount).toBe(6)
    expect(byStage.customer.literalCount).toBe(3)
  })

  it('falls back to 0 for both count and literalCount when no data exists', async () => {
    const result = await funnelService.getFunnels('org1', 'hubspot', {})
    expect(result.leadStage.totalEntered).toBe(0)
    for (const stage of result.leadStage.stages) {
      expect(stage.count).toBe(0)
      expect(stage.literalCount).toBe(0)
    }
  })
})
