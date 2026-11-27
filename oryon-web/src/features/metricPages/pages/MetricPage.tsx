import React, { useMemo, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { AppShell } from '../../../widgets/AppShell'
import { PAGE_BY_KEY, PageCfg } from '../config'
import { DetailBody, MetricView, viewQuery } from '../components/MetricView'

const DetailPanel: React.FC<{ cfg: PageCfg; period: string; query: Record<string, string>; onClose: () => void }> = ({ cfg, period, query, onClose }) => (
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
      <div className="p-5">
        <DetailBody cfg={cfg} period={period} query={query} />
      </div>
    </aside>
  </>
)

/** Full-screen page for one Oryon metric (/metrics/:page); the view lives in the URL. */
export const MetricPage: React.FC = () => {
  const { page = '' } = useParams()
  const cfg = PAGE_BY_KEY.get(page)
  const [params, setParams] = useSearchParams()
  const [period, setPeriod] = useState<string | null>(null)
  const query = useMemo(() => (cfg ? viewQuery(cfg, (k) => params.get(k)) : {}), [cfg, params])

  if (!cfg) {
    return (
      <AppShell title="Metric not found">
        <div className="card p-6 text-sm text-ink-2">Unknown metric page. <Link className="text-brand" to="/metrics">All metrics</Link></div>
      </AppShell>
    )
  }

  return (
    <AppShell title={cfg.title} subtitle={`${cfg.codes.join(' · ')} — ${cfg.subtitle}`}>
      <Link to="/metrics" className="text-sm text-brand hover:underline">← All metrics</Link>
      <MetricView
        cfg={cfg}
        query={query}
        onQuery={(k, v) => {
          const next = new URLSearchParams(params)
          next.set(k, v)
          setParams(next, { replace: true })
        }}
        onOpenDetail={setPeriod}
      />
      {period && <DetailPanel cfg={cfg} period={period} query={query} onClose={() => setPeriod(null)} />}
    </AppShell>
  )
}

export default MetricPage
