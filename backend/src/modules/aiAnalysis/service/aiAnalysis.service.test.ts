import { analyzeChart, renderTemplate } from './aiAnalysis.service'
import { analysisPromptRepository } from '../repository/analysisPrompt.repository'
import { analysisReportRepository } from '../repository/analysisReport.repository'
import { generateWithClaude } from '../../../shared/llm/claudeClient'
import { getCustomerUpgradesTrend } from '../../metrics/service/customerUpgradesTrend.service'
import { latestClosedMonth } from '../../metrics/service/revenueRollForward.service'

jest.mock('../repository/analysisPrompt.repository')
jest.mock('../repository/analysisReport.repository')
jest.mock('../../../shared/llm/claudeClient')
jest.mock('../../metrics/service/customerUpgradesTrend.service')
jest.mock('../../metrics/service/cmMetrics.service')
jest.mock('../../metrics/service/productRevenueGrowth.service')
jest.mock('../../metrics/service/revenueRollForward.service', () => {
  const actual = jest.requireActual('../../metrics/service/revenueRollForward.service')
  return { ...actual, latestClosedMonth: jest.fn() }
})

const mockedFindPrompt = analysisPromptRepository.findActiveByChartKey as jest.Mock
const mockedFindByCacheKey = analysisReportRepository.findByCacheKey as jest.Mock
const mockedCreateReport = analysisReportRepository.create as jest.Mock
const mockedGenerate = generateWithClaude as jest.Mock
const mockedChurnTrend = getCustomerUpgradesTrend as jest.Mock
const mockedLatestClosedMonth = latestClosedMonth as jest.Mock

const ORG_ID = '64b000000000000000000001'
const USER_ID = '64b000000000000000000002'

const prompt = {
  chartKey: 'customer-churn-trend',
  title: 'Customer churn',
  systemPrompt: 'system',
  userPromptTemplate: 'Chart {{chartTitle}} over {{window}}: {{data}}',
  modelId: 'claude-opus-5-5',
  maxTokens: 16000,
  effort: 'medium',
  isActive: true
}

function churnPoint(period: string) {
  return { period, upgradeCount: 0, upgradeAmount: 0, downgradeCount: 0, downgradeAmount: 0, churnCount: 2, churnAmount: 500, startingRevenue: 10000, grrPct: 95, nrrPct: 98 }
}

describe('renderTemplate', () => {
  it('fills known placeholders and leaves unknown ones visible', () => {
    expect(renderTemplate('{{a}} and {{ b }} and {{missing}}', { a: '1', b: '2' })).toBe('1 and 2 and {{missing}}')
  })
})

describe('analyzeChart', () => {
  beforeEach(() => {
    jest.resetAllMocks()
    mockedLatestClosedMonth.mockReturnValue('2026-10')
    mockedFindPrompt.mockResolvedValue(prompt)
    mockedChurnTrend.mockResolvedValue({ hasData: true, points: [churnPoint('2024-10'), churnPoint('2024-11'), churnPoint('2026-10')] })
    mockedCreateReport.mockImplementation((_orgId, input) => Promise.resolve({ ...input, createdAt: new Date('2026-11-12T00:00:00Z') }))
    mockedGenerate.mockResolvedValue({ text: '## Summary\nok', model: 'claude-opus-5-5', inputTokens: 100, outputTokens: 50 })
  })

  it('loads the chart for all products (no product filter) and only the last 24 closed months', async () => {
    mockedFindByCacheKey.mockResolvedValue(null)

    const result = await analyzeChart(ORG_ID, USER_ID, 'customer-churn-trend')

    expect(mockedChurnTrend).toHaveBeenCalledWith(ORG_ID, undefined, 'monthly')
    expect(result.window).toEqual({ from: '2024-11', to: '2026-10' })
    const userPrompt = mockedGenerate.mock.calls[0][0].user as string
    expect(userPrompt).toContain('2024-11 to 2026-10')
    expect(userPrompt).not.toContain('"2024-10"')
    expect(userPrompt).toContain('"2026-10"')
    expect(result).toMatchObject({ report: '## Summary\nok', cached: false })
    expect(mockedCreateReport).toHaveBeenCalledWith(ORG_ID, expect.objectContaining({ chartKey: 'customer-churn-trend', generatedBy: USER_ID }))
  })

  it('returns the cached report without calling Claude when inputs are unchanged', async () => {
    mockedFindByCacheKey.mockResolvedValue({ report: 'cached report', modelId: 'claude-opus-5-5', windowFrom: '2024-11', windowTo: '2026-10', createdAt: new Date('2026-11-01T00:00:00Z') })

    const result = await analyzeChart(ORG_ID, USER_ID, 'customer-churn-trend')

    expect(mockedGenerate).not.toHaveBeenCalled()
    expect(result).toMatchObject({ report: 'cached report', cached: true })
  })

  it('bypasses the cache when refresh is requested', async () => {
    mockedFindByCacheKey.mockResolvedValue({ report: 'cached report' })

    const result = await analyzeChart(ORG_ID, USER_ID, 'customer-churn-trend', { refresh: true })

    expect(mockedFindByCacheKey).not.toHaveBeenCalled()
    expect(mockedGenerate).toHaveBeenCalledTimes(1)
    expect(result.cached).toBe(false)
  })

  it('uses a different cache key when the prompt is edited', async () => {
    mockedFindByCacheKey.mockResolvedValue(null)
    await analyzeChart(ORG_ID, USER_ID, 'customer-churn-trend')
    mockedFindPrompt.mockResolvedValue({ ...prompt, systemPrompt: 'edited system' })
    await analyzeChart(ORG_ID, USER_ID, 'customer-churn-trend')

    const [first, second] = mockedFindByCacheKey.mock.calls.map((call) => call[2])
    expect(first).not.toBe(second)
  })

  it('fails with 404 when no active prompt exists for the chart', async () => {
    mockedFindPrompt.mockResolvedValue(null)

    await expect(analyzeChart(ORG_ID, USER_ID, 'customer-churn-trend')).rejects.toMatchObject({ status: 404, code: 'ANALYSIS_PROMPT_NOT_FOUND' })
    expect(mockedGenerate).not.toHaveBeenCalled()
  })
})
