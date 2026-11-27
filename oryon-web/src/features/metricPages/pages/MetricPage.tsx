/* eslint-disable @typescript-eslint/no-explicit-any */
import React, { useMemo, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { AppShell } from '../../../widgets/AppShell'
import { getMetricDetailRequest, getMetricPageRequest } from '../api/metricPagesApi'
import { PAGE_BY_KEY, PageCfg } from '../config'
import { DataTable, KpiRow, MetricChart, Row } from '../components/Blocks'

/** The view query of a page: each control's value from the URL, else its default. */
function viewQuery(cfg: PageCfg, params: URLSearchParams): Record<string, string> {
  const q: Record<string, string> = {}
  for (const c of cfg.controls) q[c.key] = params.get(c.key) ?? c.default
  return q
}

const errText = (e: any) => e?.response?.data?.error?.message || e?.message || 'Request failed'

const DetailPanel: React.FC<{ cfg: PageCfg; period: string; query: Record<string, string>; onClose: () => void }> = ({ cfg, period, query, onClose }) => {
  const { data, isLoading, error } = useQuery({
    queryKey: ['metric-detail', cfg.page, period, query],
    queryFn: () => getMetricDetailRequest(cfg.page, { ...query, period })
  })
  return (
    <>
      <div className="scrim" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-modal="true" aria-label={cfg.detailTitle?.(period) ?? period} style={{ width: 'min(1100px, 96vw)' }}>
        <div className="dr-h">
          <div>
            <div className="crumb">{cfg.codes.join(' · ')} · {cfg.title}</div>
            <h2>{cfg.detailTitle?.(period) ?? period}</h2>
          </div>
          <button type="button" className="x" onClick={onClose} aria-label="Close">
            <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M2 2l10 10M12 2L2 12" stroke="currentColor" strokeWidth="1.6" fill="none" /></svg>
          </button>
        </div>
        <div className="flex flex-col gap-4 p-5">
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
      </aside>
    </>
  )
}

export const MetricPage: React.FC = () => {
  const { page = '' } = useParams()
  const cfg = PAGE_BY_KEY.get(page)
  const [params, setParams] = useSearchParams()
  const [period, setPeriod] = useState<string | null>(null)
  const query = useMemo(() => (cfg ? viewQuery(cfg, params) : {}), [cfg, params])
  const { data, isLoading, error } = useQuery({
    queryKey: ['metric-page', page, query],
    queryFn: () => getMetricPageRequest(page, query),
    enabled: !!cfg
  })

  if (!cfg) {
    return (
      <AppShell title="Metric not found">
        <div className="card p-6 text-sm text-ink-2">Unknown metric page. <Link className="text-brand" to="/metrics">All metrics</Link></div>
      </AppShell>
    )
  }

  const rows: Row[] = data ? (cfg.rows ? cfg.rows(data) : data.rows ?? []) : []
  const columns = data ? (typeof cfg.columns === 'function' ? cfg.columns(data, query) : cfg.columns) : []
  const note = data && cfg.note ? cfg.note(data) : null

  return (
    <AppShell title={cfg.title} subtitle={`${cfg.codes.join(' · ')} — ${cfg.subtitle}`}>
      <div className="flex flex-wrap items-center gap-3">
        <Link to="/metrics" className="text-sm text-brand hover:underline">← All metrics</Link>
        {cfg.controls.map((c) => {
          const opts = typeof c.options === 'function' ? (data ? c.options(data) : [[c.default, c.default] as [string, string]]) : c.options
          return (
            <label key={c.key} className="flex items-center gap-2 text-sm text-ink-2">
              {c.label}
              <select
                className="form-input-dark"
                value={query[c.key]}
                onChange={(e) => {
                  const next = new URLSearchParams(params)
                  next.set(c.key, e.target.value)
                  setParams(next, { replace: true })
                }}
              >
                {opts.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </label>
          )
        })}
      </div>

      {isLoading && <div className="card p-6 text-sm text-ink-3">Loading…</div>}
      {error && <div className="card p-6 text-sm text-danger">{errText(error)}</div>}
      {data && (
        <>
          {note && <div className="card border-l-4 p-4 text-sm text-ink-2" style={{ borderLeftColor: 'var(--watch)' }}>{note}</div>}
          <KpiRow kpis={cfg.kpis(data, query)} />
          <div className="grid gap-4 xl:grid-cols-2">
            {cfg.charts.map((c) => <MetricChart key={c.title} cfg={c} payload={data} rows={rows} />)}
          </div>
          <DataTable
            title="Table"
            rows={rows}
            columns={columns}
            csvName={`${cfg.page}_${Object.values(query).join('_') || 'all'}.csv`}
            onRow={cfg.period && cfg.detail ? (r) => { const p = cfg.period!(r); if (p) setPeriod(p) } : undefined}
            rowClass={(r) => (r.complete === false || r.reliable === false ? 'opacity-60' : '')}
          />
          <div className="card p-5">
            <h3 className="text-sm font-semibold text-ink">How it&apos;s calculated</h3>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-ink-2">
              {cfg.method.map((m) => <li key={m}>{m}</li>)}
            </ul>
            <p className="mt-2 text-xs text-ink-3">Same calculation as the reference Oryon app. Settings: Settings → Metric settings (Oryon). Greyed rows are incomplete or partial data.</p>
          </div>
        </>
      )}
      {period && <DetailPanel cfg={cfg} period={period} query={query} onClose={() => setPeriod(null)} />}
    </AppShell>
  )
}

export default MetricPage
