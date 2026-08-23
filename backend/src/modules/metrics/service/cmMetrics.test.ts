import { invoiceRepository } from '../../sync/repository/invoice.repository'
import { quickBooksCustomerRepository } from '../../sync/repository/quickBooksCustomer.repository'
import { dealRepository } from '../../sync/repository/deal.repository'
import { contactRepository } from '../../sync/repository/contact.repository'
import { pipelineStageDefinitionRepository } from '../../sync/repository/pipelineStageDefinition.repository'
import { funnelStageEventRepository } from '../../sync/repository/funnelStageEvent.repository'
import { organizationsRepository } from '../../organizations/repository/organizations.repository'
import { getStoredProfitAndLoss } from './plReport.service'
import { computeCM02, computeCM03, computeCM04, computeCM05, computeCM06, computeCM07, computeCM08 } from './cmMetrics.service'

jest.mock('../../sync/repository/invoice.repository')
jest.mock('../../sync/repository/quickBooksCustomer.repository')
jest.mock('../../sync/repository/deal.repository')
jest.mock('../../sync/repository/contact.repository')
jest.mock('../../sync/repository/pipelineStageDefinition.repository')
jest.mock('../../sync/repository/funnelStageEvent.repository')
jest.mock('../../organizations/repository/organizations.repository')
jest.mock('./plReport.service')

const mockedGetMonthlyRevenue = invoiceRepository.getMonthlyRevenueByCustomer as jest.Mock
const mockedFindAllCustomers = quickBooksCustomerRepository.findAll as jest.Mock
const mockedFindByCloseDateRange = dealRepository.findByCloseDateRange as jest.Mock
const mockedFindByCreateDateRange = dealRepository.findByCreateDateRange as jest.Mock
const mockedFindSourcesByProvider = contactRepository.findSourcesByProvider as jest.Mock
const mockedFindAllStageDefs = pipelineStageDefinitionRepository.findAllForOrg as jest.Mock
const mockedGetCohortRecordIds = funnelStageEventRepository.getCohortRecordIds as jest.Mock
const mockedGetStageMembershipCounts = funnelStageEventRepository.getStageMembershipCounts as jest.Mock
const mockedCountRecordsEnteringStage = funnelStageEventRepository.countRecordsEnteringStage as jest.Mock
const mockedGetStoredPL = getStoredProfitAndLoss as jest.Mock
const mockedFindOrgById = organizationsRepository.findById as jest.Mock

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

describe('CM-04 — Pipeline Coverage Ratio (always not-computable in MVP — no operating-plan target)', () => {
  beforeEach(() => {
    mockedFindByCloseDateRange.mockReset()
    mockedFindAllStageDefs.mockReset()
  })

  it('sums only deals in a qualified (non-intake, non-closed) stage', async () => {
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

    const result = await computeCM04('org1', 'hubspot', '2026-02')

    expect(result.computable).toBe(false) // no operating-plan target exists in MVP
    expect(result.value).toBeNull()
    expect(result.data.qualifiedPipelineAmount).toBeCloseTo(5000, 0)
    expect(result.data.qualifiedDealCount).toBe(1)
  })
})

describe('CM-06 — Funnel Conversion Rates (cohort-based)', () => {
  beforeEach(() => {
    mockedGetCohortRecordIds.mockReset()
    mockedGetStageMembershipCounts.mockReset()
  })

  function stageCounts(lead: number, mql: number, sql: number, won: number) {
    return [
      { pipeline: 'contacts-default', rawStage: 'lead', count: lead },
      { pipeline: 'contacts-default', rawStage: 'marketingqualifiedlead', count: mql },
      { pipeline: 'contacts-default', rawStage: 'salesqualifiedlead', count: sql },
      { pipeline: 'contacts-default', rawStage: 'customer', count: won }
    ]
  }

  it('computes the three transition rates but holds back the flag when the cohort is too small', async () => {
    // Current cohort, then a uniform trailing-4-month baseline (values don't matter here since
    // cohortSizeSufficient is false and the flag block never runs).
    mockedGetCohortRecordIds.mockResolvedValueOnce(Array(10).fill('c')).mockResolvedValue(Array(10).fill('c'))
    mockedGetStageMembershipCounts.mockResolvedValueOnce(stageCounts(10, 5, 2, 1)).mockResolvedValue(stageCounts(10, 8, 6, 3))

    const result = await computeCM06('org1', 'hubspot', '2026-02')

    expect(result.value).toBeCloseTo(40, 0) // MQL->SQL = 2/5
    expect(result.data.cohortSizeSufficient).toBe(false) // 10 leads < 100 minimum
    expect(result.flag).toBeNull() // held back despite a real decline (metrics guide: alerts held back below min cohort size)
  })

  it('act_now: MQL->SQL falls below half its trailing 4-month average, with a sufficient cohort', async () => {
    // Current cohort, then a uniform trailing-4-month baseline (all 4 identical -> average = 60%).
    mockedGetCohortRecordIds.mockResolvedValueOnce(Array(150).fill('c')).mockResolvedValue(Array(150).fill('c'))
    mockedGetStageMembershipCounts
      .mockResolvedValueOnce(stageCounts(150, 60, 6, 2)) // current: MQL->SQL = 10%
      .mockResolvedValue(stageCounts(150, 60, 36, 10)) // each trailing month: MQL->SQL = 60%

    const result = await computeCM06('org1', 'hubspot', '2026-02')
    expect(result.data.cohortSizeSufficient).toBe(true)
    expect(result.data.trailingAvgMqlToSqlPct).toBeCloseTo(60, 0)
    expect(result.flag?.level).toBe('act_now') // 10% < half of 60%
  })

  it('does not false-fire on a single unusually-strong prior month once smoothed into the trailing 4-month average', async () => {
    mockedGetCohortRecordIds.mockResolvedValue(Array(150).fill('c')) // uniform across current + all 4 trailing calls
    mockedGetStageMembershipCounts
      .mockResolvedValueOnce(stageCounts(150, 100, 50, 10)) // current: MQL->SQL = 50%
      .mockResolvedValueOnce(stageCounts(150, 100, 80, 10)) // month -1: 80% -- an unusual spike
      .mockResolvedValueOnce(stageCounts(150, 100, 50, 10)) // month -2: 50%
      .mockResolvedValueOnce(stageCounts(150, 100, 48, 10)) // month -3: 48%
      .mockResolvedValueOnce(stageCounts(150, 100, 52, 10)) // month -4: 52%
    // Trailing average = (80+50+48+52)/4 = 57.5%.

    const result = await computeCM06('org1', 'hubspot', '2026-02')
    expect(result.data.trailingAvgMqlToSqlPct).toBeCloseTo(57.5, 1)
    // Old logic (vs. just month -1's 80% spike) would have false-fired: 50 < 80*0.8=64 -> true.
    // New logic (vs. the smoothed 57.5% average) correctly does not: 50 < 57.5*0.8=46 -> false.
    expect(result.flag).toBeNull()
  })

  it('not computable when the cohort is empty', async () => {
    mockedGetCohortRecordIds.mockResolvedValue([]) // both the current- and previous-cohort calls
    const result = await computeCM06('org1', 'hubspot', '2026-02')
    expect(result.computable).toBe(false)
  })
})

describe('CM-08 — Lead Volume vs. Plan (MQL Flow)', () => {
  beforeEach(() => {
    mockedCountRecordsEnteringStage.mockReset()
    mockedGetCohortRecordIds.mockReset()
    mockedGetStageMembershipCounts.mockReset()
  })

  it('watch: MQL volume declined two months running, while CM-06 is not (also) deteriorating', async () => {
    mockedCountRecordsEnteringStage
      .mockResolvedValueOnce(80) // this month
      .mockResolvedValueOnce(100) // last month
      .mockResolvedValueOnce(120) // two months ago
    // CM-06's internal cross-check comes back empty -> not computable -> no flag.
    mockedGetCohortRecordIds.mockResolvedValue([])

    const result = await computeCM08('org1', 'hubspot', '2026-02')
    expect(result.value).toBe(80)
    expect(result.data.growthPct).toBeCloseTo(-20, 0)
    expect(result.flag?.level).toBe('watch')
  })

  it('act_now: MQL volume declining two months running AND CM-06 is also deteriorating', async () => {
    mockedCountRecordsEnteringStage.mockResolvedValueOnce(80).mockResolvedValueOnce(100).mockResolvedValueOnce(120)
    // Current cohort, then a uniform trailing-4-month baseline for CM-06's internal cross-check.
    mockedGetCohortRecordIds.mockResolvedValueOnce(Array(150).fill('c')).mockResolvedValue(Array(150).fill('c'))
    mockedGetStageMembershipCounts
      .mockResolvedValueOnce([
        { pipeline: 'contacts-default', rawStage: 'lead', count: 150 },
        { pipeline: 'contacts-default', rawStage: 'marketingqualifiedlead', count: 60 },
        { pipeline: 'contacts-default', rawStage: 'salesqualifiedlead', count: 6 }
      ])
      .mockResolvedValue([
        { pipeline: 'contacts-default', rawStage: 'lead', count: 150 },
        { pipeline: 'contacts-default', rawStage: 'marketingqualifiedlead', count: 60 },
        { pipeline: 'contacts-default', rawStage: 'salesqualifiedlead', count: 36 }
      ])

    const result = await computeCM08('org1', 'hubspot', '2026-02')
    expect(result.flag?.level).toBe('act_now')
  })

  it('no flag when MQL volume is not declining', async () => {
    mockedCountRecordsEnteringStage.mockResolvedValueOnce(120).mockResolvedValueOnce(100).mockResolvedValueOnce(80)
    const result = await computeCM08('org1', 'hubspot', '2026-02')
    expect(result.data.growthPct).toBeCloseTo(20, 0)
    expect(result.flag).toBeNull()
  })

  it('act_now: a single-month MQL fall (not two months running) still escalates when CM-06 is also deteriorating', async () => {
    // current 80 < previous 100, but previous 100 is NOT < two-ago 90 -> not a two-month streak.
    mockedCountRecordsEnteringStage.mockResolvedValueOnce(80).mockResolvedValueOnce(100).mockResolvedValueOnce(90)
    mockedGetCohortRecordIds.mockResolvedValueOnce(Array(150).fill('c')).mockResolvedValue(Array(150).fill('c'))
    mockedGetStageMembershipCounts
      .mockResolvedValueOnce([
        { pipeline: 'contacts-default', rawStage: 'lead', count: 150 },
        { pipeline: 'contacts-default', rawStage: 'marketingqualifiedlead', count: 60 },
        { pipeline: 'contacts-default', rawStage: 'salesqualifiedlead', count: 6 }
      ])
      .mockResolvedValue([
        { pipeline: 'contacts-default', rawStage: 'lead', count: 150 },
        { pipeline: 'contacts-default', rawStage: 'marketingqualifiedlead', count: 60 },
        { pipeline: 'contacts-default', rawStage: 'salesqualifiedlead', count: 36 }
      ])

    const result = await computeCM08('org1', 'hubspot', '2026-02')
    expect(result.flag?.level).toBe('act_now')
    expect(result.flag?.reason).not.toContain('two months running')
  })

  it('no flag on a single-month MQL fall when CM-06 is not (also) deteriorating', async () => {
    mockedCountRecordsEnteringStage.mockResolvedValueOnce(80).mockResolvedValueOnce(100).mockResolvedValueOnce(90)
    mockedGetCohortRecordIds.mockResolvedValue([])

    const result = await computeCM08('org1', 'hubspot', '2026-02')
    expect(result.flag).toBeNull()
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
    const result = await computeCM05('org1', '2026-02')

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

    const result = await computeCM05('org1', '2026-02') // 200/1000 = 20%, below the 30% target
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

    const result = await computeCM05('org1', '2026-02')
    expect(result.data.dataQualityOk).toBe(false)
    expect(result.flag).toBeNull()
  })

  it('not computable when there is no qualified pipeline at all', async () => {
    mockedFindByCreateDateRange.mockReset()
    mockedFindByCreateDateRange.mockResolvedValue([])
    const result = await computeCM05('org1', '2026-02')
    expect(result.computable).toBe(false)
  })
})

describe('CM-07 — Marketing ROI by Channel (blended only)', () => {
  function pl(income: Record<string, number>, expenses: Record<string, number>) {
    return {
      columns: ['Total'],
      income: Object.entries(income).map(([account, amount]) => ({ account, amounts: { Total: amount } })),
      cogs: [],
      expenses: Object.entries(expenses).map(([account, amount]) => ({ account, amounts: { Total: amount } })),
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
    mockedFindByCreateDateRange.mockResolvedValue([])
    mockedFindByCloseDateRange.mockResolvedValue([])
    mockedFindSourcesByProvider.mockResolvedValue([])
    mockedFindAllStageDefs.mockResolvedValue([])
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
