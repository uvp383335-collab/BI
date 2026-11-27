import { useEffect, useState } from 'react';
import Chart, { Legend } from './Chart.jsx';
import { Pill, Scope, Seg, Loading, ErrorBox, productColor } from './ui.jsx';
import { portfolioApi as api } from '../api/portfolioApi';
import { useAsync } from '../lib/useView.js';
import { fmt, dfmt, tone, pLabel, pShort, seriesColors } from '../lib/format.js';
import { shown } from '../pages/Family.jsx';
import { Link } from 'react-router-dom';
import { PAGE_FOR_METRIC } from '../../metricPages/config';
import { DrawerMetric } from '../../metricPages/components/DrawerMetric';
import { MetricAnalyzeButton } from '../../aiAnalysis/components/MetricAnalyzeButton';

const FAMILY_NAMES = { VC: 'Value creation', CB: 'Capital & balance sheet', CM: 'Customer & market', ER: 'Exit readiness' };

/**
 * Metric detail drawer: headline and alert, then — for every metric that has an Oryon metric page — that page's full
 * view (view switches, KPIs, charts, table with CSV, drill-downs, method); other metrics keep the trend, split and
 * detail table. Definition and alert history at the end.
 */
export default function Drawer({ companyId, meta, view, metricId, onClose }) {
  const { data, error } = useAsync(() => api.metric(metricId, view), [companyId, metricId, JSON.stringify(view)]);
  const [dim, setDim] = useState(null);
  useEffect(() => {
    const k = (e) => e.key === 'Escape' && onClose();
    addEventListener('keydown', k);
    return () => removeEventListener('keydown', k);
  }, [onClose]);
  useEffect(() => { setDim(null); }, [metricId]);
  const SC = seriesColors();
  const page = PAGE_FOR_METRIC[metricId];
  let body;
  if (error) body = <ErrorBox error={error} />;
  else if (!data) body = <Loading />;
  else {
    const s = shown(data, view.units);
    const useAbs = view.units === 'abs' && data.abs;
    const prev = useAbs ? data.prev.abs : data.prev.value;
    const ch = s.v == null || prev == null ? null : ['USD', 'count', 'USD/month'].includes(s.u) ? (prev ? s.v / prev - 1 : null) : s.v - prev;
    const x = data.series.map((p) => pShort(p.period)), tl = data.series.map((p) => pLabel(p.period));
    const comparing = view.product !== 'All' && view.product.length > 1 && data.filters.includes('P');
    const split = data.splits?.find((sp) => sp.dim === (dim || (comparing ? 'product' : data.splits[0]?.dim))) || null;
    const col = (k, j) => (split?.dim === 'product' ? productColor(meta.products, k) : SC[j % 6]);
    body = (
      <>
        <div className="dr-v"><b>{fmt(s.v, s.u)}</b><span className={tone(ch, data.dir)}>{ch == null ? '' : `${dfmt(ch, s.u)} vs ${pLabel(data.prev.period)}`}</span>{useAbs && <span className="note">{s.label} · {fmt(data.value, data.unit)}</span>}</div>
        {data.alert && <div className="card" style={{ padding: '12px 14px' }}><b>{data.alert.flag}:</b> {data.alert.why}.</div>}
        {data.quarterlyInMonthlyView && <div className="card" style={{ padding: '10px 14px', color: 'var(--muted)' }}>This metric reports by quarter, so the monthly view shows the latest completed quarter ({pLabel(data.period)}).</div>}
        {page ? <DrawerMetric key={page} page={page} highlight={data.period} globalProducts={view.product} /> : (<>
        <div className="card">
          <div className="card-h"><div><h3>Trend</h3><p>{data.series.length} {data.period.includes('Q') ? 'quarters' : 'months'} to {pLabel(data.period)}</p></div></div>
          <Chart x={x} tl={tl} h={240} sel={x.length - 1} label={`${data.name} trend`}
            thr={data.threshold != null && !useAbs && data.unit !== 'USD' ? [{ v: data.threshold, label: `${fmt(data.threshold, data.unit, { p: 0 })} threshold` }] : []}
            series={[{ n: useAbs ? data.abs.label : data.name, v: data.series.map((p) => (useAbs ? p.abs : p.value)), u: s.u, c: SC[0], area: !useAbs, type: useAbs ? 'bar' : 'line' }]} />
        </div>
        {split && (
          <div className="card">
            <div className="card-h">
              <div><h3>By {split.dim}</h3><p>Same measure for each {split.dim === 'segment' ? 'customer segment' : split.dim}{split.dim === 'product' ? ' (company-wide)' : ''}</p></div>
              {data.splits.length > 1 && <Seg id="dr-dim" label="Split by" value={split.dim} onChange={setDim} options={data.splits.map((sp) => [sp.dim, sp.dim[0].toUpperCase() + sp.dim.slice(1)])} />}
            </div>
            <Legend items={split.values.map((v, j) => [v.key, col(v.key, j)])} />
            <Chart x={x} tl={tl} h={230} sel={x.length - 1} label={`${data.name} by ${split.dim}`} thr={data.threshold != null && data.unit === '%' ? [{ v: data.threshold }] : []}
              series={split.values.map((v, j) => ({ n: v.key, v: v.series.map((p) => p.value), u: data.unit, c: col(v.key, j), w: 1.8 }))} />
          </div>
        )}
        </>)}
        <div className="meta"><div><small>Definition</small>{data.definition}</div><div><small>Data source</small>{data.source}</div><div><small>Threshold</small>{data.threshold != null ? fmt(data.threshold, data.unit, { p: 0 }) : 'Set per firm in Oryon AI settings'}</div></div>
        {!page && (
          <div className="card">
          <div className="card-h"><div><h3>Detail by quarter</h3><p>Company-wide values for every view of this metric</p></div></div>
          <div className="tw"><table className="t">
            <thead><tr><th>Series</th>{data.detail.periods.map((q) => <th className="n" key={q}>{pShort(q)}</th>)}</tr></thead>
            <tbody>{data.detail.rows.map((r) => <tr key={r.key}><td>{r.label}</td>{r.values.map((v, i) => <td className="n" key={i}>{v == null && r.unit === 'months' && data.detail.rows[0].values[i] != null ? 'Self-funding' : fmt(v, r.unit)}</td>)}</tr>)}</tbody>
          </table></div>
        </div>
        )}
        <div className="card">
          <div className="card-h"><div><h3>Alert history</h3><p>{data.alertHistory.length ? `${data.alertHistory.length} flags in the last three years` : 'No flags in the last three years'}</p></div></div>
          <ul className="hist">{data.alertHistory.slice().reverse().map((a) => <li key={a.period}><span className="q">{pLabel(a.period)}</span><Pill flag={a.flag} /><span>{a.why}</span></li>)}</ul>
        </div>
      </>
    );
  }
  return (
    <>
      <div className="scrim" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-modal="true" aria-labelledby="dr-t" style={page ? { width: 'min(1240px, 94vw)' } : undefined}>
        <div className="dr-h">
          <div>
            <div className="crumb">{metricId} · {FAMILY_NAMES[meta.metrics.find((m) => m.id === metricId)?.family]}</div>
            <h2 id="dr-t">{data?.label || meta.metrics.find((m) => m.id === metricId)?.name}</h2>
            {PAGE_FOR_METRIC[metricId] && <Link to={`/metrics/${PAGE_FOR_METRIC[metricId]}`} className="note" style={{ color: 'var(--gold)', display: 'inline-block', marginBottom: 6 }}>Open as a full page →</Link>}
            {data && <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}><Pill flag={data.alert?.flag} noData={data.value == null} /><Scope scope={data.scope} quarterly={data.quarterlyInMonthlyView} quarterLabel={pLabel(data.period)} /><span className="note">{pLabel(data.period)} · {data.win}</span></div>}
          </div>
          <div className="dr-acts">
            <MetricAnalyzeButton metricId={metricId} metricName={data?.label || meta.metrics.find((m) => m.id === metricId)?.name || metricId} view={view} sources={meta.sources} />
            <button type="button" className="x" onClick={onClose} aria-label="Close"><svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M2 2l10 10M12 2L2 12" stroke="currentColor" strokeWidth="1.6" fill="none" /></svg></button>
          </div>
        </div>
        {body}
      </aside>
    </>
  );
}
