import { invoiceRepository } from '../../sync/repository/invoice.repository'
import { quickBooksCustomerRepository } from '../../sync/repository/quickBooksCustomer.repository'
import { dealRepository } from '../../sync/repository/deal.repository'
import { contactRepository } from '../../sync/repository/contact.repository'
import { pipelineStageDefinitionRepository } from '../../sync/repository/pipelineStageDefinition.repository'
import { funnelStageEventRepository } from '../../sync/repository/funnelStageEvent.repository'
import { salesforceCampaignRepository } from '../../sync/repository/salesforceCampaign.repository'
import { organizationsRepository } from '../../organizations/repository/organizations.repository'
import { getStoredProfitAndLoss } from './plReport.service'
import {
  computeCM02,
  computeCM03,
  computeCM04,
  computeCM05,
  computeCM06,
  computeCM07,
  computeCM08,
  quarterTargetFromRanges
} from './cmMetrics.service'

jest.mock('../../sync/repository/invoice.repository')
jest.mock('../../sync/repository/quickBooksCustomer.repository')
jest.mock('../../sync/repository/deal.repository')
jest.mock('../../sync/repository/contact.repository')
jest.mock('../../sync/repository/pipelineStageDefinition.repository')
jest.mock('../../sync/repository/funnelStageEvent.repository')
jest.mock('../../sync/repository/salesforceCampaign.repository')
jest.mock('../../organizations/repository/organizations.repository')
jest.mock('./plReport.service')

const mockedGetMonthlyRevenue = invoiceRepository.getMonthlyRevenueByCustomer as jest.Mock
const mockedFindAllCustomers = quickBooksCustomerRepository.findAll as jest.Mock
const mockedFindByCloseDateRange = dealRepository.findByCloseDateRange as jest.Mock
const mockedFindByCreateDateRange = dealRepository.findByCreateDateRange as jest.Mock
const mockedFindSourcesByProvider = contactRepository.findSourcesByProvider as jest.Mock
const mockedFindAllStageDefs = pipelineStageDefinitionRepository.findAllForOrg as jest.Mock
const mockedGetFirstStageEntries = funnelStageEventRepository.getFirstStageEntries as jest.Mock
const mockedCountRecordsFirstEnteringStage = funnelStageEventRepository.countRecordsFirstEnteringStage as jest.Mock
const mockedGetStoredPL = getStoredProfitAndLoss as jest.Mock
const mockedFindOrgById = organizationsRepository.findById as jest.Mock
const mockedFindAllCampaigns = salesforceCampaignRepository.findAll as jest.Mock

function customer(providerRecordId: string, displayName: string, parentRecordId?: string) {
  return { providerRecordId, displayName, parentRecordId, active: true }
}

function revenueRow(customerRecordId: string, revenue: number, month = '2026-02') {
  return { customerRecordId, month, revenue }
}

beforeEach(() => {
  mockedGetMonthlyRevenue.mockReset()
  mockedFindAllCustomers.mockReset()
  // Default: no year-ago comparison data unless a test overrides it (2nd call = year-ago window).
  mockedFindAllCustomers.mockResolvedValue([])
})

describe('CM-02 — Customer Concentration, QuickBooks-native ParentRef grouping', () => {
  it('groups a subsidiary under its parent instead of counting it as a separate customer', async () => {
    mockedFindAllCustomers.mockResolvedValue([
      customer('parentA', 'Union Rail & Road'),
      customer('childA', 'Union Rail & Road - Midwest', 'parentA'),
      customer('standaloneB', 'Coastal Express Lines')
    ])
    mockedGetMonthlyRevenue
      .mockResolvedValueOnce([revenueRow('parentA', 5000), revenueRow('childA', 4000), revenueRow('standaloneB', 1000)])
      .mockResolvedValueOnce([]) // year-ago window: no data

    const result = await computeCM02('org1', '2026-02')

    // parentA + childA merge into one 9000 group; standaloneB stays separate at 1000. Total 10000.
    expect(result.data.totalRevenue).toBeCloseTo(10000, 0)
    expect(result.data.top1Pct).toBeCloseTo(90, 0)
    expect(result.data.customerGroupCount).toBe(2) // merged into 2 groups, not 3 customers
  })

  it('not computable with zero trailing-12-month revenue', async () => {
    mockedGetMonthlyRevenue.mockResolvedValue([])
    const result = await computeCM02('org1', '2026-02')
    expect(result.computable).toBe(false)
    expect(result.value).toBeNull()
  })

  it('watch: top-10 concentration between 40% and 60%, no single customer over 20%', async () => {
    const customers = Array.from({ length: 20 }, (_, i) => customer(`c${i}`, `Customer ${i}`))
    const rows = customers.map((c) => revenueRow(c.providerRecordId, 50)) // 20 * 50 = 1000; top10 = 500 = 50%
    mockedFindAllCustomers.mockResolvedValue(customers)
    mockedGetMonthlyRevenue.mockResolvedValueOnce(rows).mockResolvedValueOnce([])

    const result = await computeCM02('org1', '2026-02')
    expect(result.data.top10Pct).toBeCloseTo(50, 0)
    expect(result.flag?.level).toBe('watch')
  })

  it('act_now: a single customer alone exceeds 20% of trailing-12-month revenue, even with top-10 under 60%', async () => {
    // 1 big customer at 22% + 30 smaller ones splitting the rest -> top10 stays well under 60% but the single customer trips the 20% ceiling.
    const smallCustomers = Array.from({ length: 30 }, (_, i) => customer(`small${i}`, `Small ${i}`))
    const customers = [customer('big', 'Big Whale Co'), ...smallCustomers]
    const rows = [revenueRow('big', 2200), ...smallCustomers.map((c) => revenueRow(c.providerRecordId, 260))]
    mockedFindAllCustomers.mockResolvedValue(customers)
    mockedGetMonthlyRevenue.mockResolvedValueOnce(rows).mockResolvedValueOnce([])

    const result = await computeCM02('org1', '2026-02')
    expect(result.data.top1Pct).toBeGreaterThan(20)
    expect(result.data.top10Pct).toBeLessThan(60)
    expect(result.flag?.level).toBe('act_now')
    expect(result.flag?.reason).toContain('Big Whale Co')
  })

  it('act_now: top-10 concentration exceeds 60%', async () => {
    const customers = Array.from({ length: 11 }, (_, i) => customer(`c${i}`, `Customer ${i}`))
    // 10 "top" customers at 70 each (700), 1 small one at 100 -> total 800, top10 = 700/800 = 87.5%
    const rows = [
      ...Array.from({ length: 10 }, (_, i) => revenueRow(`c${i}`, 70)),
      revenueRow('c10', 100)
    ]
    mockedFindAllCustomers.mockResolvedValue(customers)
    mockedGetMonthlyRevenue.mockResolvedValueOnce(rows).mockResolvedValueOnce([])

    const result = await computeCM02('org1', '2026-02')
    expect(result.data.top10Pct).toBeGreaterThan(60)
    expect(result.flag?.level).toBe('act_now')
  })
})

describe('CM-04 — Pipeline Coverage Ratio', () => {
  beforeEach(() => {
    mockedFindByCloseDateRange.mockReset()
    mockedFindAllStageDefs.mockReset()
    mockedFindOrgById.mockReset()
    mockedFindAllStageDefs.mockResolvedValue([
      { entityType: 'deal', pipeline: 'default', rawStage: 'appointmentscheduled', displayOrder: 1, isClosed: false, isWon: false },
      { entityType: 'deal', pipeline: 'default', rawStage: 'qualifiedtobuy', displayOrder: 2, isClosed: false, isWon: false },
      { entityType: 'deal', pipeline: 'default', rawStage: 'closedwon', displayOrder: 3, isClosed: true, isWon: true }
    ])
    mockedFindByCloseDateRange.mockResolvedValue([
      { pipeline: 'default', dealstage: 'appointmentscheduled', amount: 1000 }, // intake stage -- not qualified
      { pipeline: 'default', dealstage: 'qualifiedtobuy', amount: 5000 }, // qualified
      { pipeline: 'default', dealstage: 'closedwon', amount: 2000 } // closed -- not open pipeline
    ])
  })

  it('sums only deals in a qualified (non-intake, non-closed) stage; not computable without a target', async () => {
    mockedFindOrgById.mockResolvedValue({ settings: {} })

    // Feb 2026 -> measures next quarter, 2026-Q2 (Apr-Jun).
    const result = await computeCM04('org1', 'hubspot', '2026-02')

    expect(result.period).toBe('2026-04')
    expect(result.computable).toBe(false)
    expect(result.value).toBeNull()
    expect(result.data.qualifiedPipelineAmount).toBeCloseTo(5000, 0)
    expect(result.data.qualifiedDealCount).toBe(1)
    expect(result.data.missingTargetMonths).toEqual(['2026-04', '2026-05', '2026-06'])
  })

  it('divides qualified pipeline by the quarter target, no flag at or above 3.0x', async () => {
    mockedFindOrgById.mockResolvedValue({ settings: { cm04Targets: [{ fromMonth: '2026-04', toMonth: '2026-06', targetAmount: 1500 }] } })

    const result = await computeCM04('org1', 'hubspot', '2026-02')

    expect(result.computable).toBe(true)
    expect(result.value).toBeCloseTo(3.33, 2)
    expect(result.data.nextQuarterTarget).toBeCloseTo(1500, 0)
    expect(result.flag).toBeNull()
  })

  it('watch: coverage below 3.0x', async () => {
    mockedFindOrgById.mockResolvedValue({ settings: { cm04Targets: [{ fromMonth: '2026-04', toMonth: '2026-06', targetAmount: 2500 }] } })

    const result = await computeCM04('org1', 'hubspot', '2026-02')

    expect(result.value).toBeCloseTo(2, 2)
    expect(result.flag?.level).toBe('watch')
  })

  it('counts only new-business deals (or untyped ones) toward the new-business target', async () => {
    mockedFindOrgById.mockResolvedValue({ settings: { cm04Targets: [{ fromMonth: '2026-04', toMonth: '2026-06', targetAmount: 1000 }] } })
    mockedFindByCloseDateRange.mockResolvedValue([
      { pipeline: 'default', dealstage: 'qualifiedtobuy', amount: 3000, type: 'newbusiness' }, // HubSpot dealtype
      { pipeline: 'default', dealstage: 'qualifiedtobuy', amount: 1000, type: 'New Business' }, // Salesforce Opportunity.Type
      { pipeline: 'default', dealstage: 'qualifiedtobuy', amount: 500 }, // no type recorded -- kept
      { pipeline: 'default', dealstage: 'qualifiedtobuy', amount: 9000, type: 'existingbusiness' } // renewal/upsell -- excluded
    ])

    const result = await computeCM04('org1', 'hubspot', '2026-02')

    expect(result.data.qualifiedPipelineAmount).toBeCloseTo(4500, 0)
    expect(result.data.qualifiedDealCount).toBe(3)
    expect(result.data.excludedNonNewBusinessDealCount).toBe(1)
    expect(result.data.untypedDealCount).toBe(1)
    expect(result.value).toBeCloseTo(4.5, 2)
  })

  it('act now: coverage below 2.0x', async () => {
    mockedFindOrgById.mockResolvedValue({ settings: { cm04Targets: [{ fromMonth: '2026-04', toMonth: '2026-06', targetAmount: 5000 }] } })

    const result = await computeCM04('org1', 'hubspot', '2026-02')

    expect(result.value).toBeCloseTo(1, 2)
    expect(result.flag?.level).toBe('act_now')
  })

  describe('Salesforce: under 3.0x escalates to act now while the CM-03 win rate is falling', () => {
    const many = (n: number, dealstage: string, competitor: string) => Array.from({ length: n }, () => ({ pipeline: 'opportunities-default', dealstage, competitor }))

    beforeEach(() => {
      mockedFindAllStageDefs.mockResolvedValue([
        { entityType: 'deal', pipeline: 'opportunities-default', rawStage: 'Prospecting', displayOrder: 1, isClosed: false, isWon: false },
        { entityType: 'deal', pipeline: 'opportunities-default', rawStage: 'Negotiation', displayOrder: 2, isClosed: false, isWon: false },
        { entityType: 'deal', pipeline: 'opportunities-default', rawStage: 'Closed Won', displayOrder: 3, isClosed: true, isWon: true },
        { entityType: 'deal', pipeline: 'opportunities-default', rawStage: 'Closed Lost', displayOrder: 4, isClosed: true, isWon: false }
      ])
      mockedFindOrgById.mockResolvedValue({
        settings: {
          salesforceCompetitorSource: 'field',
          salesforceCompetitorField: 'Competitor__c',
          cm04Targets: [{ fromMonth: '2026-04', toMonth: '2026-06', targetAmount: 2000 }] // 5000 / 2000 = 2.5x
        }
      })
      mockedFindByCloseDateRange.mockReset()
      // CM-04's own next-quarter deals come first; CM-03's current + prior windows follow.
      mockedFindByCloseDateRange.mockResolvedValueOnce([{ pipeline: 'opportunities-default', dealstage: 'Negotiation', amount: 5000, type: 'New Business' }])
    })

    it('act now when a competitor win rate fell', async () => {
      mockedFindByCloseDateRange
        .mockResolvedValueOnce([...many(2, 'Closed Won', 'Acme'), ...many(8, 'Closed Lost', 'Acme')]) // 20%
        .mockResolvedValueOnce([...many(8, 'Closed Won', 'Acme'), ...many(2, 'Closed Lost', 'Acme')]) // 80% prior

      const result = await computeCM04('org1', 'salesforce', '2026-02')

      expect(result.value).toBeCloseTo(2.5, 2)
      expect(result.flag?.level).toBe('act_now')
      expect(result.flag?.reason).toContain('CM-03')
    })

    it('watch when the win rate is steady', async () => {
      mockedFindByCloseDateRange
        .mockResolvedValueOnce([...many(5, 'Closed Won', 'Acme'), ...many(5, 'Closed Lost', 'Acme')])
        .mockResolvedValueOnce([...many(5, 'Closed Won', 'Acme'), ...many(5, 'Closed Lost', 'Acme')])

      const result = await computeCM04('org1', 'salesforce', '2026-02')

      expect(result.flag?.level).toBe('watch')
    })
  })

  it('not computable when any month of the quarter has no target', async () => {
    mockedFindOrgById.mockResolvedValue({ settings: { cm04Targets: [{ fromMonth: '2026-04', toMonth: '2026-05', targetAmount: 1000 }] } })

    const result = await computeCM04('org1', 'hubspot', '2026-02')

    expect(result.computable).toBe(false)
    expect(result.data.nextQuarterTarget).toBeNull()
    expect(result.data.missingTargetMonths).toEqual(['2026-06'])
  })
})

describe('quarterTargetFromRanges', () => {
  it('uses a row matching the quarter exactly', () => {
    expect(quarterTargetFromRanges([{ fromMonth: '2023-10', toMonth: '2023-12', targetAmount: 878000 }], '2023-10')).toEqual({
      target: 878000,
      missingMonths: []
    })
  })

  it('takes the quarter months share of a longer range, spread evenly', () => {
    const { target } = quarterTargetFromRanges([{ fromMonth: '2023-10', toMonth: '2024-03', targetAmount: 1800000 }], '2023-10')
    expect(target).toBeCloseTo(900000, 0)
  })

  it('adds up several rows that together cover the quarter', () => {
    const { target } = quarterTargetFromRanges(
      [
        { fromMonth: '2023-01', toMonth: '2023-10', targetAmount: 1000 }, // 100/month, Oct only
        { fromMonth: '2023-11', toMonth: '2023-12', targetAmount: 600 } // 300/month
      ],
      '2023-10'
    )
    expect(target).toBeCloseTo(700, 0)
  })

  it('spans a year boundary', () => {
    const { target } = quarterTargetFromRanges([{ fromMonth: '2025-07', toMonth: '2026-06', targetAmount: 1200 }], '2026-01')
    expect(target).toBeCloseTo(300, 0)
  })
})

/**
 * One quarter's worth of contacts for CM-06: `leads` enter `lead` on the 2nd of the quarter's
 * first month, the first `mqls` of them become MQLs on the 12th, the first `sqls` of those
 * become SQLs on the 22nd — so every transition's cohort sits inside the same quarter.
 */
let funnelRecordSeq = 0
function quarterFunnel(quarterStart: string, leads: number, mqls: number, sqls: number) {
  const day = (d: number) => new Date(`${quarterStart}-${String(d).padStart(2, '0')}T00:00:00Z`)
  return Array.from({ length: leads }, (_, i) => ({
    providerRecordId: `c${(funnelRecordSeq += 1)}`,
    firstEntered: {
      lead: day(2),
      ...(i < mqls ? { marketingqualifiedlead: day(12) } : {}),
      ...(i < sqls ? { salesqualifiedlead: day(22) } : {})
    }
  }))
}

/** `current` for the given quarter, plus the same funnel shape in each of its four prior quarters. */
function funnelWithHistory(quarterStart: string, current: [number, number, number], priors: [number, number, number][]) {
  const quarters = [1, 2, 3, 4].map((i) => {
    const [year, mo] = quarterStart.split('-').map(Number)
    const total = year * 12 + (mo - 1) - 3 * i
    return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}`
  })
  return [quarterFunnel(quarterStart, ...current), ...priors.flatMap((p, i) => quarterFunnel(quarters[i], ...p))].flat()
}

describe('CM-06 — Funnel Conversion Rates (cohort-based, per stage, quarterly)', () => {
  beforeEach(() => {
    mockedGetFirstStageEntries.mockReset()
  })

  // As of Jun 2026: Lead->MQL (3-month maturation), MQL->SQL and SQL->Opportunity (2 months)
  // all read the Jan-Mar 2026 cohort; Opportunity->Won (6 months) reads Oct-Dec 2025.
  const AS_OF = '2026-06'
  const stage = (result: Awaited<ReturnType<typeof computeCM06>>, key: string) => (result.data.stages as any[]).find((s) => s.key === key)

  it('rates each transition on its own latest mature quarterly cohort; holds the flag back for a small cohort', async () => {
    mockedGetFirstStageEntries.mockResolvedValue(quarterFunnel('2026-01', 10, 5, 2))

    const result = await computeCM06('org1', 'hubspot', AS_OF)

    expect(result.value).toBeCloseTo(40, 1) // MQL -> SQL = 2/5
    expect(result.period).toBe('2026-01')
    expect(stage(result, 'leadToMql')).toMatchObject({ cohortQuarter: '2026-01', cohortSize: 10, advanced: 5, ratePct: 50, maturationMonths: 3 })
    expect(stage(result, 'mqlToSql').medianDaysToAdvance).toBeCloseTo(10, 1) // MQL on the 12th, SQL on the 22nd
    expect(stage(result, 'opportunityToWon').cohortQuarter).toBe('2025-10')
    expect(result.data.cohortSizeSufficient).toBe(false) // 10 leads < 100 minimum
    expect(result.flag).toBeNull()
  })

  it('counts an advance only into the exact next stage', async () => {
    // A contact sales created straight at SQL, skipping MQL: it is not a Lead -> MQL conversion.
    mockedGetFirstStageEntries.mockResolvedValue([
      { providerRecordId: 'x', firstEntered: { lead: new Date('2026-01-02T00:00:00Z'), salesqualifiedlead: new Date('2026-01-10T00:00:00Z') } }
    ])

    const result = await computeCM06('org1', 'hubspot', AS_OF)

    expect(stage(result, 'leadToMql')).toMatchObject({ cohortSize: 1, advanced: 0, ratePct: 0 })
  })

  it('act now: MQL -> SQL below half its trailing four-quarter average', async () => {
    mockedGetFirstStageEntries.mockResolvedValue(funnelWithHistory('2026-01', [150, 60, 6], Array(4).fill([150, 60, 36]))) // 10% vs. 60%

    const result = await computeCM06('org1', 'hubspot', AS_OF)

    expect(result.data.cohortSizeSufficient).toBe(true)
    expect(stage(result, 'mqlToSql').trailingAvgPct).toBeCloseTo(60, 1)
    expect(result.flag?.level).toBe('act_now')
    expect(result.flag?.reason).toContain('below half')
  })

  it('act now: two adjacent stages more than 20% below their trailing averages', async () => {
    // Lead -> MQL 28% vs. 40%; MQL -> SQL 35.7% vs. 60% (down, but not below half).
    mockedGetFirstStageEntries.mockResolvedValue(funnelWithHistory('2026-01', [150, 42, 15], Array(4).fill([150, 60, 36])))

    const result = await computeCM06('org1', 'hubspot', AS_OF)

    expect(result.flag?.level).toBe('act_now')
    expect(result.flag?.reason).toContain('Lead -> MQL and MQL -> SQL')
  })

  it('watch: a single stage more than 20% below its trailing average', async () => {
    // Lead -> MQL 28% vs. 40%; MQL -> SQL 59.5% vs. 60% (steady).
    mockedGetFirstStageEntries.mockResolvedValue(funnelWithHistory('2026-01', [150, 42, 25], Array(4).fill([150, 60, 36])))

    const result = await computeCM06('org1', 'hubspot', AS_OF)

    expect(result.flag?.level).toBe('watch')
    expect(result.flag?.reason).toContain('Lead -> MQL')
  })

  it('does not false-fire on one unusually strong prior quarter once averaged over four', async () => {
    // MQL -> SQL now 50%; prior quarters 80% (spike), 50%, 48%, 52% -> average 57.5%; 50 is not < 46.
    mockedGetFirstStageEntries.mockResolvedValue(
      funnelWithHistory('2026-01', [150, 100, 50], [
        [150, 100, 80],
        [150, 100, 50],
        [150, 100, 48],
        [150, 100, 52]
      ])
    )

    const result = await computeCM06('org1', 'hubspot', AS_OF)

    expect(stage(result, 'mqlToSql').trailingAvgPct).toBeCloseTo(57.5, 1)
    expect(result.flag).toBeNull()
  })

  it('not computable with no lifecycle history at all', async () => {
    mockedGetFirstStageEntries.mockResolvedValue([])
    const result = await computeCM06('org1', 'hubspot', AS_OF)
    expect(result.computable).toBe(false)
  })
})

describe('CM-08 — Lead Volume vs. Plan (MQL Flow)', () => {
  beforeEach(() => {
    mockedCountRecordsFirstEnteringStage.mockReset()
    mockedGetFirstStageEntries.mockReset()
    mockedGetFirstStageEntries.mockResolvedValue([]) // CM-06's cross-check: not computable, no flag, unless a test sets it
    mockedFindOrgById.mockReset()
    mockedFindOrgById.mockResolvedValue({ settings: {} }) // no MQL plan unless a test sets one
    // CM-08's CM-06 cross-check runs "as of now"; pin it so its latest mature MQL -> SQL cohort is Apr-Jun 2026.
    jest.useFakeTimers({ now: new Date('2026-10-15T00:00:00Z'), doNotFake: ['nextTick', 'queueMicrotask', 'setImmediate'] })
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  // CM-06 deteriorating: MQL -> SQL 10% in Apr-Jun 2026 vs. 60% in each of the four prior quarters.
  const cm06Deteriorating = () => funnelWithHistory('2026-04', [150, 60, 6], Array(4).fill([150, 60, 36]))

  it('watch: MQL volume declined two months running, while CM-06 is not (also) deteriorating', async () => {
    mockedCountRecordsFirstEnteringStage
      .mockResolvedValueOnce(80) // this month
      .mockResolvedValueOnce(100) // last month
      .mockResolvedValueOnce(120) // two months ago
    // CM-06's internal cross-check comes back empty -> not computable -> no flag.

    const result = await computeCM08('org1', 'hubspot', '2026-02')
    expect(result.value).toBe(80)
    expect(result.data.growthPct).toBeCloseTo(-20, 0)
    expect(result.flag?.level).toBe('watch')
  })

  it('act_now: MQL volume declining two months running AND CM-06 is also deteriorating', async () => {
    mockedCountRecordsFirstEnteringStage.mockResolvedValueOnce(80).mockResolvedValueOnce(100).mockResolvedValueOnce(120)
    mockedGetFirstStageEntries.mockResolvedValue(cm06Deteriorating())

    const result = await computeCM08('org1', 'hubspot', '2026-02')
    expect(result.flag?.level).toBe('act_now')
  })

  it('no flag when MQL volume is not declining', async () => {
    mockedCountRecordsFirstEnteringStage.mockResolvedValueOnce(120).mockResolvedValueOnce(100).mockResolvedValueOnce(80)
    const result = await computeCM08('org1', 'hubspot', '2026-02')
    expect(result.data.growthPct).toBeCloseTo(20, 0)
    expect(result.flag).toBeNull()
  })

  it('act_now: a single-month MQL fall (not two months running) still escalates when CM-06 is also deteriorating', async () => {
    // current 80 < previous 100, but previous 100 is NOT < two-ago 90 -> not a two-month streak.
    mockedCountRecordsFirstEnteringStage.mockResolvedValueOnce(80).mockResolvedValueOnce(100).mockResolvedValueOnce(90)
    mockedGetFirstStageEntries.mockResolvedValue(cm06Deteriorating())

    const result = await computeCM08('org1', 'hubspot', '2026-02')
    expect(result.flag?.level).toBe('act_now')
    expect(result.flag?.reason).not.toContain('two months running')
  })

  it('no flag on a single-month MQL fall when CM-06 is not (also) deteriorating', async () => {
    mockedCountRecordsFirstEnteringStage.mockResolvedValueOnce(80).mockResolvedValueOnce(100).mockResolvedValueOnce(90)

    const result = await computeCM08('org1', 'hubspot', '2026-02')
    expect(result.flag).toBeNull()
  })

  describe('vs. the MQL plan', () => {
    // Calls run in order: this month, last month, two months ago, then the last full quarter.
    const counts = (month: number, previous: number, twoAgo: number, quarter: number) =>
      mockedCountRecordsFirstEnteringStage
        .mockResolvedValueOnce(month)
        .mockResolvedValueOnce(previous)
        .mockResolvedValueOnce(twoAgo)
        .mockResolvedValueOnce(quarter)
    // 1,200 MQLs over Jan-Dec 2025 -> 100 a month, 300 a quarter.
    const plan = { cm08MqlTargets: [{ fromMonth: '2025-01', toMonth: '2025-12', targetCount: 1200 }] }

    it('reports the month variance and the last full quarter, no flag within 15% of plan', async () => {
      mockedFindOrgById.mockResolvedValue({ settings: plan })
      counts(90, 90, 90, 280)

      const result = await computeCM08('org1', 'hubspot', '2025-08') // last full quarter: Apr-Jun 2025

      expect(result.data.plannedMqls).toBeCloseTo(100, 1)
      expect(result.data.variancePct).toBeCloseTo(-10, 1)
      expect(result.data.quarterStart).toBe('2025-04')
      expect(result.data.quarterPlannedMqls).toBeCloseTo(300, 1)
      expect(result.data.quarterVariancePct).toBeCloseTo(-6.7, 1)
      expect(result.flag).toBeNull()
    })

    it('watch: a month more than 15% below plan', async () => {
      mockedFindOrgById.mockResolvedValue({ settings: plan })
      counts(80, 80, 80, 290)

      const result = await computeCM08('org1', 'hubspot', '2025-08')

      expect(result.data.variancePct).toBeCloseTo(-20, 1)
      expect(result.flag?.level).toBe('watch')
    })

    it('act now: a full quarter more than 25% below plan', async () => {
      mockedFindOrgById.mockResolvedValue({ settings: plan })
      counts(95, 95, 95, 200)

      const result = await computeCM08('org1', 'hubspot', '2025-09') // Sep closes Q3 -> quarter is Jul-Sep 2025

      expect(result.data.quarterStart).toBe('2025-07')
      expect(result.data.quarterVariancePct).toBeCloseTo(-33.3, 1)
      expect(result.flag?.level).toBe('act_now')
    })

    it('no plan comparison for a month the plan does not cover', async () => {
      mockedFindOrgById.mockResolvedValue({ settings: plan })
      counts(10, 10, 10, 300) // last full quarter (Oct-Dec 2025) is still covered -- and on plan

      const result = await computeCM08('org1', 'hubspot', '2026-02')

      expect(result.data.plannedMqls).toBeNull()
      expect(result.data.missingPlanMonths).toEqual(['2026-02'])
      expect(result.flag).toBeNull()
    })
  })
})

describe('CM-05 — Marketing-Sourced Pipeline & Revenue %', () => {
  const stageDefs = [
    { entityType: 'deal', pipeline: 'default', rawStage: 'appointmentscheduled', displayOrder: 1, isClosed: false, isWon: false },
    { entityType: 'deal', pipeline: 'default', rawStage: 'qualifiedtobuy', displayOrder: 2, isClosed: false, isWon: false },
    { entityType: 'deal', pipeline: 'default', rawStage: 'closedwon', displayOrder: 3, isClosed: true, isWon: true },
    { entityType: 'deal', pipeline: 'default', rawStage: 'closedlost', displayOrder: 4, isClosed: true, isWon: false }
  ]
  const contacts = [
    { providerRecordId: 'c1', analyticsSource: 'ORGANIC_SEARCH' }, // marketing
    { providerRecordId: 'c2', analyticsSource: 'DIRECT_TRAFFIC' }, // not marketing
    { providerRecordId: 'c3', analyticsSource: undefined } // unsourced
  ]
  const createdDeals = [
    { pipeline: 'default', dealstage: 'qualifiedtobuy', amount: 1000, contactIds: ['c1'] }, // qualified, marketing
    { pipeline: 'default', dealstage: 'qualifiedtobuy', amount: 2000, contactIds: ['c2'] }, // qualified, not marketing
    { pipeline: 'default', dealstage: 'appointmentscheduled', amount: 500, contactIds: ['c3'] } // intake stage -- excluded
  ]
  const closedDeals = [
    { pipeline: 'default', dealstage: 'closedwon', amount: 3000, contactIds: ['c1'] }, // won, marketing
    { pipeline: 'default', dealstage: 'closedwon', amount: 1500, contactIds: ['c2'] }, // won, not marketing
    { pipeline: 'default', dealstage: 'closedlost', amount: 800, contactIds: ['c1'] } // lost -- excluded
  ]

  beforeEach(() => {
    mockedFindByCreateDateRange.mockReset()
    mockedFindByCloseDateRange.mockReset()
    mockedFindSourcesByProvider.mockReset()
    mockedFindAllStageDefs.mockReset()
    // Only the "current" 12-month window (the first of 3 Promise.all calls) gets real data;
    // the prior/two-ago comparison windows come back empty (0 pipeline/revenue -> null %s).
    mockedFindByCreateDateRange.mockResolvedValueOnce(createdDeals).mockResolvedValue([])
    mockedFindByCloseDateRange.mockResolvedValueOnce(closedDeals).mockResolvedValue([])
    mockedFindSourcesByProvider.mockResolvedValueOnce(contacts).mockResolvedValue([])
    mockedFindAllStageDefs.mockResolvedValueOnce(stageDefs).mockResolvedValue([])
  })

  it('computes marketing-sourced pipeline % and revenue % correctly, excluding unqualified/lost deals', async () => {
    const result = await computeCM05('org1', 'hubspot', '2026-02')

    expect(result.data.totalQualifiedPipeline).toBeCloseTo(3000, 0) // 1000 + 2000, the 500 intake-stage deal excluded
    expect(result.data.marketingQualifiedPipeline).toBeCloseTo(1000, 0)
    expect(result.value).toBeCloseTo(33.3, 1) // 1000/3000

    expect(result.data.totalRevenue).toBeCloseTo(4500, 0) // 3000 + 1500, the 800 lost deal excluded
    expect(result.data.marketingRevenue).toBeCloseTo(3000, 0)
    expect(result.data.revenuePct).toBeCloseTo(66.7, 1) // 3000/4500

    expect(result.data.unsourcedPipelineSharePct).toBeCloseTo(0, 0) // both qualified deals had a resolvable source
  })

  it('watch: marketing-sourced pipeline share below the 30% target', async () => {
    mockedFindByCreateDateRange.mockReset()
    mockedFindByCreateDateRange
      .mockResolvedValueOnce([
        { pipeline: 'default', dealstage: 'qualifiedtobuy', amount: 200, contactIds: ['c1'] }, // marketing
        { pipeline: 'default', dealstage: 'qualifiedtobuy', amount: 800, contactIds: ['c2'] } // not marketing
      ])
      .mockResolvedValue([])

    const result = await computeCM05('org1', 'hubspot', '2026-02') // 200/1000 = 20%, below the 30% target
    expect(result.flag?.level).toBe('watch')
  })

  it('holds the flag back when more than a quarter of qualified pipeline is unsourced', async () => {
    mockedFindByCreateDateRange.mockReset()
    mockedFindByCreateDateRange
      .mockResolvedValueOnce([
        { pipeline: 'default', dealstage: 'qualifiedtobuy', amount: 100, contactIds: ['c1'] }, // marketing, sourced
        { pipeline: 'default', dealstage: 'qualifiedtobuy', amount: 900, contactIds: ['c3'] } // unsourced -- 90% of pipeline
      ])
      .mockResolvedValue([])

    const result = await computeCM05('org1', 'hubspot', '2026-02')
    expect(result.data.dataQualityOk).toBe(false)
    expect(result.flag).toBeNull()
  })

  it('not computable when there is no qualified pipeline at all', async () => {
    mockedFindByCreateDateRange.mockReset()
    mockedFindByCreateDateRange.mockResolvedValue([])
    const result = await computeCM05('org1', 'hubspot', '2026-02')
    expect(result.computable).toBe(false)
  })
})

describe('CM-05 — new business only, qualification from stage history, quarterly windows', () => {
  const stageDefs = [
    { entityType: 'deal', pipeline: 'default', rawStage: 'appointmentscheduled', displayOrder: 1, isClosed: false, isWon: false },
    { entityType: 'deal', pipeline: 'default', rawStage: 'qualifiedtobuy', displayOrder: 2, isClosed: false, isWon: false },
    { entityType: 'deal', pipeline: 'default', rawStage: 'closedwon', displayOrder: 3, isClosed: true, isWon: true },
    { entityType: 'deal', pipeline: 'default', rawStage: 'closedlost', displayOrder: 4, isClosed: true, isWon: false }
  ]
  const history = (...stages: string[]) => stages.map((value) => ({ value, timestamp: new Date('2026-01-15') }))
  const fromMonth = (from: Date) => from.toISOString().slice(0, 7)

  beforeEach(() => {
    for (const mock of [mockedFindByCreateDateRange, mockedFindByCloseDateRange, mockedFindSourcesByProvider, mockedFindAllStageDefs, mockedFindOrgById]) {
      mock.mockReset()
    }
    mockedFindAllStageDefs.mockResolvedValue(stageDefs)
    mockedFindSourcesByProvider.mockResolvedValue([
      { providerRecordId: 'c1', analyticsSource: 'PAID_SEARCH' }, // marketing
      { providerRecordId: 'c2', analyticsSource: 'DIRECT_TRAFFIC' } // not marketing
    ])
    mockedFindByCloseDateRange.mockResolvedValue([])
    mockedFindOrgById.mockResolvedValue({ settings: {} })
  })

  it('counts deals that passed qualification even if since won or lost, and skips non-new-business deals', async () => {
    mockedFindByCreateDateRange.mockImplementation(async (_org: string, _provider: string, from: Date) =>
      fromMonth(from) === '2026-01'
        ? [
            { pipeline: 'default', dealstage: 'closedwon', amount: 1000, type: 'newbusiness', contactIds: ['c1'] }, // won -- counts
            {
              pipeline: 'default',
              dealstage: 'closedlost',
              amount: 2000,
              type: 'newbusiness',
              contactIds: ['c2'],
              dealStageHistory: history('appointmentscheduled', 'qualifiedtobuy', 'closedlost') // qualified, then lost -- counts
            },
            {
              pipeline: 'default',
              dealstage: 'closedlost',
              amount: 700,
              type: 'newbusiness',
              contactIds: ['c1'],
              dealStageHistory: history('appointmentscheduled', 'closedlost') // lost before qualifying -- excluded
            },
            { pipeline: 'default', dealstage: 'qualifiedtobuy', amount: 5000, type: 'existingbusiness', contactIds: ['c1'] } // not new business
          ]
        : []
    )

    const result = await computeCM05('org1', 'hubspot', '2026-02')

    expect(result.period).toBe('2026-01') // the quarter, Jan-Mar 2026
    expect(result.data.totalQualifiedPipeline).toBeCloseTo(3000, 0)
    expect(result.data.marketingQualifiedPipeline).toBeCloseTo(1000, 0)
    expect(result.data.attributionModel).toBe('first-touch')
    // Pipeline window is the quarter itself; revenue window the trailing 12 months to its end.
    expect(fromMonth(mockedFindByCreateDateRange.mock.calls[0][2])).toBe('2026-01')
    expect(fromMonth(mockedFindByCloseDateRange.mock.calls[0][2])).toBe('2025-04')
  })

  it('excludes non-new-business deals from closed revenue', async () => {
    mockedFindByCreateDateRange.mockImplementation(async (_org: string, _provider: string, from: Date) =>
      fromMonth(from) === '2026-01' ? [{ pipeline: 'default', dealstage: 'qualifiedtobuy', amount: 100, type: 'newbusiness', contactIds: ['c1'] }] : []
    )
    mockedFindByCloseDateRange.mockImplementation(async (_org: string, _provider: string, from: Date) =>
      fromMonth(from) === '2025-04'
        ? [
            { pipeline: 'default', dealstage: 'closedwon', amount: 3000, type: 'newbusiness', contactIds: ['c1'] },
            { pipeline: 'default', dealstage: 'closedwon', amount: 9000, type: 'existingbusiness', contactIds: ['c1'] }
          ]
        : []
    )

    const result = await computeCM05('org1', 'hubspot', '2026-02')

    expect(result.data.totalRevenue).toBeCloseTo(3000, 0)
    expect(result.data.revenuePct).toBeCloseTo(100, 0)
  })

  it('act now: the share is falling while pipeline coverage (CM-04) is below target', async () => {
    const deal = (amount: number, contact: string) => ({ pipeline: 'default', dealstage: 'qualifiedtobuy', amount, type: 'newbusiness', contactIds: [contact] })
    mockedFindByCreateDateRange.mockImplementation(async (_org: string, _provider: string, from: Date) => {
      if (fromMonth(from) === '2026-01') return [deal(1000, 'c1'), deal(3000, 'c2')] // 25% this quarter
      if (fromMonth(from) === '2025-10') return [deal(3000, 'c1'), deal(1000, 'c2')] // 75% last quarter
      return []
    })
    // CM-04: one small open deal against a target covering every month -- coverage far below 2.0x.
    mockedFindByCloseDateRange.mockResolvedValue([deal(100, 'c1')])
    mockedFindOrgById.mockResolvedValue({ settings: { cm04Targets: [{ fromMonth: '2000-01', toMonth: '2099-12', targetAmount: 1e9 }] } })

    const result = await computeCM05('org1', 'hubspot', '2026-02')

    expect(result.value).toBeCloseTo(25, 1)
    expect(result.flag?.level).toBe('act_now')
    expect(result.flag?.reason).toContain('CM-04')
  })

  it('stays watch when the share is falling but coverage has no target', async () => {
    const deal = (amount: number, contact: string) => ({ pipeline: 'default', dealstage: 'qualifiedtobuy', amount, type: 'newbusiness', contactIds: [contact] })
    mockedFindByCreateDateRange.mockImplementation(async (_org: string, _provider: string, from: Date) => {
      if (fromMonth(from) === '2026-01') return [deal(1000, 'c1'), deal(3000, 'c2')] // 25%
      if (fromMonth(from) === '2025-10') return [deal(3000, 'c1'), deal(1000, 'c2')] // 75%
      return []
    })

    const result = await computeCM05('org1', 'hubspot', '2026-02')

    expect(result.flag?.level).toBe('watch') // below the 30% target, CM-04 not computable
  })
})

describe('CM-05 (Salesforce) — Marketing-Sourced Pipeline & Revenue %, Campaign-attributed (G-23)', () => {
  const salesforceStageDefs = [
    { entityType: 'deal', pipeline: 'opportunities-default', rawStage: 'Prospecting', displayOrder: 1, isClosed: false, isWon: false },
    { entityType: 'deal', pipeline: 'opportunities-default', rawStage: 'Qualification', displayOrder: 2, isClosed: false, isWon: false },
    { entityType: 'deal', pipeline: 'opportunities-default', rawStage: 'Closed Won', displayOrder: 3, isClosed: true, isWon: true },
    { entityType: 'deal', pipeline: 'opportunities-default', rawStage: 'Closed Lost', displayOrder: 4, isClosed: true, isWon: false }
  ]
  const createdDeals = [
    { pipeline: 'opportunities-default', dealstage: 'Qualification', amount: 1000, campaignId: 'camp1' }, // qualified, campaign-attributed
    { pipeline: 'opportunities-default', dealstage: 'Qualification', amount: 2000, campaignId: undefined }, // qualified, no campaign
    { pipeline: 'opportunities-default', dealstage: 'Prospecting', amount: 500, campaignId: 'camp1' } // intake stage -- excluded
  ]
  const closedDeals = [
    { pipeline: 'opportunities-default', dealstage: 'Closed Won', amount: 3000, campaignId: 'camp1' }, // won, campaign-attributed
    { pipeline: 'opportunities-default', dealstage: 'Closed Won', amount: 1500, campaignId: undefined }, // won, no campaign
    { pipeline: 'opportunities-default', dealstage: 'Closed Lost', amount: 800, campaignId: 'camp1' } // lost -- excluded
  ]

  beforeEach(() => {
    mockedFindByCreateDateRange.mockReset()
    mockedFindByCloseDateRange.mockReset()
    mockedFindAllStageDefs.mockReset()
    mockedFindAllCampaigns.mockReset()
    mockedFindByCreateDateRange.mockResolvedValueOnce(createdDeals).mockResolvedValue([])
    mockedFindByCloseDateRange.mockResolvedValueOnce(closedDeals).mockResolvedValue([])
    mockedFindAllStageDefs.mockResolvedValueOnce(salesforceStageDefs).mockResolvedValue([])
    mockedFindAllCampaigns.mockResolvedValueOnce([{ providerRecordId: 'camp1', name: 'Spring Webinar Series' }]).mockResolvedValue([])
  })

  it('computes marketing-sourced pipeline % and revenue % from Opportunity.CampaignId, excluding unqualified/lost deals', async () => {
    const result = await computeCM05('org1', 'salesforce', '2026-02')

    expect(result.data.totalQualifiedPipeline).toBeCloseTo(3000, 0) // 1000 + 2000, the 500 intake-stage deal excluded
    expect(result.data.marketingQualifiedPipeline).toBeCloseTo(1000, 0)
    expect(result.value).toBeCloseTo(33.3, 1) // 1000/3000

    expect(result.data.totalRevenue).toBeCloseTo(4500, 0) // 3000 + 1500, the 800 lost deal excluded
    expect(result.data.marketingRevenue).toBeCloseTo(3000, 0)
    expect(result.data.revenuePct).toBeCloseTo(66.7, 1) // 3000/4500
  })

  it('resolves campaign names into a topCampaigns breakdown', async () => {
    const result = await computeCM05('org1', 'salesforce', '2026-02')
    expect(result.data.topCampaigns).toEqual([
      { label: 'Spring Webinar Series', pipeline: 1000, revenue: 3000, dealCount: 1 }
    ])
  })

  it('falls back to the raw campaign id when the campaign was never synced (e.g. restricted Campaign access)', async () => {
    mockedFindAllCampaigns.mockReset()
    mockedFindAllCampaigns.mockResolvedValue([])
    const result = await computeCM05('org1', 'salesforce', '2026-02')
    expect((result.data.topCampaigns as { label: string }[])[0].label).toBe('camp1')
  })

  it('not computable when there is no qualified pipeline at all', async () => {
    mockedFindByCreateDateRange.mockReset()
    mockedFindByCreateDateRange.mockResolvedValue([])
    const result = await computeCM05('org1', 'salesforce', '2026-02')
    expect(result.computable).toBe(false)
  })

  it('defaults to hubspot when no provider is passed', async () => {
    mockedFindSourcesByProvider.mockReset()
    mockedFindSourcesByProvider.mockResolvedValue([])
    mockedFindByCreateDateRange.mockReset()
    mockedFindByCreateDateRange.mockResolvedValue([])
    const result = await computeCM05('org1')
    // Falls through to the HubSpot path (findSourcesByProvider), not the Salesforce one (findAllCampaigns).
    expect(mockedFindSourcesByProvider).toHaveBeenCalled()
    expect(result.computable).toBe(false)
  })
})

describe('CM-07 — Marketing ROI by Channel (blended only)', () => {
  function pl(income: Record<string, number>, expenses: Record<string, number>) {
    return {
      columns: ['Total'],
      income: Object.entries(income).map(([account, amount]) => ({ account, amounts: { Total: amount } })),
      cogs: [],
      // QuickBooks account ids are the account names here, so a test picks accounts by name.
      expenses: Object.entries(expenses).map(([account, amount]) => ({ account, accountId: account, amounts: { Total: amount } })),
      otherExpenses: [],
      sectionTotals: {},
      startDate: '2026-01-01',
      endDate: '2026-03-31'
    }
  }

  beforeEach(() => {
    mockedGetStoredPL.mockReset()
    mockedFindByCreateDateRange.mockReset()
    mockedFindByCloseDateRange.mockReset()
    mockedFindSourcesByProvider.mockReset()
    mockedFindAllStageDefs.mockReset()
    mockedFindOrgById.mockReset()
    mockedFindByCreateDateRange.mockResolvedValue([])
    mockedFindByCloseDateRange.mockResolvedValue([])
    mockedFindSourcesByProvider.mockResolvedValue([])
    mockedFindAllStageDefs.mockResolvedValue([])
    mockedFindOrgById.mockResolvedValue({ settings: { marketingSpendAccountIds: ['Sales & Marketing - Advertising'] } })
  })

  it('computes blended pipeline ROI from marketing-sourced pipeline / marketing spend', async () => {
    // CM-05's current-quarter pipeline: one $10,000 qualified deal from an organic-search contact.
    mockedFindAllStageDefs.mockResolvedValueOnce([
      { entityType: 'deal', pipeline: 'default', rawStage: 'intake', displayOrder: 1, isClosed: false, isWon: false },
      { entityType: 'deal', pipeline: 'default', rawStage: 'qualified', displayOrder: 2, isClosed: false, isWon: false }
    ])
    mockedFindSourcesByProvider.mockResolvedValueOnce([{ providerRecordId: 'c1', analyticsSource: 'ORGANIC_SEARCH' }])
    mockedFindByCreateDateRange.mockResolvedValueOnce([{ pipeline: 'default', dealstage: 'qualified', amount: 10000, contactIds: ['c1'] }])

    mockedGetStoredPL.mockResolvedValue(pl({ Rev: 20000 }, { 'Sales & Marketing - Advertising': 2000 }))

    const result = await computeCM07('org1', '2026-02')
    expect(result.data.marketingSourcedPipeline).toBeCloseTo(10000, 0)
    expect(result.data.marketingSpend).toBeCloseTo(2000, 0)
    expect(result.value).toBeCloseTo(5, 1) // 10000 / 2000 = 5x
  })

  it('not computable when no P&L snapshot exists for the quarter', async () => {
    mockedGetStoredPL.mockResolvedValue(null)
    const result = await computeCM07('org1', '2026-02')
    expect(result.computable).toBe(false)
  })

  it('flags "declining two quarters running" only on a genuine two-quarter losing streak', async () => {
    mockedFindAllStageDefs.mockResolvedValue([
      { entityType: 'deal', pipeline: 'default', rawStage: 'intake', displayOrder: 1, isClosed: false, isWon: false },
      { entityType: 'deal', pipeline: 'default', rawStage: 'qualified', displayOrder: 2, isClosed: false, isWon: false }
    ])
    mockedFindSourcesByProvider.mockResolvedValue([{ providerRecordId: 'c1', analyticsSource: 'ORGANIC_SEARCH' }])
    // Same $10,000 qualified pipeline every quarter — only marketing spend moves, so ROI tracks 1/spend.
    mockedFindByCreateDateRange.mockResolvedValue([{ pipeline: 'default', dealstage: 'qualified', amount: 10000, contactIds: ['c1'] }])

    // ROI: two-ago 10x -> prev 8x -> current 6x. Falling both steps, both still above the 5x target,
    // so this isolates the "declining" branch from "belowTarget".
    mockedGetStoredPL
      .mockResolvedValueOnce(pl({ Rev: 20000 }, { 'Sales & Marketing - Advertising': 10000 / 6 })) // current
      .mockResolvedValueOnce(pl({ Rev: 20000 }, { 'Sales & Marketing - Advertising': 10000 / 8 })) // prev
      .mockResolvedValueOnce(pl({ Rev: 20000 }, { 'Sales & Marketing - Advertising': 10000 / 10 })) // two-ago

    const result = await computeCM07('org1', '2026-02')
    expect(result.value).toBeCloseTo(6, 1)
    expect(result.flag?.level).toBe('watch')
    expect(result.flag?.reason).toContain('fallen two quarters running')
    expect(result.flag?.reason).toContain('10.00x')
    expect(result.flag?.reason).toContain('8.00x')
    expect(result.flag?.reason).toContain('6.00x')
  })

  it('does not flag a single-quarter dip after a rise as "declining"', async () => {
    mockedFindAllStageDefs.mockResolvedValue([
      { entityType: 'deal', pipeline: 'default', rawStage: 'intake', displayOrder: 1, isClosed: false, isWon: false },
      { entityType: 'deal', pipeline: 'default', rawStage: 'qualified', displayOrder: 2, isClosed: false, isWon: false }
    ])
    mockedFindSourcesByProvider.mockResolvedValue([{ providerRecordId: 'c1', analyticsSource: 'ORGANIC_SEARCH' }])
    mockedFindByCreateDateRange.mockResolvedValue([{ pipeline: 'default', dealstage: 'qualified', amount: 10000, contactIds: ['c1'] }])

    // ROI: two-ago 6x -> prev 12x (rose) -> current 11x (small dip, but still above two-ago and above 5x target).
    mockedGetStoredPL
      .mockResolvedValueOnce(pl({ Rev: 20000 }, { 'Sales & Marketing - Advertising': 10000 / 11 })) // current
      .mockResolvedValueOnce(pl({ Rev: 20000 }, { 'Sales & Marketing - Advertising': 10000 / 12 })) // prev
      .mockResolvedValueOnce(pl({ Rev: 20000 }, { 'Sales & Marketing - Advertising': 10000 / 6 })) // two-ago

    const result = await computeCM07('org1', '2026-02')
    expect(result.value).toBeCloseTo(11, 1)
    expect(result.flag).toBeNull()
  })

  it('counts only the picked marketing accounts as spend, not sales accounts', async () => {
    mockedFindAllStageDefs.mockResolvedValue([
      { entityType: 'deal', pipeline: 'default', rawStage: 'intake', displayOrder: 1, isClosed: false, isWon: false },
      { entityType: 'deal', pipeline: 'default', rawStage: 'qualified', displayOrder: 2, isClosed: false, isWon: false }
    ])
    mockedFindSourcesByProvider.mockResolvedValue([{ providerRecordId: 'c1', analyticsSource: 'ORGANIC_SEARCH' }])
    mockedFindByCreateDateRange.mockResolvedValue([{ pipeline: 'default', dealstage: 'qualified', amount: 10000, contactIds: ['c1'] }])
    mockedGetStoredPL.mockResolvedValue(pl({ Rev: 20000 }, { 'Sales & Marketing - Advertising': 2000, 'Sales & Marketing - Sales Salaries': 8000 }))

    const result = await computeCM07('org1', '2026-02')

    expect(result.data.marketingSpend).toBeCloseTo(2000, 0) // the 8,000 of sales salaries is not marketing spend
    expect(result.value).toBeCloseTo(5, 1)
  })

  it('not computable until marketing accounts are picked in Settings', async () => {
    mockedFindOrgById.mockResolvedValue({ settings: {} })
    mockedGetStoredPL.mockResolvedValue(pl({ Rev: 20000 }, { 'Sales & Marketing - Advertising': 2000 }))

    const result = await computeCM07('org1', '2026-02')

    expect(result.computable).toBe(false)
    expect(result.data.blockedOn).toBe('marketing-spend-accounts')
  })

  it('profit ROI uses revenue closed in the same quarter as the spend, not the trailing twelve months', async () => {
    mockedFindAllStageDefs.mockResolvedValue([
      { entityType: 'deal', pipeline: 'default', rawStage: 'intake', displayOrder: 1, isClosed: false, isWon: false },
      { entityType: 'deal', pipeline: 'default', rawStage: 'qualified', displayOrder: 2, isClosed: false, isWon: false },
      { entityType: 'deal', pipeline: 'default', rawStage: 'won', displayOrder: 3, isClosed: true, isWon: true }
    ])
    mockedFindSourcesByProvider.mockResolvedValue([{ providerRecordId: 'c1', analyticsSource: 'ORGANIC_SEARCH' }])
    mockedFindByCreateDateRange.mockResolvedValue([{ pipeline: 'default', dealstage: 'qualified', amount: 10000, contactIds: ['c1'] }])
    mockedFindByCloseDateRange.mockResolvedValue([
      { pipeline: 'default', dealstage: 'won', amount: 3000, contactIds: ['c1'], closedate: new Date('2026-02-10T00:00:00Z') }, // in Jan-Mar 2026
      { pipeline: 'default', dealstage: 'won', amount: 9000, contactIds: ['c1'], closedate: new Date('2025-08-10T00:00:00Z') } // earlier in the TTM
    ])
    mockedGetStoredPL.mockResolvedValue(pl({ Rev: 20000 }, { 'Sales & Marketing - Advertising': 2000 })) // no COGS -> 100% gross margin

    const result = await computeCM07('org1', '2026-02')

    expect(result.data.marketingSourcedRevenue).toBeCloseTo(3000, 0)
    expect(result.data.profitRoi).toBeCloseTo(1.5, 2) // 3,000 x 100% / 2,000
  })
})

describe('CM-03 — Competitive Win Rate (vs. Named Competitors)', () => {
  const salesforceStageDefs = [
    { entityType: 'deal', pipeline: 'opportunities-default', rawStage: 'Negotiation', displayOrder: 2, isClosed: false, isWon: false },
    { entityType: 'deal', pipeline: 'opportunities-default', rawStage: 'Closed Won', displayOrder: 3, isClosed: true, isWon: true },
    { entityType: 'deal', pipeline: 'opportunities-default', rawStage: 'Closed Lost', displayOrder: 4, isClosed: true, isWon: false }
  ]

  function closedDeal(stage: 'Closed Won' | 'Closed Lost', competitor?: string) {
    return { pipeline: 'opportunities-default', dealstage: stage, competitor }
  }

  function many(n: number, stage: 'Closed Won' | 'Closed Lost', competitor?: string) {
    return Array.from({ length: n }, () => closedDeal(stage, competitor))
  }

  beforeEach(() => {
    mockedFindByCloseDateRange.mockReset()
    mockedFindAllStageDefs.mockReset()
    mockedFindOrgById.mockReset()
    mockedFindOrgById.mockResolvedValue({ settings: { salesforceCompetitorSource: 'field', salesforceCompetitorField: 'Competitor__c' } })
    mockedFindAllStageDefs.mockResolvedValue(salesforceStageDefs)
  })

  it('not computable when the org has no competitor field configured', async () => {
    mockedFindOrgById.mockResolvedValue({ settings: {} })
    const result = await computeCM03('org1', '2026-02')
    expect(result.computable).toBe(false)
    expect(result.data.configured).toBe(false)
  })

  it('not computable when there are no closed deals in the window', async () => {
    mockedFindByCloseDateRange.mockResolvedValue([])
    const result = await computeCM03('org1', '2026-02')
    expect(result.computable).toBe(false)
    expect(result.data.configured).toBe(true)
  })

  it('computes blended win rate and per-competitor breakdown, excluding deals with no competitor recorded', async () => {
    mockedFindByCloseDateRange
      .mockResolvedValueOnce([
        ...many(3, 'Closed Won', 'Acme'),
        ...many(1, 'Closed Lost', 'Acme'), // Acme: 3W/1L = 75%
        ...many(1, 'Closed Won', 'Globex'),
        ...many(1, 'Closed Lost', 'Globex'), // Globex: 1W/1L = 50%
        ...many(1, 'Closed Won') // no competitor recorded -- counts toward decidedTotal only
      ])
      .mockResolvedValueOnce([]) // prior window

    const result = await computeCM03('org1', '2026-02')

    expect(result.computable).toBe(true)
    expect(result.data.decidedDealsCurrent).toBe(7)
    expect(result.data.decidedDealsWithCompetitorCurrent).toBe(6)
    expect(result.data.recordedSharePct).toBeCloseTo(85.7, 1) // 6/7
    expect(result.value).toBeCloseTo(66.7, 1) // (3+1)/6 blended

    const competitors = result.data.competitors as any[]
    const acme = competitors.find((c) => c.competitor === 'Acme')
    const globex = competitors.find((c) => c.competitor === 'Globex')
    expect(acme.winRatePct).toBeCloseTo(75, 1)
    expect(globex.winRatePct).toBeCloseTo(50, 1)
  })

  it('act-now: a competitor win rate drops >=10 points with >=10 decided deals in each window, landing below the 30% floor', async () => {
    mockedFindByCloseDateRange
      .mockResolvedValueOnce([...many(2, 'Closed Won', 'Acme'), ...many(8, 'Closed Lost', 'Acme')]) // current: 2W/8L = 20%
      .mockResolvedValueOnce([...many(8, 'Closed Won', 'Acme'), ...many(2, 'Closed Lost', 'Acme')]) // prior: 8W/2L = 80%

    const result = await computeCM03('org1', '2026-02')
    expect(result.flag?.level).toBe('act_now')
    expect(result.flag?.reason).toContain('Acme')
  })

  it('watch (not act-now) when the drop stays at or above the 30% floor', async () => {
    mockedFindByCloseDateRange
      .mockResolvedValueOnce([...many(4, 'Closed Won', 'Acme'), ...many(6, 'Closed Lost', 'Acme')]) // current: 40%
      .mockResolvedValueOnce([...many(9, 'Closed Won', 'Acme'), ...many(1, 'Closed Lost', 'Acme')]) // prior: 90%

    const result = await computeCM03('org1', '2026-02')
    expect(result.flag?.level).toBe('watch')
  })

  it('holds the flag back when fewer than a quarter of decided deals have a competitor recorded', async () => {
    mockedFindByCloseDateRange
      .mockResolvedValueOnce([
        ...many(2, 'Closed Won', 'Acme'),
        ...many(8, 'Closed Lost', 'Acme'), // 10 decided, all with a competitor -- would otherwise flag
        ...many(31, 'Closed Won') // 31 more decided deals with no competitor recorded -- 10/41 = 24.4% recorded
      ])
      .mockResolvedValueOnce([...many(8, 'Closed Won', 'Acme'), ...many(2, 'Closed Lost', 'Acme')])

    const result = await computeCM03('org1', '2026-02')
    expect(result.data.dataQualityOk).toBe(false)
    expect(result.flag).toBeNull()
  })

  function closedDealMulti(stage: 'Closed Won' | 'Closed Lost', competitors: string[]) {
    return { pipeline: 'opportunities-default', dealstage: stage, competitors }
  }

  it('junction mode: computable without any field name configured, and a multi-competitor deal credits every named competitor', async () => {
    mockedFindOrgById.mockResolvedValue({ settings: { salesforceCompetitorSource: 'junction' } })
    mockedFindByCloseDateRange
      .mockResolvedValueOnce([
        closedDealMulti('Closed Won', ['Acme', 'Globex']), // one deal naming both -- credits a win to each
        ...many(9, 'Closed Won', 'Acme'), // pad Acme to 10 decided (all wins)
        ...many(9, 'Closed Lost', 'Globex') // pad Globex to 10 decided (mostly losses)
      ])
      .mockResolvedValueOnce([])

    const result = await computeCM03('org1', '2026-02')
    expect(result.computable).toBe(true)
    expect(result.data.configured).toBe(true)
    expect(result.data.competitorSource).toBe('junction')

    const competitors = result.data.competitors as any[]
    const acme = competitors.find((c) => c.competitor === 'Acme')
    const globex = competitors.find((c) => c.competitor === 'Globex')
    expect(acme.wins).toBe(10)
    expect(acme.decided).toBe(10)
    expect(globex.wins).toBe(1)
    expect(globex.losses).toBe(9)
    expect(globex.decided).toBe(10)
  })

  it('field mode is not configured when the source is "field" but no field name was saved', async () => {
    mockedFindOrgById.mockResolvedValue({ settings: { salesforceCompetitorSource: 'field' } })
    const result = await computeCM03('org1', '2026-02')
    expect(result.computable).toBe(false)
    expect(result.data.configured).toBe(false)
  })

  it('does not flag a competitor with fewer than 10 decided deals in either window', async () => {
    mockedFindByCloseDateRange
      .mockResolvedValueOnce([...many(1, 'Closed Won', 'Acme'), ...many(4, 'Closed Lost', 'Acme')]) // only 5 decided -- below the eligibility floor
      .mockResolvedValueOnce([...many(9, 'Closed Won', 'Acme'), ...many(1, 'Closed Lost', 'Acme')])

    const result = await computeCM03('org1', '2026-02')
    expect(result.flag).toBeNull()
  })
})
