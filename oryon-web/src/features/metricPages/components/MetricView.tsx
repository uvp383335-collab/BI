/* eslint-disable @typescript-eslint/no-explicit-any */
import React, { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getMetricDetailRequest, getMetricPageRequest, getProductsRequest } from '../api/metricPagesApi'
import { MultiSelectDropdown } from '../../dashboard/components/MultiSelectDropdown'
import { SERIES } from './format'
import { PageCfg } from '../config'
import { DataTable, KpiRow, MetricChart, Row } from './Blocks'

const errText = (e: any) => e?.response?.data?.error?.message || e?.message || 'Request failed'

/** dashboard period ("2026-Q3" / "2026-09") -> the keys a page row can carry for it */
function periodKeys(p?: string | null): Set<string> {
  if (!p) return new Set()
  const q = /^(\d{4})-Q([1-4])$/.exec(p)
  if (q) {
    const end = `${q[1]}-${String(Number(q[2]) * 3).padStart(2, '0')}`
    return new Set([p, `Q${q[2]}-${q[1]}`, end])
  }
  return new Set([p])
}
const rowMatches = (r: Row, keys: Set<string>) =>
  keys.size > 0 && [r.month, r.m1, r.end, r.label, r.period].some((v) => typeof v === 'string' && keys.has(v))

/** The QuickBooks products, for the product filter (shared query: loaded once per session). */
export function useProducts() {
  return useQuery({ queryKey: ['oryon-products'], queryFn: getProductsRequest, staleTime: 5 * 60 * 1000 })
}

/** Product filter of one metric: pick QuickBooks products; none picked = all products. */
const ProductFilter: React.FC<{ value: string[]; onChange: (ids: string[]) => void }> = ({ value, onChange }) => {
  const { data } = useProducts()
  const products = (data?.products ?? []).filter((p) => p.lines > 0 || value.includes(p.id))
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm text-ink-2">
      Products
      <div className="min-w-[220px]">
        <MultiSelectDropdown
          options={products.map((p, i) => ({ id: p.id, label: p.name, color: SERIES[i % SERIES.length] }))}
          selectedIds={value}
          onToggle={(id) => onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id])}
          placeholder={products.length ? 'All products' : 'No QuickBooks products'}
          itemNounPlural="products"
        />
      </div>
      {value.length > 0 && (
        <button type="button" className="text-xs text-brand hover:underline" onClick={() => onChange([])}>
          All products
        </button>
      )}
    </div>
  )
}

/** The drill-down behind one row: summary cards and its tables (each with CSV). */
export const DetailBody: React.FC<{ cfg: PageCfg; period: string; query: Record<string, string> }> = ({ cfg, period, query }) => {
  const { data, isLoading, error } = useQuery({
    queryKey: ['metric-detail', cfg.page, period, query],
    queryFn: () => getMetricDetailRequest(cfg.page, { ...query, period })
  })
  return (
    <div className="flex flex-col gap-4">
      {isLoading && <p className="text-sm text-ink-3">Loading…</p>}
      {error && <p className="text-sm text-danger">{errText(error)}</p>}
      {data && (
        <>
          {cfg.detailSummary && <KpiRow kpis={cfg.detailSummary(data)} />}
          {(cfg.detail ?? []).map((s) => (
            <DataTable
              key={s.title}
              title={s.title}
              rows={s.rows(data) ?? []}
              columns={typeof s.columns === 'function' ? s.columns(data) : s.columns}
              csvName={`${cfg.page}_${s.title.toLowerCase().replace(/[^a-z0-9]+/g, '_')}_${period.replace(/\s+/g, '_')}.csv`}
              maxHeight={440}
            />
          ))}
        </>
      )}
    </div>
  )
}

/**
 * One Oryon metric — view switches, KPI cards, charts, table (CSV), drill-down and method — shown on the full
 * metric page and inside the portfolio metric drawer.
 *  - `query` / `onQuery`: the view; the full page keeps it in the URL, the drawer in local state.
 *  - `onOpenDetail`: the full page opens the drill-down in its own drawer; without it the drill-down opens in place with a Back button.
 *  - `highlight`: a dashboard period ("2026-Q3" / "2026-09") whose table row is highlighted.
 */
export const MetricView: React.FC<{
  cfg: PageCfg
  query: Record<string, string>
  onQuery: (key: string, value: string) => void
  onOpenDetail?: (period: string) => void
  highlight?: string | null
  compact?: boolean
}> = ({ cfg, query, onQuery, onOpenDetail, highlight, compact }) => {
  const [inlinePeriod, setInlinePeriod] = useState<string | null>(null)
  const { data, isLoading, error } = useQuery({
    queryKey: ['metric-page', cfg.page, query],
    queryFn: () => getMetricPageRequest(cfg.page, query)
  })
  const keys = useMemo(() => periodKeys(highlight), [highlight])

  if (inlinePeriod) {
    return (
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" className="rounded-md border border-line px-3 py-1.5 text-sm text-ink-2 hover:bg-surface-3" onClick={() => setInlinePeriod(null)}>
            ← Back
          </button>
          <h3 className="text-base font-semibold text-ink">{cfg.detailTitle?.(inlinePeriod) ?? inlinePeriod}</h3>
        </div>
        <DetailBody cfg={cfg} period={inlinePeriod} query={query} />
      </div>
    )
  }

  const rows: Row[] = data ? (cfg.rows ? cfg.rows(data) : data.rows ?? []) : []
  const columns = data ? (typeof cfg.columns === 'function' ? cfg.columns(data, query) : cfg.columns) : []
  const note = data && cfg.note ? cfg.note(data) : null
  const openDetail = onOpenDetail ?? setInlinePeriod

  const items = query.items ? query.items.split(',').filter(Boolean) : []
  return (
    <div className="flex flex-col gap-4">
      {(cfg.controls.length > 0 || cfg.productFilter !== undefined) && (
        <div className="flex flex-wrap items-center gap-3">
          {cfg.productFilter ? (
            <ProductFilter value={items} onChange={(ids) => onQuery('items', ids.join(','))} />
          ) : (
            <span className="text-xs text-ink-3" title="This metric comes from the P&L, the Balance Sheet or the CRM, which have no product breakdown.">
              Product filter: not available for this metric (company-wide)
            </span>
          )}
          {cfg.controls.map((c) => {
            const opts = typeof c.options === 'function' ? (data ? c.options(data) : [[c.default, c.default] as [string, string]]) : c.options
            return (
              <label key={c.key} className="flex items-center gap-2 text-sm text-ink-2">
                {c.label}
                <select className="form-input-dark" value={query[c.key]} onChange={(e) => onQuery(c.key, e.target.value)}>
                  {opts.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </label>
            )
          })}
        </div>
      )}
      {isLoading && <div className="card p-6 text-sm text-ink-3">Loading…</div>}
      {error && <div className="card p-6 text-sm text-danger">{errText(error)}</div>}
      {data && (
        <>
          {note && <div className="card border-l-4 p-4 text-sm text-ink-2" style={{ borderLeftColor: 'var(--watch)' }}>{note}</div>}
          {items.length > 0 && (
            <div className="card border-l-4 p-3 text-sm text-ink-2" style={{ borderLeftColor: 'var(--gold)' }}>
              Filtered to {items.length} product{items.length > 1 ? 's' : ''}: only those products&apos; invoice lines are counted (MRR, customers, cohorts and rankings are for those products only).
            </div>
          )}
          <KpiRow kpis={cfg.kpis(data, query)} />
          <div className={`grid gap-4 ${compact ? 'lg:grid-cols-2' : 'xl:grid-cols-2'}`}>
            {cfg.charts.map((c) => <MetricChart key={c.title} cfg={c} payload={data} rows={rows} />)}
          </div>
          <DataTable
            title="Table"
            rows={rows}
            columns={columns}
            csvName={`${cfg.page}_${Object.values(query).join('_') || 'all'}.csv`}
            onRow={cfg.period && cfg.detail ? (r) => { const p = cfg.period!(r); if (p) openDetail(p) } : undefined}
            rowClass={(r) => [r.complete === false || r.reliable === false ? 'opacity-60' : '', rowMatches(r, keys) ? 'bg-surface-3 font-semibold' : ''].join(' ')}
            maxHeight={compact ? 380 : 520}
          />
          <div className="card p-5">
            <h3 className="text-sm font-semibold text-ink">How it&apos;s calculated</h3>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-ink-2">
              {cfg.method.map((m) => <li key={m}>{m}</li>)}
            </ul>
            <p className="mt-2 text-xs text-ink-3">
              Same calculation as the reference Oryon app. Settings: Settings → Metric settings (Oryon). Greyed rows are incomplete or partial data
              {keys.size ? '; the highlighted row is the period selected on the dashboard' : ''}.
            </p>
          </div>
        </>
      )}
    </div>
  )
}

/** The view query of a page from a lookup (URL params or local state): each control's value, else its default. */
export function viewQuery(cfg: PageCfg, get: (key: string) => string | null | undefined): Record<string, string> {
  const q: Record<string, string> = {}
  for (const c of cfg.controls) q[c.key] = get(c.key) ?? c.default
  if (cfg.productFilter && get('items')) q.items = get('items')!
  return q
}
