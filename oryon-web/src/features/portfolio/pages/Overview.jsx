import { Fragment, useState } from 'react';
import { Link } from 'react-router-dom';
import Chart, { Legend } from '../components/Chart.jsx';
import { Card, Seg, Pill, Loading, ErrorBox, productColor, productText } from '../components/ui.jsx';
import { portfolioApi as api } from '../api/portfolioApi';
import { useAsync } from '../lib/useView.js';
import { fmt, dfmt, tone, pLabel, pShort, cssv, seriesColors } from '../lib/format.js';

const FAMILY_NAMES = { VC: 'Value creation', CB: 'Capital & balance sheet', CM: 'Customer & market', ER: 'Exit readiness' };
const COMPARE = [['revenue', 'Revenue', 'USD'], ['grossProfit', 'Gross profit', 'USD'], ['grossMargin', 'Gross margin', '%'], ['growth', 'Growth YoY', '%'], ['mix', 'Share of revenue', '%']];

export default function Overview({ companyId, meta, view, set, openMetric }) {
  const [breakdown, setBreakdown] = useState('Product');
  const [tbl, setTbl] = useState('Segment');
  const [compareOn, setCompareOn] = useState('revenue');
  const { data, error, loading } = useAsync(
    () => api.overview(view, { breakdown, breakdownBy: tbl, compareOn }),
    [companyId, JSON.stringify(view), breakdown, tbl, compareOn],
  );
  if (error) return <ErrorBox error={error} />;
  if (!data) return <Loading what="Loading overview" />;
  const SC = seriesColors();
  const P = data.charts.periods;
  const x = P.map((p) => p.label), tl = P.map((p) => p.long), sel = P.length - 1;
  const M = data.view.monthly, ttm = data.view.window === 'TTM';
  const per = ttm ? `Trailing twelve months${M ? ', rolling monthly' : ''}` : M ? 'By month' : 'By quarter';
  const rv = data.charts.revenue;
  const dims = breakdown === 'Product' ? rv.stacks.map((s) => s.key) : meta.regions;
  const byRegion = meta.regions.length > 0;

  return (
    <div style={{ opacity: loading ? 0.6 : 1, transition: 'opacity .15s', display: 'flex', flexDirection: 'column', gap: 16 }}>
      <section className="grid-k" aria-label="Headline figures">
        {data.kpis.map((k) => (
          <button type="button" className="kpi" key={k.key} onClick={() => openMetric(k.metricId)}>
            <div className="lb"><span>{k.label}</span></div>
            <div className="v">{fmt(k.value, k.unit)}</div>
            <div className={`d ${tone(k.delta, k.dir)}`}>{k.delta == null ? '' : <>{dfmt(k.delta, k.unit)} <span className="fl">vs {pShort(k.series.at(-2)?.period)}</span></>}</div>
            {k.sub && <div className="d fl">{k.sub}</div>}
            <Chart mini h={34} x={k.series.map((s) => pShort(s.period))} series={[{ n: k.label, v: k.series.map((s) => s.value), u: k.unit, c: SC[0], area: true, w: 1.6 }]} sel={k.series.length - 1} />
          </button>
        ))}
      </section>

      <section className="row2">
        <div className="card read" aria-labelledby="read-t">
          <div className="read-h"><h3 id="read-t">The read</h3><span className="ai">ORYON AI</span><span className="note">{pLabel(data.view.quarter)} · company-wide</span></div>
          <ol>
            {data.read.items.map((r, i) => (
              <li key={i}><Pill flag={r.flag} />
                <div>
                  <p className="hd">{r.headline}</p>
                  {r.body && <p className="bd">{r.body}</p>}
                  {r.nextStep && <p className="ac"><b>NEXT STEP</b>{r.nextStep}</p>}
                  <div className="links">{(r.ids || []).map((id) => <button type="button" className="lk" key={id} onClick={() => openMetric(id)}>{id} {meta.metrics.find((m) => m.id === id)?.name}</button>)}</div>
                </div>
              </li>
            ))}
          </ol>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
          <Card title="Health by area" sub={`Flags raised in ${pLabel(data.view.quarter)} across the ${meta.metrics.length} metrics`}>
            <div className="fam">
              {data.health.map((h) => {
                const nd = h.noData || 0;
                const ok = h.metrics - h.actNow - h.watch - nd;
                return (
                  <Link className="famc" key={h.family} to={`/portfolio/${h.family}`}>
                    <h4>{h.name}</h4>
                    <div className="bar"><span style={{ width: `${(h.actNow / h.metrics) * 100}%`, background: 'var(--bad)' }} /><span style={{ width: `${(h.watch / h.metrics) * 100}%`, background: 'var(--watch)' }} /><span style={{ width: `${(ok / h.metrics) * 100}%`, background: 'var(--good)', opacity: 0.55 }} /></div>
                    <div className="nums"><span><b>{h.actNow}</b> act now</span><span><b>{h.watch}</b> watch</span><span><b>{ok}</b> on track</span>{nd > 0 && <span><b>{nd}</b> no data</span>}</div>
                  </Link>
                );
              })}
            </div>
          </Card>
          <Card title="Retention" sub="Monthly recurring-revenue cohorts, customer-level" right={view.region !== 'All' || view.segment !== 'All' ? <span className="scope f">Filtered</span> : null}>
            <Legend items={[['NRR', SC[1]], ['GRR', SC[0]], ['Benchmarks 90% / 100%', '', 'dash']]} />
            <Chart x={x} tl={tl} h={188} sel={sel} label="Retention trend" thr={[{ v: 100 }, { v: 90 }]}
              series={[{ n: 'NRR', v: data.charts.retention.nrr, u: '%', c: SC[1] }, { n: 'GRR', v: data.charts.retention.grr, u: '%', c: SC[0] }]} />
          </Card>
        </div>
      </section>

      <section className="grid-c">
        <Card title="Revenue and gross margin" sub={`${per} · bars by ${breakdown.toLowerCase()}, line is gross margin`}
          right={byRegion ? <Seg id="bd" label="Break down by" value={breakdown} onChange={setBreakdown} options={[['Product', 'Product'], ['Region', 'Region']]} /> : null}>
          <Legend items={[...rv.stacks.map((s) => [s.key, SC[Math.max(0, dims.indexOf(s.key)) % 6]]), ['Gross margin', cssv('--fg')]]} />
          <Chart x={x} tl={tl} h={230} sel={sel} label="Revenue and gross margin"
            series={[...rv.stacks.map((s) => ({ n: s.key, v: s.values, u: 'USD', c: SC[Math.max(0, dims.indexOf(s.key)) % 6], type: 'bar', stack: true })), { n: 'Gross margin', v: rv.grossMargin, u: '%', c: cssv('--fg'), axis: 'r', w: 1.6 }]} />
        </Card>
        <Card title="New business" sub={`${per} · new-logo revenue and win rate`}>
          <Legend items={[['New-logo revenue', SC[0]], ['Win rate', SC[1]]]} />
          <Chart x={x} tl={tl} h={230} sel={sel} label="New business"
            series={[{ n: 'New-logo revenue', v: data.charts.newBusiness.arr, u: 'USD', c: SC[0], type: 'bar' }, { n: 'Win rate', v: data.charts.newBusiness.winRate, u: '%', c: SC[1], axis: 'r' }]} />
        </Card>
        <Card title="ARR" sub={`Annualized recurring revenue at ${M ? 'month' : 'quarter'} end (MRR × 12)`}>
          <Legend items={[['ARR', SC[0]], ['Active customers', SC[2]]]} />
          <Chart x={x} tl={tl} h={210} sel={sel} label="ARR"
            series={[{ n: 'ARR', v: data.charts.arr.arr, u: 'USD', c: SC[0], area: true }, { n: 'Active customers', v: data.charts.arr.customers, u: 'count', c: SC[2], axis: 'r', dash: true, w: 1.5 }]} />
        </Card>
        <Card title="Profitability" sub={`${per} · EBITDA and margin`} right={<span className="scope c">Company</span>}>
          <Legend items={[['EBITDA', SC[3]], ['EBITDA margin', SC[1]]]} />
          <Chart x={x} tl={tl} h={210} sel={sel} label="Profitability"
            series={[{ n: 'EBITDA', v: data.charts.profitability.ebitda, u: 'USD', c: SC[3], type: 'bar' }, { n: 'EBITDA margin', v: data.charts.profitability.margin, u: '%', c: SC[1], axis: 'r' }]} />
        </Card>
      </section>

      {data.productComparison.products.length > 0 && <ProductComparison pc={data.productComparison} meta={meta} view={view} x={x} tl={tl} on={compareOn} setOn={setCompareOn} per={per} />}

      {data.breakdown.rows.length > 0 && <Card title="Breakdown" sub={`${pLabel(data.view.asOf)} by ${tbl.toLowerCase()} · ARR at period end, customers and retention at ${pLabel(data.breakdown.retentionAsOf)} end, new business ${ttm ? 'over the trailing twelve months' : `in the ${M ? 'month' : 'quarter'}`}. Click a row to filter.`}
        right={<Seg id="tb" label="Breakdown by" value={tbl} onChange={setTbl} options={[['Segment', 'Segment'], ['Region', 'Region']]} />}>
        <div className="tw">
          <table className="t">
            <thead><tr><th>{tbl}</th><th className="n">ARR</th><th className="n">vs prior</th><th className="n">Customers</th><th className="n">{view.units === 'abs' ? 'Lost ARR TTM' : 'GRR TTM'}</th><th className="n">{view.units === 'abs' ? 'Net ARR change TTM' : 'NRR TTM'}</th><th className="n">New ARR</th><th className="n">New logos</th><th className="n">Win rate</th></tr></thead>
            <tbody>
              {data.breakdown.rows.map((r) => (
                <tr key={r.key} className="click" onClick={() => set(tbl === 'Segment' ? { segment: r.key } : { region: r.key })}>
                  <td>{r.key}</td><td className="n">{fmt(r.arr, 'USD')}</td><td className={`n ${tone(r.arrChange, 'up')}`}>{dfmt(r.arrChange, 'USD')}</td><td className="n">{fmt(r.customers, 'count')}</td>
                  <td className="n">{view.units === 'abs' ? fmt(r.lostArr, 'USD') : fmt(r.grr, '%')}</td><td className="n">{view.units === 'abs' ? fmt(r.netArrChange, 'USD') : fmt(r.nrr, '%')}</td>
                  <td className="n">{fmt(r.newArr, 'USD')}</td><td className="n">{r.newLogos}</td><td className="n">{fmt(r.winRate, '%', { p: 0 })}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>}

      <AlertMap map={data.alertMap} openMetric={openMetric} />
    </div>
  );
}

function ProductComparison({ pc, meta, view, x, tl, on, setOn, per }) {
  const k = COMPARE.find((c) => c[0] === on) || COMPARE[0];
  const vals = pc.series.flatMap((s) => s.values).filter((v) => v != null);
  const yd = ['revenue', 'grossProfit', 'mix'].includes(on) && vals.length && Math.min(...vals) >= 0 ? [0, Math.max(...vals) * 1.08] : null;
  const pctf = (v) => (v == null ? '–' : `${v >= 0 ? '+' : ''}${(100 * v).toFixed(1)}%`);
  const row = (r, label, dot, bold) => {
    const B = ({ children }) => (bold ? <b>{children}</b> : children);
    return (
      <tr key={label}>
        <td>{dot && <i className="dot" style={{ background: productColor(pc.products, r.key) }} />}<B>{label}</B></td>
        <td className="n"><B>{fmt(r.revenue, 'USD')}</B></td><td className={`n ${tone(r.vsPrior, 'up')}`}>{pctf(r.vsPrior)}</td>
        <td className={`n ${tone(r.yoy, 'up')}`}>{r.yoy == null ? '–' : `${r.yoy >= 0 ? '+' : ''}${r.yoy.toFixed(1)}%`}</td>
        <td className="n">{fmt(r.grossProfit, 'USD')}</td><td className="n">{fmt(r.grossMargin, '%')}</td>
        <td className={`n ${tone(r.gmVsPrior == null ? null : Math.round(r.gmVsPrior * 10) / 10, 'up')}`}>{r.gmVsPrior == null ? '–' : dfmt(Math.round(r.gmVsPrior * 10) / 10 || 0, '%')}</td>
        <td className="n">{fmt(r.share, '%')}</td>
      </tr>
    );
  };
  return (
    <Card title="Product comparison" sub={`${per} · ${'all product lines'}`}
      right={<><span className="scope c" title="Product P&L is company-wide; QuickBooks can’t cross product with region">Product P&amp;L</span><Seg id="pcm" label="Compare on" value={on} onChange={setOn} options={COMPARE.map(([v, l]) => [v, l])} /></>}>
      <Legend items={pc.products.map((p) => [p, productColor(pc.products, p)])} />
      <Chart x={x} tl={tl} h={230} sel={x.length - 1} yd={yd} thr={on === 'growth' ? [{ v: 0 }] : []} label={`Product comparison, ${k[1]}`}
        series={pc.series.map((s) => ({ n: s.key, v: s.values, u: k[2], c: productColor(pc.products, s.key), w: 2 }))} />
      <div className="tw" style={{ marginTop: 12 }}>
        <table className="t">
          <thead><tr><th>Product · {pLabel(view.gran === 'M' ? view.month : view.quarter)}{view.window === 'TTM' ? ' TTM' : ''}</th><th className="n">Revenue</th><th className="n">vs prior</th><th className="n">YoY</th><th className="n">Gross profit</th><th className="n">Gross margin</th><th className="n">GM vs prior</th><th className="n">Share of revenue</th></tr></thead>
          <tbody>
            {pc.rows.filter(Boolean).map((r) => row(r, r.key, true, false))}
            {pc.selectedTotal && row(pc.selectedTotal, 'All product lines (before unallocated COGS)', false, true)}
            {pc.company && <tr><td style={{ color: 'var(--muted)' }}>Company, incl. unallocated COGS</td><td className="n">{fmt(pc.company.revenue, 'USD')}</td><td /><td /><td className="n">{fmt(pc.company.grossProfit, 'USD')}</td><td className="n">{fmt(pc.company.grossMargin, '%')}</td><td /><td className="n">100%</td></tr>}
          </tbody>
        </table>
      </div>
      {pc.ignoresFilters && <p className="note" style={{ margin: '8px 0 0' }}>The product filter doesn’t apply here: this compares QuickBooks product lines (classes) company-wide.</p>}
    </Card>
  );
}

export function AlertMap({ map, openMetric }) {
  return (
    <Card title="Alert map" sub="Every metric by quarter. Red is act now, amber is watch. Click a row for detail."
      right={<Legend items={[['Act now', cssv('--bad')], ['Watch', cssv('--watch')], ['On track', cssv('--raise')]]} />}>
      <div className="hm-wrap">
        <table className="hm">
          <thead><tr><th className="rh">Metric</th>{map.quarters.map((q) => <th key={q}>{pShort(q)}</th>)}</tr></thead>
          <tbody>
            {map.rows.map((r, i) => (
              <Fragment key={r.id}>
                {(i === 0 || map.rows[i - 1].family !== r.family) && <tr className="fam"><td colSpan={map.quarters.length + 1}>{FAMILY_NAMES[r.family]}</td></tr>}
                <tr>
                  <td className="nm" onClick={() => openMetric(r.id)}><b>{r.id}</b>{r.name}</td>
                  {r.cells.map((c, j) => <td key={j} className={`c ${c ? (c.flag === 'Act now' ? 'act' : 'wat') : ''}`} title={c ? `${c.flag}: ${c.why}` : 'On track'} onClick={() => openMetric(r.id)} />)}
                </tr>
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

export { productText };
