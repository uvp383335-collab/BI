import { CHART_DATA_REGISTRY, AnalysisWindow } from './chartDataRegistry'
import { DEFAULT_ANALYSIS_PROMPTS } from './defaultPrompts'
import { getInvoiceRevenueGrowthByState } from '../../metrics/service/productRevenueGrowth.service'
import { getCustomerRevenueConcentration } from '../../metrics/service/customerRevenueConcentration.service'
import { getCampaignWonOpportunities } from '../../metrics/service/campaignWonOpportunities.service'
import { funnelService } from '../../sync/service/funnel.service'
import { analyticsService } from '../../sync/service/analytics.service'

jest.mock('../../metrics/service/productRevenueGrowth.service')
jest.mock('../../metrics/service/customerRevenueConcentration.service')
jest.mock('../../metrics/service/campaignWonOpportunities.service')
jest.mock('../../sync/service/funnel.service', () => ({ funnelService: { getFunnels: jest.fn() } }))
jest.mock('../../sync/service/analytics.service', () => ({ analyticsService: { getPipelines: jest.fn() } }))

const ORG_ID = 'org1'
const window: AnalysisWindow = { from: '2024-11', to: '2026-10' }

describe('CHART_DATA_REGISTRY', () => {
  beforeEach(() => jest.resetAllMocks())

  it('has a default prompt for every chart key', () => {
    expect(Object.keys(DEFAULT_ANALYSIS_PROMPTS).sort()).toEqual(Object.keys(CHART_DATA_REGISTRY).sort())
    for (const [key, prompt] of Object.entries(DEFAULT_ANALYSIS_PROMPTS)) {
      expect(prompt.chartKey).toBe(key)
      expect(prompt.userPromptTemplate).toContain('{{data}}')
    }
  })

  it('loads revenue by state for all products and trims months to the window', async () => {
    ;(getInvoiceRevenueGrowthByState as jest.Mock).mockResolvedValue({
      states: [
        { id: 'TX', name: 'TX', months: [{ month: '2024-10', revenue: 5, revenueGrowthPct: null }, { month: '2024-11', revenue: 10, revenueGrowthPct: 100 }] },
        { id: 'CA', name: 'CA', months: [{ month: '2024-11', revenue: 0, revenueGrowthPct: null }] }
      ]
    })

    const data = await CHART_DATA_REGISTRY['invoice-revenue-growth-by-state'].load({ orgId: ORG_ID, window })

    expect(getInvoiceRevenueGrowthByState).toHaveBeenCalledWith(ORG_ID, { fromYear: '2024' })
    expect(data).toEqual({ states: [{ state: 'TX', months: [{ month: '2024-11', revenue: 10, revenueGrowthPct: 100 }] }] })
  })

  it('never sends customer names for customer concentration', async () => {
    ;(getCustomerRevenueConcentration as jest.Mock).mockResolvedValue({
      rows: [
        { customerId: 'c1', customerName: 'Acme Corp', revenue: 700, pctOfTotal: 70 },
        { customerId: 'c2', customerName: 'Globex', revenue: 300, pctOfTotal: 30 }
      ],
      top10Pct: 100,
      totalRevenue: 1000
    })

    const data = await CHART_DATA_REGISTRY['customer-revenue-concentration'].load({ orgId: ORG_ID, window })

    expect(getCustomerRevenueConcentration).toHaveBeenCalledWith(ORG_ID, undefined)
    expect(JSON.stringify(data)).not.toMatch(/Acme|Globex|c1|c2/)
    expect(data).toMatchObject({ customerCount: 2, topCustomers: [{ rank: 1, revenue: 700 }, { rank: 2, revenue: 300 }] })
  })

  it('caps long campaign lists and rolls the rest into a total', async () => {
    const rows = Array.from({ length: 30 }, (_, i) => ({ campaignId: `id${i}`, campaignName: `Campaign ${i}`, wonCount: 1, wonAmount: i + 1 }))
    ;(getCampaignWonOpportunities as jest.Mock).mockResolvedValue({ rows })

    const data = (await CHART_DATA_REGISTRY['campaign-won-opportunities'].load({ orgId: ORG_ID, window })) as any

    expect(data.campaigns).toHaveLength(25)
    expect(data.campaigns[0]).toEqual({ campaign: 'Campaign 29', wonCount: 1, wonAmount: 30 })
    expect(data.otherCampaignsCount).toBe(5)
    expect(data.otherCampaignsWonAmount).toBe(1 + 2 + 3 + 4 + 5)
  })

  it('loads the deal stage funnel once per pipeline instead of one selected pipeline', async () => {
    ;(analyticsService.getPipelines as jest.Mock).mockResolvedValue(['sales', 'renewals'])
    ;(funnelService.getFunnels as jest.Mock).mockImplementation((_org, _provider, filters) =>
      Promise.resolve({ dealStage: { pipeline: filters.pipeline, totalEntered: 1, stages: [] } })
    )

    const data = await CHART_DATA_REGISTRY['hubspot-deal-stage-funnel'].load({ orgId: ORG_ID, window })

    expect(data).toEqual({ pipelines: [{ pipeline: 'sales', totalEntered: 1, stages: [] }, { pipeline: 'renewals', totalEntered: 1, stages: [] }] })
    const filters = (funnelService.getFunnels as jest.Mock).mock.calls[0][2]
    expect(filters.productId).toBeUndefined()
    expect(filters.from.toISOString()).toBe('2024-11-01T00:00:00.000Z')
    expect(filters.to.toISOString()).toBe('2026-10-31T23:59:59.999Z')
  })
})
