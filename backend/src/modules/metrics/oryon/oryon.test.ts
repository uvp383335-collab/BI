import { pyRound, sum, sortedBy, deepEqual } from './pyCompat'
import { addMonths, computeMrr, retention, normalizeName, suggestMapping } from './engine'

describe('Python compatibility helpers', () => {
  it('round() matches CPython (exact value, ties to even)', () => {
    expect(pyRound(57531.985, 2)).toBe(57531.99) // binary value is just above the tie
    expect(pyRound(72321.515, 2)).toBe(72321.51) // just below
    expect(pyRound(0.125, 2)).toBe(0.12) // exact tie -> even
    expect(pyRound(0.375, 2)).toBe(0.38)
    expect(pyRound(2.5)).toBe(2)
    expect(pyRound(-2.5)).toBe(-2)
    expect(pyRound(2.675, 2)).toBe(2.67)
  })

  it('sum() is compensated like CPython 3.12+', () => {
    expect(sum([0.1, 0.2, 0.3])).toBe(0.6) // a plain left fold gives 0.6000000000000001
    expect(sum([1e100, 1, -1e100])).toBe(1)
  })

  it('sorted() is stable on tuple keys with booleans', () => {
    const xs = [{ a: true, n: 2 }, { a: false, n: 3 }, { a: false, n: 1 }]
    expect(sortedBy(xs, (x) => [x.a, x.n]).map((x) => x.n)).toEqual([1, 3, 2])
  })

  it('dict equality ignores key order', () => {
    expect(deepEqual({ a: 1, b: { c: 2 } }, { b: { c: 2 }, a: 1 })).toBe(true)
    expect(deepEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false)
  })
})

describe('Oryon engine', () => {
  it('adds months across years', () => {
    expect(addMonths('2026-01', -1)).toBe('2025-12')
    expect(addMonths('2025-11', 14)).toBe('2027-01')
  })

  it('spreads annual lines over 12 months, starting next month on/after the early-invoice day', () => {
    const [mrr] = computeMrr(
      [{ customerRecordId: '1', txnDate: new Date('2025-03-20T00:00:00Z'), lines: [{ itemId: 'A', amount: 1200 }] }],
      { A: 'subscription_yearly' }, { early_invoice_day: 16, cad_countries: [], fx_cad_usd: {} }
    )
    expect(mrr.has('2025-03')).toBe(false)
    expect(mrr.get('2025-04')!.get('1')!.subscription).toBe(100)
    expect(mrr.get('2026-03')!.get('1')!.subscription).toBe(100)
  })

  it('counts a repeating retainer only when billed the same amount in an adjacent month', () => {
    const inv = (d: string, a: number) => ({ customerRecordId: '1', txnDate: new Date(d), lines: [{ itemId: 'PS', amount: a }] })
    const [mrr] = computeMrr([inv('2025-01-05', 500), inv('2025-02-05', 500), inv('2025-04-05', 900)],
      { PS: 'retainer_repeating' }, { cad_countries: [], fx_cad_usd: {} })
    expect(mrr.get('2025-01')!.get('1')!.retainer).toBe(500)
    expect(mrr.get('2025-02')!.get('1')!.retainer).toBe(500)
    expect(mrr.has('2025-04')).toBe(false) // a one-off project month is not recurring
  })

  it('retention buckets churn / downgrade / upgrade', () => {
    const t = new Map([
      ['2025-01', new Map([['a', { subscription: 100, retainer: 0 }], ['b', { subscription: 100, retainer: 0 }], ['c', { subscription: 100, retainer: 0 }]])],
      ['2026-01', new Map([['b', { subscription: 60, retainer: 0 }], ['c', { subscription: 150, retainer: 0 }]])]
    ])
    const r = retention(t, new Map(), {}, '2025-01', '2026-01')!
    expect([r.S, r.C, r.Dn, r.U]).toEqual([300, 100, 40, 50])
    expect(r.grr).toBeCloseTo(53.333, 3)
    expect(r.nrr).toBeCloseTo(70, 6)
  })

  it('normalizes names and suggests mappings like the reference app', () => {
    expect(normalizeName('Summit Mechanical Group:Summit HVAC Services LLC')).toBe('summithvacservices')
    expect(suggestMapping('Ridgeline Core - Annual')[0]).toBe('subscription_yearly')
    expect(suggestMapping('Professional Services - Hourly')[0]).toBe('retainer_repeating')
    expect(suggestMapping('SMS Messages - Overage')[0]).toBe('not_mrr')
  })
})
