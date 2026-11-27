import { Seg, Select, ProductPicker, productText } from './ui.jsx';
import { pLabel } from '../lib/format.js';

/** Portfolio page titles by route section. */
export const PAGES = [
  ['overview', 'Overview'], ['VC', 'Value creation'], ['CB', 'Capital & balance sheet'], ['CM', 'Customer & market'], ['alerts', 'Alerts'],
];
const off = 'Not available for this company yet';

export function TopBar({ meta, view, set, title }) {
  const M = view.gran === 'M';
  const cap = meta.capabilities || {};
  const asOfOpts = (M ? meta.months : meta.quarters).slice().reverse().map((p) => [p, pLabel(p)]);
  const chips = [];
  if (view.region !== 'All') chips.push(['Region', view.region]);
  if (view.segment !== 'All') chips.push(['Segment', view.segment]);
  if (view.product !== 'All') chips.push([view.product.length > 1 ? 'Comparing' : 'Product', productText(view.product)]);
  return (
    <header className="top">
      <div className="top-row">
        <div>
          <div className="crumb">{meta.company.name} · {pLabel(M ? view.month : view.quarter)}{M ? ' · monthly' : ''}{view.window === 'TTM' ? ' · TTM view' : ''}{view.units === 'abs' ? ' · dollars and counts' : ''}</div>
          <h1 className="pt">{title}</h1>
        </div>
        <div className="filters" role="group" aria-label="Period">
          <Select id="f-q" label="As of" options={asOfOpts} value={M ? view.month : view.quarter} onChange={(v) => set(M ? { month: v } : { quarter: v })} />
          <Seg id="f-units" label="Show values as" value={view.units} onChange={(units) => set({ units })} options={[['pct', '%', 'Show rates and percentages'], ['abs', '$ / #', 'Show dollars and counts']]} />
          <Seg id="f-gran" label="Granularity" value={view.gran} onChange={(gran) => set({ gran })} options={[['M', 'Monthly'], ['Q', 'Quarterly']]} />
          <Seg id="f-view" label="Window" value={view.window} onChange={(window) => set({ window })} options={[['P', M ? 'Month' : 'Quarter'], ['TTM', 'TTM']]} disabled={cap.ttm === false} title={cap.ttm === false ? off : undefined} />
          <Seg id="f-span" label="Timeline" value={view.span} onChange={(span) => set({ span })} options={[[4, '1Y'], [8, '2Y'], [12, '3Y']]} />
        </div>
      </div>
      <div className="top-row">
        <div className="filters" role="group" aria-label="Filters">
          <Select id="f-region" label="Region" options={[['All', 'All regions'], ...meta.regions.map((r) => [r, r])]} value={view.region} onChange={(region) => set({ region })} disabled={cap.region === false} title={cap.region === false ? off : undefined} />
          <Select id="f-segment" label="Segment" options={[['All', 'All segments'], ...meta.segments.map((r) => [r, r])]} value={view.segment} onChange={(segment) => set({ segment })} disabled={cap.segment === false} title={cap.segment === false ? off : undefined} />
          <ProductPicker products={meta.products} value={view.product} onChange={(product) => set({ product })} disabled={cap.product === false} title={cap.product === false ? 'Connect QuickBooks to filter by product' : undefined}
            single={cap.productMulti === false} hint={cap.productMulti === false ? 'One QuickBooks product at a time. Filters the invoice-based metrics (GRR / NRR, new logos, concentration, diversification); other cards stay company-wide. Each metric drawer has its own product filter too.' : undefined} />
          {(chips.length > 0) && <button type="button" className="reset" onClick={() => set({ region: 'All', segment: 'All', product: 'All' })}>Reset filters</button>}
        </div>
        <div className="chips">
          {chips.length ? chips.map(([k, v]) => <span className="chip" key={k}>{k}: <b>{v}</b></span>) : <span className="chip">All regions · all segments · all products</span>}
          {view.region !== 'All' && view.product !== 'All' && <span className="chip">P&amp;L uses product; QuickBooks can’t cross product with region</span>}
          {M && <span className="chip">Monthly view · quarterly metrics as of <b>{pLabel(view.quarter)}</b></span>}
        </div>
      </div>
    </header>
  );
}
