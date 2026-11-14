import { format } from 'd3-format';

const cmp = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });

/** Format a value in a unit: '%', 'pts', 'x', 'USD', 'USD/month', 'days', 'months', 'count', 'score'. */
export function fmt(v, u, o = {}) {
  if (v == null || !Number.isFinite(v)) return '–';
  switch (u) {
    case '%': return `${format(o.p === 0 ? '.0f' : '.1f')(v)}%`;
    case 'pts': return `${format('+.1f')(v)} pts`;
    case 'x': return `${format(o.p === 1 ? '.1f' : '.2f')(v)}x`;
    case 'USD': return `${v < 0 ? '-$' : '$'}${cmp.format(Math.abs(v))}`;
    case 'USD/month': return `$${cmp.format(v)}/mo`;
    case 'days': return `${format('.0f')(v)}${o.short ? 'd' : ' days'}`;
    case 'months': return `${format('.1f')(v)}${o.short ? '' : ' mo'}`;
    case 'count': return format(',')(Math.round(v));
    case 'score': return format('d')(Math.round(v));
    default: return format(',.2f')(v);
  }
}

/** Format a change: points for rates, relative % for amounts. */
export function dfmt(ch, u) {
  if (ch == null || !Number.isFinite(ch)) return '';
  if (u === '%' || u === 'pts') return `${format('+.1f')(ch)} pts`;
  if (u === 'x') return `${format('+.2f')(ch)}x`;
  if (u === 'days') return `${format('+.0f')(ch)} days`;
  if (u === 'months') return `${format('+.1f')(ch)} mo`;
  if (u === 'score') return format('+d')(Math.round(ch));
  return format('+.1%')(ch);
}

/** 'up' (good), 'dn' (bad) or 'fl' (flat / no direction) for a change and a metric direction. */
export function tone(ch, dir) {
  if (ch == null || dir === 'none' || Math.abs(ch) < 1e-9) return 'fl';
  return (ch > 0) === (dir === 'up') ? 'up' : 'dn';
}

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const isMonth = (p) => /^\d{4}-\d{2}$/.test(p || '');
export const pLabel = (p) => (!p ? '' : isMonth(p) ? `${MON[Number(p.slice(5)) - 1]} ${p.slice(0, 4)}` : `${p.slice(5)} ${p.slice(0, 4)}`);
export const pShort = (p) => (!p ? '' : isMonth(p) ? `${MON[Number(p.slice(5)) - 1]} '${p.slice(2, 4)}` : `${p.slice(5)} '${p.slice(2, 4)}`);
export const qEndMonth = (q) => `${q.slice(0, 4)}-${String(Number(q.slice(-1)) * 3).padStart(2, '0')}`;
export const completedQuarterAt = (m) => { const mo = Number(m.slice(5)); const y = Number(m.slice(0, 4)); const k = Math.floor(mo / 3); return k === 0 ? `${y - 1}-Q4` : `${y}-Q${k}`; };

/** Read a CSS custom property (chart colors follow the theme). */
export const cssv = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
export const seriesColors = () => ['--s1', '--s2', '--s3', '--s4', '--s5', '--s6'].map(cssv);
