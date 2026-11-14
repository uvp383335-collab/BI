import { useEffect, useRef } from 'react';
import { select, pointer } from 'd3-selection';
import { scaleLinear, scaleBand } from 'd3-scale';
import { line as d3line, area as d3area } from 'd3-shape';
import { min, max, sum } from 'd3-array';
import { format } from 'd3-format';
import { fmt, cssv } from '../lib/format.js';

/**
 * One chart component for every chart in the app (bars, stacked bars, lines, areas, dual axis,
 * reference lines, hover tooltip). Drawn with d3 into an SVG; redraws on resize and theme change.
 *
 * props:
 *   x       string[]            short labels for the x axis
 *   tl      string[]            long labels for the tooltip (optional)
 *   series  [{ n: name, v: number[], u: unit, c: color, type?: 'bar'|'line', stack?, axis?: 'r', area?, dash?, w? }]
 *   thr     [{ v, label?, axis? }] reference lines
 *   h       height (px); mini: sparkline mode; sel: highlighted index; yd: fixed y domain
 */
export default function Chart({ x, tl, series, thr = [], h = 200, mini = false, sel = null, yd = null, label = 'Chart', nz = false }) {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const draw = () => render(el, { x, tl, series, thr, h, mini, sel, yd, label, nz });
    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(el);
    const mo = new MutationObserver(draw);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => { ro.disconnect(); mo.disconnect(); };
  }, [x, tl, series, thr, h, mini, sel, yd, label, nz]);
  // No value anywhere (e.g. the source system isn't connected): say so instead of drawing empty axes.
  const empty = !series.some((s) => s.v.some((v) => v != null && Number.isFinite(v)));
  if (empty) return mini ? <div className="sp" /> : <div className="ch-empty" style={{ height: h }}>No data for this period yet</div>;
  return <div className={mini ? 'sp' : 'ch'} ref={ref} />;
}

const cmp = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

function render(el, o) {
  el.innerHTML = '';
  const W = Math.max(260, el.clientWidth), H = o.h;
  const labels = o.x, sc = o.series.filter(Boolean);
  if (!labels?.length) return;
  const lU = sc.find((s) => s.axis !== 'r')?.u, rU = sc.find((s) => s.axis === 'r')?.u;
  const mt = o.mini ? 4 : 10, mb = o.mini ? 4 : 24;
  const vals = (right) => sc.filter((s) => (s.axis === 'r') === right).flatMap((s) => (s.stack ? [] : s.v)).filter((v) => v != null && Number.isFinite(v));
  const lv = vals(false);
  const stk = sc.filter((s) => s.stack);
  if (stk.length) labels.forEach((_, i) => lv.push(sum(stk, (s) => s.v[i] || 0)));
  o.thr.filter((t) => t.axis !== 'r').forEach((t) => lv.push(t.v));
  const rv = vals(true); o.thr.filter((t) => t.axis === 'r').forEach((t) => rv.push(t.v));
  const dom = (v, zero) => {
    if (!v.length) return [0, 1];
    let a = min(v), b = max(v);
    if (zero) { a = Math.min(0, a); b = Math.max(0, b); }
    const p = (b - a) * 0.1 || Math.abs(b) * 0.1 || 1;
    return [zero ? a : a - p, b + p];
  };
  const yl = scaleLinear(o.yd || dom(lv, !o.nz && (stk.length > 0 || sc.some((s) => s.type === 'bar' && s.axis !== 'r'))), [H - mb, mt]).nice(4);
  const yr = scaleLinear(dom(rv, false), [H - mb, mt]).nice(4);
  const tf = (u, tk) => (v) => (u === 'USD' ? `${v < 0 ? '-$' : '$'}${cmp.format(Math.abs(v))}` : u === '%' ? `${format(tk && tk.length > 1 && Math.abs(tk[1] - tk[0]) < 1 ? '.1f' : '.0f')(v)}%` : u === 'x' ? `${format('.1f')(v)}x` : u === 'count' ? cmp.format(v) : format('.0f')(v));
  const lt = yl.ticks(o.mini ? 2 : 4), rt = rU ? yr.ticks(4) : [];
  const meas = (a) => Math.max(0, ...a.map((s) => s.length)) * 6.6 + 10;
  const ml = o.mini ? 2 : meas(lt.map(tf(lU, lt))), mr = o.mini ? 2 : rU ? meas(rt.map(tf(rU, rt))) : 10;
  const xs = scaleBand(labels.map((_, i) => i), [ml, W - mr]).paddingInner(0.28).paddingOuter(0.12);
  const cx = (i) => xs(i) + xs.bandwidth() / 2;
  const svg = select(el).append('svg').attr('width', '100%').attr('height', H).attr('viewBox', `0 0 ${W} ${H}`).attr('role', 'img').attr('aria-label', o.label);
  if (!o.mini) {
    svg.append('g').selectAll('line').data(lt).join('line').attr('x1', ml).attr('x2', W - mr).attr('y1', (d) => yl(d)).attr('y2', (d) => yl(d)).attr('stroke', cssv('--grid'));
    svg.append('g').selectAll('text').data(lt).join('text').attr('x', ml - 8).attr('y', (d) => yl(d) + 3.5).attr('text-anchor', 'end').text(tf(lU, lt));
    if (rU) svg.append('g').selectAll('text').data(rt).join('text').attr('x', W - mr + 8).attr('y', (d) => yr(d) + 3.5).text(tf(rU, rt));
    const every = Math.ceil(labels.length / (W < 420 ? 4 : 8));
    svg.append('g').selectAll('text').data(labels).join('text').attr('x', (d, i) => cx(i)).attr('y', H - 6).attr('text-anchor', 'middle')
      .text((d, i) => { const last = labels.length - 1; return i === last || (i % every === 0 && last - i >= every) ? d : ''; });
  }
  if (o.sel != null && !o.mini) svg.append('rect').attr('x', xs(o.sel) - (xs.step() * xs.paddingInner()) / 2).attr('width', xs.step()).attr('y', mt).attr('height', H - mb - mt).attr('fill', cssv('--fg')).attr('opacity', 0.045);
  if (stk.length) {
    const base = labels.map(() => 0);
    stk.forEach((s) => {
      svg.append('g').selectAll('rect').data(s.v).join('rect').attr('x', (d, i) => xs(i)).attr('width', xs.bandwidth())
        .attr('y', (d, i) => yl(base[i] + (d || 0))).attr('height', (d, i) => Math.max(0, yl(base[i]) - yl(base[i] + (d || 0))))
        .attr('fill', s.c).attr('opacity', (d, i) => (o.sel == null || i === o.sel ? 1 : 0.72));
      s.v.forEach((d, i) => { base[i] += d || 0; });
    });
  }
  const bars = sc.filter((s) => s.type === 'bar' && !s.stack);
  bars.forEach((s, bi) => {
    const y = s.axis === 'r' ? yr : yl, bw = xs.bandwidth() / bars.length;
    svg.append('g').selectAll('rect').data(s.v).join('rect').attr('x', (d, i) => xs(i) + bi * bw).attr('width', Math.max(1, bw - (bars.length > 1 ? 2 : 0)))
      .attr('y', (d) => (d == null ? 0 : Math.min(y(0), y(d)))).attr('height', (d) => (d == null ? 0 : Math.abs(y(0) - y(d)))).attr('rx', 2)
      .attr('fill', s.c).attr('opacity', (d, i) => (o.sel == null || i === o.sel ? 1 : 0.62));
  });
  o.thr.forEach((t) => {
    const y = t.axis === 'r' ? yr : yl;
    svg.append('line').attr('x1', ml).attr('x2', W - mr).attr('y1', y(t.v)).attr('y2', y(t.v)).attr('stroke', cssv('--ref')).attr('stroke-dasharray', '4 4');
    if (t.label && !o.mini) svg.append('text').attr('x', W - mr - 4).attr('y', y(t.v) - 5).attr('text-anchor', 'end').text(t.label);
  });
  sc.filter((s) => s.type !== 'bar').forEach((s) => {
    const y = s.axis === 'r' ? yr : yl;
    const def = (d) => d != null && Number.isFinite(d);
    if (s.area) {
      const gid = `g${Math.random().toString(36).slice(2, 8)}`;
      const g = svg.append('defs').append('linearGradient').attr('id', gid).attr('x1', 0).attr('x2', 0).attr('y1', 0).attr('y2', 1);
      [[0, 0.28], [0.6, 0.08], [1, 0]].forEach(([off, a]) => g.append('stop').attr('offset', off).attr('stop-color', s.c).attr('stop-opacity', a));
      svg.append('path').datum(s.v).attr('fill', `url(#${gid})`).attr('d', d3area().defined(def).x((d, i) => cx(i)).y0(H - mb).y1((d) => y(d)));
    }
    svg.append('path').datum(s.v).attr('fill', 'none').attr('stroke', s.c).attr('stroke-width', s.w || 2).attr('stroke-dasharray', s.dash ? '5 4' : null)
      .attr('stroke-linecap', 'round').attr('stroke-linejoin', 'round').attr('d', d3line().defined(def).x((d, i) => cx(i)).y((d) => y(d)));
    if (!o.mini || o.sel != null) {
      svg.append('g').selectAll('circle').data(s.v.map((d, i) => [d, i]).filter((d) => def(d[0]) && ((!o.mini && labels.length <= 12) || d[1] === o.sel))).join('circle')
        .attr('cx', (d) => cx(d[1])).attr('cy', (d) => y(d[0])).attr('r', (d) => (d[1] === o.sel ? 4 : 2.4))
        .attr('fill', (d) => (d[1] === o.sel ? s.c : cssv('--panel'))).attr('stroke', s.c).attr('stroke-width', 1.6);
    }
  });
  if (o.mini) return;
  const tip = select(el).append('div').attr('class', 'tip');
  const hl = svg.append('line').attr('y1', mt).attr('y2', H - mb).attr('stroke', cssv('--line2')).style('display', 'none');
  svg.append('rect').attr('x', ml).attr('y', 0).attr('width', W - ml - mr).attr('height', H).attr('fill', 'transparent')
    .on('pointermove', (ev) => {
      const [mx] = pointer(ev);
      const i = Math.max(0, Math.min(labels.length - 1, Math.floor((mx - xs(0) + (xs.step() * xs.paddingInner()) / 2) / xs.step())));
      hl.style('display', null).attr('x1', cx(i)).attr('x2', cx(i));
      tip.style('display', 'block').html(`<div class="tq">${esc(o.tl ? o.tl[i] : labels[i])}</div>${sc.map((s) => `<div class="tr"><span><i style="background:${s.c}"></i>${esc(s.n)}</span><b>${fmt(s.v[i], s.u)}</b></div>`).join('')}`);
      const tw = tip.node().offsetWidth, px = (cx(i) / W) * el.clientWidth;
      tip.style('left', `${Math.max(0, Math.min(el.clientWidth - tw, px + 12 > el.clientWidth - tw ? px - tw - 12 : px + 12))}px`).style('top', '4px');
    })
    .on('pointerleave', () => { tip.style('display', 'none'); hl.style('display', 'none'); });
}

export function Legend({ items }) {
  return (
    <div className="legend">
      {items.map(([n, c, k]) => (
        <span key={n}><i className={k || ''} style={k === 'dash' ? undefined : { background: c }} />{n}</span>
      ))}
    </div>
  );
}
