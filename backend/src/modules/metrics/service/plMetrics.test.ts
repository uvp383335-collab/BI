import { getStoredProfitAndLoss } from './plReport.service'
import { ParsedProfitAndLoss } from './plParser'
import { computeQuarterRollForward, RollForward } from './revenueRollForward.service'
import { computeVC04, computeVC06, computeVC07, computeVC09, computeVC10, computeVC12, computeVC13, computeVC14 } from './plMetrics.service'

jest.mock('./plReport.service')
jest.mock('./revenueRollForward.service', () => {
  const actual = jest.requireActual('./revenueRollForward.service')
  return { ...actual, computeQuarterRollForward: jest.fn() }
})

// plMetrics.service.ts reads exclusively from PLSnapshot (via getStoredProfitAndLoss) —
// not a live QuickBooks call — see docs/sherpai-metrics-progress.md gap G-15.
const mockedGetPL = getStoredProfitAndLoss as jest.Mock
const mockedRollForward = computeQuarterRollForward as jest.Mock

function pl(opts: {
  income: Record<string, Record<string, number>>
  cogs?: Record<string, Record<string, number>>
  expenses?: Record<string, Record<string, number>>
  columns?: string[]
}): ParsedProfitAndLoss {
  const columns = opts.columns ?? ['Total']
  const toItems = (rows?: Record<string, Record<string, number>>) =>
    Object.entries(rows ?? {}).map(([account, amounts]) => ({ account, amounts }))
  return {
    columns,
    income: toItems(opts.income),
    cogs: toItems(opts.cogs),
    expenses: toItems(opts.expenses),
    otherExpenses: [],
    sectionTotals: {}
  }
}

function rollForward(overrides: Partial<RollForward>): RollForward {
  return {
    startMonth: '2026-02',
    endMonth: '2026-03',
    startingRevenue: 0,
    cancellations: 0,
    downgrades: 0,
    expansion: 0,
    newLogoRevenue: 0,
    newLogoCustomerCount: 0,
    winBackRevenue: 0,
    winBackCustomerCount: 0,
    endingRevenue: 0,
    customerCount: 0,
    ...overrides
  }
}

beforeEach(() => {
  mockedGetPL.mockReset()
  mockedRollForward.mockReset()
})

describe('VC-04 — COGS % and Mix, rate/mix decomposition', () => {
  it('attributes a COGS % rise to rate when a class costs more to deliver at the same mix', async () => {
    // Current quarter (byClass call): same 50/50 mix as prior, but Core Platform's own cost rate rose.
    mockedGetPL
      .mockResolvedValueOnce(
        pl({
          columns: ['Core Platform', 'Analytics Add-on', 'Total'],
          income: { Core: { 'Core Platform': 500, Total: 500 }, Addon: { 'Analytics Add-on': 500, Total: 500 } },
          cogs: { CoreCogs: { 'Core Platform': 250, Total: 250 }, AddonCogs: { 'Analytics Add-on': 100, Total: 100 } }
        })
      )
      .mockResolvedValueOnce(
        pl({
          columns: ['Core Platform', 'Analytics Add-on', 'Total'],
          income: { Core: { 'Core Platform': 500, Total: 500 }, Addon: { 'Analytics Add-on': 500, Total: 500 } },
          cogs: { CoreCogs: { 'Core Platform': 150, Total: 150 }, AddonCogs: { 'Analytics Add-on': 100, Total: 100 } }
        })
      )

    const result = await computeVC04('org1', '2026-03')
    expect(result.value).toBeCloseTo(35, 1) // (250+100)/1000
    expect(result.data.previousQuarterCogsPct).toBeCloseTo(25, 1) // (150+100)/1000
    expect(result.data.rateEffect).toBeGreaterThan(1)
    expect(result.flag?.level).toBe('act_now')
  })
})

describe('VC-09 — G&A % of Revenue', () => {
  it('sums only G&A-classified expense accounts', async () => {
    mockedGetPL.mockResolvedValueOnce(
      pl({
        income: { Rev: { Total: 10000 } },
        expenses: {
          'G&A - Salaries': { Total: 800 },
          'G&A - Rent & Facilities': { Total: 200 },
          'Sales & Marketing - Advertising': { Total: 500 } // must NOT be counted as G&A
        }
      })
    )
    const result = await computeVC09('org1', '2026-03')
    expect(result.value).toBeCloseTo(10, 1) // (800+200)/10000
    expect(result.flag).toBeNull() // no benchmark data available in MVP
  })
})

describe('VC-10 — EBITDA Margin, D&A picked up from inside COGS too', () => {
  it('adds back D&A whether it sits in Expenses or hides inside COGS', async () => {
    const quarterPl = pl({
      income: { Rev: { Total: 10000 } },
      cogs: { Hosting: { Total: 2000 }, 'Depreciation (COGS-embedded)': { Total: 300 } },
      expenses: { 'G&A - Salaries': { Total: 3000 }, 'Depreciation & Amortization': { Total: 700 } }
    })
    // operating income (no NetOperatingIncome section total in the fixture, falls back to revenue-cogs-expenses)
    // = 10000 - 2300 - 3700 = 4000; D&A = 300 + 700 = 1000; EBITDA = 5000; margin = 50%
    mockedGetPL.mockResolvedValueOnce(quarterPl).mockResolvedValueOnce(quarterPl).mockResolvedValueOnce(quarterPl)

    const result = await computeVC10('org1', '2026-03')
    expect(result.value).toBeCloseTo(50, 1)
    expect(result.data.ebitda).toBeCloseTo(5000, 0)
  })
})

describe('VC-06 / VC-07 — unit economics (CAC, payback, LTV:CAC)', () => {
  it('computes CAC, payback, and LTV:CAC consistently off the same roll-forward + P&L', async () => {
    // 2 new customers this quarter, $600/mo combined revenue at quarter end -> $300 avg/customer.
    // $6,000 S&M spend -> CAC = $3,000. Gross margin 60%. Cancellations $200 of $2,000 starting -> monthly churn ~3.33%.
    const quarterPl = pl({
      income: { Rev: { Total: 10000 } },
      cogs: { Cogs: { Total: 4000 } }, // gross margin 60%
      expenses: { 'Sales & Marketing - Advertising': { Total: 6000 } }
    })
    mockedGetPL.mockResolvedValue(quarterPl)
    mockedRollForward.mockResolvedValue(
      rollForward({ newLogoRevenue: 600, newLogoCustomerCount: 2, startingRevenue: 2000, cancellations: 200 })
    )

    const vc06 = await computeVC06('org1', '2026-03')
    expect(vc06.data.cac).toBeCloseTo(3000, 0) // 6000 / 2
    // monthly gross profit per new customer = 300 * 0.6 = 180; payback = 3000/180 = 16.67mo
    expect(vc06.value).toBeCloseTo(16.7, 1)
    expect(vc06.unit).toBe('months')

    const vc07 = await computeVC07('org1', '2026-03')
    // monthly churn = (200/2000)/3 = 0.0333; modeled months = 1/0.0333 = 30; LTV = 300*0.6*30 = 5400; ratio = 5400/3000 = 1.8
    expect(vc07.value).toBeCloseTo(1.8, 1)
    expect(vc07.unit).toBe('multiple')
    expect(vc07.flag?.level).toBe('act_now') // ratio < 2.0
  })

  it('is not computable when no new customers were won', async () => {
    mockedGetPL.mockResolvedValue(pl({ income: { Rev: { Total: 10000 } }, cogs: { Cogs: { Total: 4000 } } }))
    mockedRollForward.mockResolvedValue(rollForward({ newLogoCustomerCount: 0 }))

    const vc06 = await computeVC06('org1', '2026-03')
    expect(vc06.computable).toBe(false)
    expect(vc06.value).toBeNull()
  })
})

describe('VC-07 — "declining two quarters running" needs a genuine two-quarter losing streak', () => {
  it('watch: LTV:CAC above 3.0x but has fallen two quarters running', async () => {
    const quarterPl = pl({
      income: { Rev: { Total: 10000 } },
      cogs: { Cogs: { Total: 4000 } }, // gross margin 60%
      expenses: { 'Sales & Marketing - Advertising': { Total: 6000 } } // CAC = 6000/2 = 3000 every quarter
    })
    mockedGetPL.mockResolvedValue(quarterPl)
    mockedRollForward
      .mockResolvedValueOnce(rollForward({ newLogoRevenue: 1200, newLogoCustomerCount: 2, startingRevenue: 5000, cancellations: 450 })) // current: ratio 4.0x
      .mockResolvedValueOnce(rollForward({ newLogoRevenue: 1200, newLogoCustomerCount: 2, startingRevenue: 5000, cancellations: 360 })) // previous quarter: ratio 5.0x
      .mockResolvedValueOnce(rollForward({ newLogoRevenue: 1200, newLogoCustomerCount: 2, startingRevenue: 5000, cancellations: 300 })) // two quarters ago: ratio 6.0x

    const result = await computeVC07('org1', '2026-03')
    expect(result.value).toBeCloseTo(4.0, 1)
    expect(result.flag?.level).toBe('watch')
    expect(result.flag?.reason).toContain('two quarters running')
  })

  it('does not flag a single dip after a rising trend', async () => {
    const quarterPl = pl({
      income: { Rev: { Total: 10000 } },
      cogs: { Cogs: { Total: 4000 } },
      expenses: { 'Sales & Marketing - Advertising': { Total: 6000 } }
    })
    mockedGetPL.mockResolvedValue(quarterPl)
    mockedRollForward
      .mockResolvedValueOnce(rollForward({ newLogoRevenue: 1200, newLogoCustomerCount: 2, startingRevenue: 6000, cancellations: 310 })) // current: ratio ~6.97x -- a small dip
      .mockResolvedValueOnce(rollForward({ newLogoRevenue: 1200, newLogoCustomerCount: 2, startingRevenue: 6000, cancellations: 300 })) // previous quarter: ratio 7.2x -- the peak
      .mockResolvedValueOnce(rollForward({ newLogoRevenue: 1200, newLogoCustomerCount: 2, startingRevenue: 6000, cancellations: 600 })) // two quarters ago: ratio 3.6x -- this was a rise, not a decline

    const result = await computeVC07('org1', '2026-03')
    expect(result.flag).toBeNull()
  })
})

describe('VC-12 / VC-13 — recurring vs. non-recurring revenue', () => {
  it('VC-12/VC-13 use realistic account names for the recurring classifier', async () => {
    const makeQuarterPl = (subscription: number, services: number, hardware: number) =>
      pl({
        income: {
          'Subscription Revenue': { Total: subscription },
          'Professional Services Revenue': { Total: services },
          'Hardware Revenue': { Total: hardware }
        }
      })

    // VC-12: current quarter only needed for this assertion (others default via mockResolvedValue).
    mockedGetPL.mockResolvedValue(makeQuarterPl(8000, 1500, 500))
    const vc12 = await computeVC12('org1', '2026-03')
    expect(vc12.value).toBeCloseTo(80, 1) // 8000 / 10000

    // VC-13: recurring grew 8000->8800 (+10%) YoY while non-recurring (2000) held flat,
    // so total (10000->10800) grows slower than recurring — the "mix degrading" watch case.
    mockedGetPL
      .mockResolvedValueOnce(makeQuarterPl(8800, 1500, 500)) // current
      .mockResolvedValueOnce(makeQuarterPl(8400, 1500, 500)) // previous quarter
      .mockResolvedValueOnce(makeQuarterPl(8000, 1500, 500)) // year-ago quarter
    const vc13 = await computeVC13('org1', '2026-03')
    expect(vc13.data.totalYoY).toBeCloseTo(8.0, 1) // (10800-10000)/10000
    expect(vc13.data.recurringYoY).toBeCloseTo(10.0, 1) // (8800-8000)/8000
  })
})

describe('VC-14 — whole-base LTV:CAC uses trailing-12-month CAC', () => {
  it('sums S&M spend and new logos across 4 quarters for CAC, but current quarter for the base', async () => {
    const quarterPl = pl({
      income: { Rev: { Total: 10000 } },
      cogs: { Cogs: { Total: 4000 } },
      expenses: { 'Sales & Marketing - Advertising': { Total: 5000 } }
    })
    mockedGetPL.mockResolvedValue(quarterPl)
    // 4 calls to computeQuarterRollForward for the unit-economics cores, then 1 more for the whole-base snapshot.
    mockedRollForward
      .mockResolvedValueOnce(rollForward({ newLogoRevenue: 500, newLogoCustomerCount: 2, startingRevenue: 3000, cancellations: 150 }))
      .mockResolvedValueOnce(rollForward({ newLogoRevenue: 400, newLogoCustomerCount: 1, startingRevenue: 2800, cancellations: 100 }))
      .mockResolvedValueOnce(rollForward({ newLogoRevenue: 300, newLogoCustomerCount: 1, startingRevenue: 2600, cancellations: 100 }))
      .mockResolvedValueOnce(rollForward({ newLogoRevenue: 300, newLogoCustomerCount: 1, startingRevenue: 2400, cancellations: 100 }))
      .mockResolvedValueOnce(rollForward({ endingRevenue: 10000, customerCount: 20 }))

    const result = await computeVC14('org1', '2026-03')
    // ttmSmSpend = 5000*4 = 20000, ttmNewLogos = 2+1+1+1=5 -> CAC ttm = 4000
    expect(result.data.cacTrailing12Months).toBeCloseTo(4000, 0)
    expect(result.data.avgMonthlyRevenuePerCustomer).toBeCloseTo(500, 0) // 10000/20
  })
})

describe('honest-numbers rule: a missing PLSnapshot for the requested quarter', () => {
  it('makes the metric not computable rather than treating it as a zero P&L', async () => {
    mockedGetPL.mockResolvedValue(null)
    const vc04 = await computeVC04('org1', '2026-03')
    expect(vc04.computable).toBe(false)
    expect(vc04.value).toBeNull()
    expect(vc04.flag).toBeNull()

    const vc09 = await computeVC09('org1', '2026-03')
    expect(vc09.computable).toBe(false)
  })

  it('a missing COMPARISON quarter (not the current one) just drops that comparison, current value still computes', async () => {
    const currentPl = pl({ income: { Rev: { Total: 10000 } }, cogs: { Cogs: { Total: 3500 } } })
    mockedGetPL.mockResolvedValueOnce(currentPl).mockResolvedValue(null) // current present, everything else missing
    const result = await computeVC04('org1', '2026-03')
    expect(result.computable).toBe(true)
    expect(result.value).toBeCloseTo(35, 1)
    expect(result.data.previousQuarterCogsPct).toBeNull()
    expect(result.flag).toBeNull() // no prior-quarter comparison available, so no "rose vs last quarter" flag
  })

  it('VC-14 refuses to treat a missing quarter\'s S&M spend as $0 — the whole trailing-12mo CAC goes null instead', async () => {
    const quarterPl = pl({ income: { Rev: { Total: 10000 } }, cogs: { Cogs: { Total: 4000 } }, expenses: { 'Sales & Marketing - Advertising': { Total: 5000 } } })
    // Current quarter (core 0) has a snapshot; one of the other 3 trailing quarters (core 1) doesn't.
    mockedGetPL
      .mockResolvedValueOnce(quarterPl) // core 0 (current)
      .mockResolvedValueOnce(null) // core 1 -- missing snapshot
      .mockResolvedValueOnce(quarterPl) // core 2
      .mockResolvedValueOnce(quarterPl) // core 3
    mockedRollForward
      .mockResolvedValueOnce(rollForward({ newLogoRevenue: 500, newLogoCustomerCount: 2, startingRevenue: 3000, cancellations: 150 }))
      .mockResolvedValueOnce(rollForward({ newLogoCustomerCount: 1 }))
      .mockResolvedValueOnce(rollForward({ newLogoCustomerCount: 1 }))
      .mockResolvedValueOnce(rollForward({ newLogoCustomerCount: 1 }))
      .mockResolvedValueOnce(rollForward({ endingRevenue: 10000, customerCount: 20 }))

    const result = await computeVC14('org1', '2026-03')
    expect(result.data.cacTrailing12Months).toBeNull()
  })
})
