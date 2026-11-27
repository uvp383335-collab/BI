import React from 'react'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, it, expect, vi } from 'vitest'
import { PAGES, PAGE_BY_KEY, PAGE_FOR_METRIC, PAGE_GROUPS } from './config'

vi.mock('../../widgets/AppShell', () => ({
  AppShell: ({ title, children }: { title: string; children: React.ReactNode }) => (
    <div>
      <h1>{title}</h1>
      {children}
    </div>
  )
}))

const getPage = vi.fn()
const getDetail = vi.fn()
const PRODUCTS = [
  { id: '3', name: 'Ridgeline Core - Monthly', lines: 10, amount: 100, mapping: 'subscription_monthly' },
  { id: '4', name: 'Ridgeline Core - Annual', lines: 5, amount: 500, mapping: 'subscription_yearly' }
]
vi.mock('./api/metricPagesApi', () => ({
  getMetricPageRequest: (...a: unknown[]) => getPage(...a),
  getMetricDetailRequest: (...a: unknown[]) => getDetail(...a),
  getProductsRequest: async () => ({ products: PRODUCTS, pages: ['mrr', 'retention', 'new_logos', 'concentration', 'diversification'] })
}))

// recharts needs a sized container; jsdom has none
vi.mock('recharts', async (orig) => {
  const mod = await orig<typeof import('recharts')>()
  return { ...mod, ResponsiveContainer: ({ children }: { children: React.ReactElement }) => <div style={{ width: 600, height: 260 }}>{children}</div> }
})

import { MetricPage } from './pages/MetricPage'

describe('metric page configuration', () => {
  it('has a page for every dashboard metric and lists every page once', () => {
    for (const p of Object.values(PAGE_FOR_METRIC)) expect(PAGE_BY_KEY.has(p)).toBe(true)
    const listed = PAGE_GROUPS.flatMap((g) => g.pages)
    expect(new Set(listed).size).toBe(listed.length)
    expect(listed.sort()).toEqual(PAGES.map((p) => p.page).sort())
  })

  it.each(PAGES.map((p) => [p.page, p] as const))('%s copes with a page that has no data yet', (_k, cfg) => {
    const empty = { rows: [], latest: null, info: {}, cfg: {} }
    const q = Object.fromEntries(cfg.controls.map((c) => [c.key, c.default]))
    expect(() => cfg.kpis(empty, q)).not.toThrow()
    for (const c of cfg.charts) {
      expect(() => (c.rows ? c.rows(empty) : []).map(c.x)).not.toThrow()
      expect(() => c.series(empty)).not.toThrow()
      expect(() => c.refs?.(empty)).not.toThrow()
    }
    expect(() => (typeof cfg.columns === 'function' ? cfg.columns(empty, q) : cfg.columns)).not.toThrow()
    expect(cfg.method.length).toBeGreaterThan(0)
  })
})

const RETENTION = {
  rows: [
    { m0: '2025-06', m1: '2026-06', label: 'Q2-2026', S: 100, C: 10, Dn: 5, U: 8, K: 85, E: 93, grr: 85, nrr: 93, cohort: 20, churn: 2, downgrade: 3, upgrade: 4, flat: 11, reliable: true },
    { m0: '2025-09', m1: '2026-09', label: 'Q3-2026', S: 120, C: 6, Dn: 6, U: 12, K: 108, E: 120, grr: 90, nrr: 100, cohort: 22, churn: 1, downgrade: 2, upgrade: 5, flat: 14, reliable: true }
  ]
}

function renderAt(url: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[url]}>
        <Routes>
          <Route path="/metrics/:page" element={<MetricPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  )
}

describe('metric page', () => {
  it('shows KPIs, the table and the method, asks the API with the default view, and opens the drill-down', async () => {
    getPage.mockResolvedValue({ ...RETENTION, latest: RETENTION.rows[1] })
    getDetail.mockResolvedValue({ grr: 90, nrr: 100, m0: '2025-09', rate: 0.72, customers: [{ customer: '7', name: 'Acme Freight', currency: 'USD', start: 50, end: 0, change: -50, bucket: 'churn' }] })
    renderAt('/metrics/retention')
    expect(await screen.findByText('GRR · Q3-2026')).toBeInTheDocument()
    expect(getPage).toHaveBeenCalledWith('retention', { grain: 'quarter', window: 'ttm', scope: 'all' })
    expect(screen.getByText("How it's calculated")).toBeInTheDocument()
    expect(screen.getAllByRole('row')).toHaveLength(3)

    await userEvent.click(screen.getAllByRole('button', { name: 'details' })[1])
    const panel = await screen.findByRole('dialog')
    expect(await within(panel).findByText('Acme Freight')).toBeInTheDocument()
    expect(getDetail).toHaveBeenCalledWith('retention', { grain: 'quarter', window: 'ttm', scope: 'all', period: '2026-09' })
  })

  it('changing a view switch refetches with that view', async () => {
    getPage.mockResolvedValue({ ...RETENTION, latest: RETENTION.rows[1] })
    renderAt('/metrics/retention')
    await screen.findByText('GRR · Q3-2026')
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Grain' }), 'month')
    expect(getPage).toHaveBeenLastCalledWith('retention', { grain: 'month', window: 'ttm', scope: 'all' })
  })

  it('shows the backend error instead of an empty page', async () => {
    getPage.mockRejectedValue({ response: { data: { error: { message: 'Unknown Oryon page' } } } })
    renderAt('/metrics/retention')
    expect(await screen.findByText('Unknown Oryon page')).toBeInTheDocument()
  })

  it('an unknown page links back to all metrics', () => {
    renderAt('/metrics/nope')
    expect(screen.getByText('All metrics')).toBeInTheDocument()
  })
})

describe('CSV download', () => {
  it('writes a header and one raw-number line per row, quoting text with commas', async () => {
    const { downloadCsv } = await import('./components/Blocks')
    let blob: Blob | null = null
    const u = URL as unknown as Record<string, unknown>
    u.createObjectURL = (b: Blob) => { blob = b; return 'blob:x' }
    u.revokeObjectURL = () => undefined
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)
    downloadCsv('retention.csv', [
      { label: 'Period', value: (r) => r.label },
      { label: 'GRR %', value: (r) => r.grr, fmt: 'pct' },
      { label: 'Customer', value: (r) => r.name }
    ], [{ label: 'Q3-2026', grr: 86.663620916, name: 'Acme, Inc.' }, { label: 'Q2-2026', grr: null, name: 'Say "hi"' }])
    expect(click).toHaveBeenCalled()
    const text = await new Promise<string>((res) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result)); fr.readAsText(blob!) })
    expect(text.split('\n')).toEqual(['Period,GRR %,Customer', 'Q3-2026,86.663621,"Acme, Inc."', 'Q2-2026,,"Say ""hi"""'])
    click.mockRestore()
  })
})

describe('metric view inside the portfolio drawer', () => {
  const renderDrawer = async (highlight: string) => {
    const { DrawerMetric } = await import('./components/DrawerMetric')
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    return render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <DrawerMetric page="retention" highlight={highlight} />
        </MemoryRouter>
      </QueryClientProvider>
    )
  }

  it('highlights the dashboard period, opens the drill-down in place and goes back', async () => {
    getPage.mockResolvedValue({ ...RETENTION, latest: RETENTION.rows[1] })
    getDetail.mockResolvedValue({ grr: 90, nrr: 100, m0: '2025-09', rate: 0.72, customers: [{ customer: '7', name: 'Acme Freight', currency: 'USD', start: 50, end: 0, change: -50, bucket: 'churn' }] })
    await renderDrawer('2026-Q3')
    await screen.findByText('GRR · Q3-2026')
    const rows = screen.getAllByRole('row')
    expect(rows[2].className).toContain('bg-surface-3') // Q3-2026 = the dashboard quarter
    expect(rows[1].className).not.toContain('bg-surface-3')

    await userEvent.click(screen.getAllByRole('button', { name: 'details' })[1])
    expect(await screen.findByText('Acme Freight')).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).toBeNull() // in place, not a second drawer
    await userEvent.click(screen.getByRole('button', { name: '← Back' }))
    expect(await screen.findByText('GRR · Q3-2026')).toBeInTheDocument()
  })

  it('keeps its view switches in local state', async () => {
    getPage.mockResolvedValue({ ...RETENTION, latest: RETENTION.rows[1] })
    await renderDrawer('2026-09')
    await screen.findByText('GRR · Q3-2026')
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Window' }), 'period')
    expect(getPage).toHaveBeenLastCalledWith('retention', { grain: 'quarter', window: 'period', scope: 'all' })
  })
})

describe('product filter inside a metric', () => {
  it('a product-aware metric offers the product filter and refetches with the chosen products', async () => {
    getPage.mockResolvedValue({ ...RETENTION, latest: RETENTION.rows[1] })
    renderAt('/metrics/retention')
    await screen.findByText('GRR · Q3-2026')
    await userEvent.click(screen.getByRole('button', { name: /All products/ }))
    await userEvent.click(await screen.findByRole('checkbox', { name: /Ridgeline Core - Monthly/ }))
    expect(getPage).toHaveBeenLastCalledWith('retention', { grain: 'quarter', window: 'ttm', scope: 'all', items: '3' })
    expect(await screen.findByText(/Filtered to 1 product/)).toBeInTheDocument()
  })

  it('a P&L metric says the product filter does not apply', async () => {
    getPage.mockResolvedValue({ rows: [], latest: null })
    renderAt('/metrics/cogs')
    expect(await screen.findByText(/Product filter: not available for this metric/)).toBeInTheDocument()
    expect(getPage).toHaveBeenLastCalledWith('cogs', { grain: 'month', window: 'period' })
  })

  it('the drawer starts on the global product filter, matched by name', async () => {
    const { DrawerMetric, productIdsFor } = await import('./components/DrawerMetric')
    expect(productIdsFor(['Ridgeline Core - Annual (#4)', 'Ridgeline Core - Monthly'], PRODUCTS)).toEqual(['3', '4'])
    expect(productIdsFor('All', PRODUCTS)).toEqual([])
    getPage.mockResolvedValue({ ...RETENTION, latest: RETENTION.rows[1] })
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <DrawerMetric page="retention" highlight="2026-Q3" globalProducts={['Ridgeline Core - Monthly']} />
        </MemoryRouter>
      </QueryClientProvider>
    )
    await screen.findByText('GRR · Q3-2026')
    expect(getPage).toHaveBeenCalledWith('retention', { grain: 'quarter', window: 'ttm', scope: 'all', items: '3' })
  })
})
