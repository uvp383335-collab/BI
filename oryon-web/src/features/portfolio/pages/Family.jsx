import Chart, { Legend } from '../components/Chart.jsx';
import { Pill, Scope, Loading, ErrorBox, productColor } from '../components/ui.jsx';
import { portfolioApi as api } from '../api/portfolioApi';
import { useAsync } from '../lib/useView.js';
import { fmt, dfmt, tone, pLabel, pShort, seriesColors } from '../lib/format.js';

const BLURB = {
  VC: 'The P&L: retention, growth, margins and unit economics. Cards marked Filtered respond to region, segment or product; the rest are company-wide.',
  CB: 'Cash, cash generation, working capital and currency exposure. Company-wide.',
  CM: 'Customers, competition, pipeline and marketing efficiency. NPS, concentration, win rate, marketing-sourced pipeline, funnel conversion and MQL volume respond to region and segment.',
  ER: 'What a buyer will test in diligence.',
};
const BAR = new Set(['VC-03', 'VC-13', 'CB-05', 'CM-08']);

/** value shown for a metric in the current units mode */
export const shown = (m, units) => (units === 'abs' && m.abs && m.abs.value != null ? { v: m.abs.value, u: m.abs.unit, label: m.abs.label } : { v: m.value, u: m.unit, label: m.win });

export default function Family({ companyId, meta, view, family, openMetric }) {
  const { data, error } = useAsync(() => api.family(family, view), [companyId, family, JSON.stringify(view)]);
  if (error) return <ErrorBox error={error} />;
  if (!data) return <Loading what="Loading metrics" />;
  const act = data.metrics.filter((m) => m.alert?.flag === 'Act now').length, wat = data.metrics.filter((m) => m.alert?.flag === 'Watch').length;
  const quarterly = data.metrics.filter((m) => m.quarterlyInMonthlyView).length;
  return (
    <>
      <div className="sec-h"><p>{BLURB[family]}</p></div>
      <div className="chips">
        <span className="chip"><b>{data.metrics.length}</b> metrics</span><span className="chip"><b>{act}</b> act now</span><span className="chip"><b>{wat}</b> watch</span>
        {data.view.monthly && quarterly > 0 && <span className="chip"><b>{quarterly}</b> reported quarterly · shown as of {pLabel(data.view.quarter)}</span>}
      </div>
      <section className="grid-m">{data.metrics.map((m) => <MetricCard key={m.id} m={m} meta={meta} view={view} onOpen={() => openMetric(m.id)} />)}</section>
    </>
  );
}

function MetricCard({ m, meta, view, onOpen }) {
  const SC = seriesColors();
  const s = shown(m, view.units);
  const useAbs = view.units === 'abs' && m.abs;
  const prev = useAbs ? m.prev.abs : m.prev.value;
  const ch = s.v == null || prev == null ? null : ['USD', 'count', 'USD/month'].includes(s.u) ? (prev ? s.v / prev - 1 : null) : s.v - prev;
  const comparing = view.product !== 'All' && view.product.length > 1 && m.filters.includes('P');
  const x = m.series.map((p) => pShort(p.period)), tl = m.series.map((p) => pLabel(p.period));
  return (
    <article className="card mc" tabIndex={0} role="button" aria-label={`Open ${m.name}`} onClick={onOpen} onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onOpen()}>
      <div className="t"><span className="id">{m.id}</span><span style={{ display: 'flex', gap: 6, alignItems: 'center' }}><Scope scope={m.scope} quarterly={m.quarterlyInMonthlyView} quarterLabel={pLabel(m.period)} /><Pill flag={m.alert?.flag} noData={m.value == null} /></span></div>
      <h3>{m.label}</h3>
      <div className="vv"><b>{fmt(s.v, s.u)}</b><span className={tone(ch, m.dir)}>{ch == null ? '' : `${dfmt(ch, s.u)} vs ${pShort(m.prev.period)}`}</span></div>
      <div className="win">{s.label}{useAbs && <> · <b style={{ color: 'var(--fg)', fontWeight: 500 }}>{fmt(m.value, m.unit)}</b></>}{m.immature ? ' · cohort still maturing' : ''}</div>
      <Chart x={x} tl={tl} h={150} sel={x.length - 1} label={`${m.name} trend`}
        thr={m.threshold != null && !useAbs && m.unit !== 'USD' ? [{ v: m.threshold, label: `${fmt(m.threshold, m.unit, { p: 0 })} threshold` }] : []}
        series={[{ n: useAbs ? m.abs.label : m.name, v: m.series.map((p) => (useAbs ? p.abs : p.value)), u: s.u, c: SC[0], type: useAbs || BAR.has(m.id) ? 'bar' : 'line', area: !useAbs && !BAR.has(m.id) }]} />
      {comparing && <div style={{ marginTop: 6 }}><Legend items={view.product.map((p) => [p, productColor(meta.products, p)])} /><p className="note" style={{ margin: '4px 0 0' }}>Combined value; open the card for each product.</p></div>}
      {m.subs.length > 0 && (
        <dl>{m.subs.slice(0, 4).map((x2) => <div key={x2.key}><dt>{x2.label}</dt><dd>{x2.value == null && x2.unit === 'months' && m.value != null ? 'Self-funding' : fmt(x2.value, x2.unit)}</dd></div>)}</dl>
      )}
      <div className="ft"><span>{meta.metrics.find((d) => d.id === m.id)?.source}</span><span>Details →</span></div>
    </article>
  );
}
