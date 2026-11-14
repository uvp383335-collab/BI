import { useCallback, useEffect, useState } from 'react';
import { completedQuarterAt, qEndMonth } from './format.js';

/**
 * View state shared by every screen. Persisted per browser (localStorage, wrapped in try/catch)
 * so a user's preferred view survives reloads.
 *
 *   gran     'M' monthly | 'Q' quarterly
 *   month    as-of month (monthly view)    quarter  as-of quarter (quarterly view); kept in sync
 *   window   'P' single period | 'TTM'
 *   span     quarters of history: 4 | 8 | 12
 *   units    'pct' rates | 'abs' dollars and counts
 *   region, segment   'All' | value        product  'All' | string[] (2+ = comparison)
 */
const KEY = 'oryon-view';
const DEFAULTS = { gran: 'Q', month: null, quarter: null, window: 'P', span: 8, units: 'pct', region: 'All', segment: 'All', product: 'All' };

function load() { try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch { return { ...DEFAULTS }; } }

export function useView(meta) {
  const [view, setView] = useState(load);
  // clamp to what the company's data supports once meta is known
  useEffect(() => {
    if (!meta) return;
    setView((v) => {
      const quarter = meta.quarters.includes(v.quarter) ? v.quarter : meta.quarters[meta.quarters.length - 1];
      const month = meta.months.includes(v.month) ? v.month : qEndMonth(quarter);
      const product = v.product === 'All' ? 'All' : v.product.filter((p) => meta.products.includes(p));
      const cap = meta.capabilities || {};
      // controls the backend can't serve yet fall back to their defaults
      if (cap.ttm === false) v = { ...v, window: 'P' };
      if (cap.region === false) v = { ...v, region: 'All' };
      if (cap.segment === false) v = { ...v, segment: 'All' };
      if (cap.product === false) v = { ...v, product: 'All' };
      return {
        ...v, quarter, month: v.gran === 'M' ? month : qEndMonth(quarter),
        region: v.region === 'All' || meta.regions.includes(v.region) ? v.region : 'All',
        segment: v.segment === 'All' || meta.segments.includes(v.segment) ? v.segment : 'All',
        product: v.product === 'All' || product === 'All' || product.length === 0 || product.length === meta.products.length ? 'All' : product,
      };
    });
  }, [meta]);
  useEffect(() => { try { localStorage.setItem(KEY, JSON.stringify(view)); } catch { /* storage unavailable */ } }, [view]);

  const update = useCallback((patch) => setView((v) => {
    const n = { ...v, ...patch };
    if (patch.gran === 'M' && v.gran !== 'M') n.month = qEndMonth(v.quarter);
    if (patch.gran === 'Q' && v.gran !== 'Q') n.quarter = completedQuarterAt(v.month);
    if (patch.month) n.quarter = completedQuarterAt(patch.month);
    if (patch.quarter && n.gran === 'M') n.month = qEndMonth(patch.quarter);
    return n;
  }), []);
  return [view, update];
}

/** Fetch helper: re-runs when deps change, ignores stale responses. */
export function useAsync(fn, deps) {
  const [state, setState] = useState({ loading: true, data: null, error: null });
  useEffect(() => {
    let live = true;
    setState((s) => ({ ...s, loading: true, error: null }));
    fn().then((data) => live && setState({ loading: false, data, error: null }), (error) => live && setState({ loading: false, data: null, error }));
    return () => { live = false; };
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps
  return state;
}
