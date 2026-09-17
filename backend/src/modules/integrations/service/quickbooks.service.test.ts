import axios from 'axios'
import { QuickBooksService, mapWithConcurrency } from './quickbooks.service'

jest.mock('axios', () => {
  const mockAxios: { get: jest.Mock; isAxiosError: (err: unknown) => boolean } = {
    get: jest.fn(),
    isAxiosError: (err: unknown): boolean => !!err && typeof err === 'object' && (err as { isAxiosError?: boolean }).isAxiosError === true
  }
  return mockAxios
})

const mockedGet = axios.get as jest.Mock

describe('mapWithConcurrency', () => {
  it('never runs more than `limit` calls at once', async () => {
    let inFlight = 0
    let maxInFlight = 0
    const items = Array.from({ length: 10 }, (_, i) => i)

    await mapWithConcurrency(items, 3, async (item) => {
      inFlight += 1
      maxInFlight = Math.max(maxInFlight, inFlight)
      await new Promise((resolve) => setTimeout(resolve, 5))
      inFlight -= 1
      return item * 2
    })

    expect(maxInFlight).toBeLessThanOrEqual(3)
  })

  it('reports one rejection without aborting the rest', async () => {
    const items = [1, 2, 3]
    const results = await mapWithConcurrency(items, 3, async (item) => {
      if (item === 2) throw new Error('boom')
      return item
    })

    expect(results[0]).toEqual({ status: 'fulfilled', value: 1 })
    expect(results[1].status).toBe('rejected')
    expect(results[2]).toEqual({ status: 'fulfilled', value: 3 })
  })
})

describe('QuickBooksService.getReport 429 retry', () => {
  beforeEach(() => {
    mockedGet.mockReset()
    jest.useFakeTimers()
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  it('retries a 429 with backoff and returns the report once QuickBooks succeeds', async () => {
    const rateLimitError = { isAxiosError: true, response: { status: 429, headers: {}, data: {} } }
    mockedGet.mockRejectedValueOnce(rateLimitError).mockResolvedValueOnce({ data: { Columns: { Column: [] }, Rows: { Row: [] } } })

    const promise = QuickBooksService.getProfitAndLossReport('token', 'realm1', '2026-01-01', '2026-01-31')
    await jest.advanceTimersByTimeAsync(1000)
    const report = await promise

    expect(report).toEqual({ Columns: { Column: [] }, Rows: { Row: [] } })
    expect(mockedGet).toHaveBeenCalledTimes(2)
  })

  it('gives up after repeated 429s and throws a QUICKBOOKS_PROFIT_AND_LOSS_FETCH_FAILED error', async () => {
    const rateLimitError = { isAxiosError: true, response: { status: 429, headers: {}, data: {} } }
    mockedGet.mockRejectedValue(rateLimitError)

    const promise = QuickBooksService.getProfitAndLossReport('token', 'realm1', '2026-01-01', '2026-01-31')
    const assertion = expect(promise).rejects.toMatchObject({ code: 'QUICKBOOKS_PROFIT_AND_LOSS_FETCH_FAILED' })
    await jest.advanceTimersByTimeAsync(10000)
    await assertion

    // 1 initial attempt + 4 retries = 5 calls.
    expect(mockedGet).toHaveBeenCalledTimes(5)
  })
})
