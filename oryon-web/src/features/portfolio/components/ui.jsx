import { useEffect, useRef } from 'react';
import { seriesColors } from '../lib/format.js';

export function Seg({ id, label, options, value, onChange, disabled = false, title }) {
  return (
    <div className="seg" id={id} role="group" aria-label={label} title={disabled ? title : undefined}>
      {options.map(([v, l, t]) => (
        <button key={v} type="button" aria-pressed={value === v} disabled={disabled} title={t} onClick={() => !disabled && onChange(v)}>{l}</button>
      ))}
    </div>
  );
}

export function Select({ id, label, options, value, onChange, disabled = false, title }) {
  return (
    <div className="fld" title={disabled ? title : undefined}>
      <label htmlFor={id}>{label}</label>
      <select id={id} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </div>
  );
}

export const productColor = (products, p) => seriesColors()[Math.max(0, products.indexOf(p)) % 6];
export const productText = (v) => (v === 'All' ? 'All products' : v.join(' + '));

/** Product filter: 'All', or tick products to compare. Ticking every product means All. `single`: one product at a time. */
export function ProductPicker({ id = 'f-product', products, value, onChange, disabled = false, title, single = false, hint }) {
  const ref = useRef(null);
  useEffect(() => {
    const close = (e) => { const d = ref.current?.querySelector('details'); if (d?.open && !ref.current.contains(e.target)) d.open = false; };
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, []);
  const sel = value === 'All' ? [] : value;
  const toggle = (p) => {
    if (single) { onChange(sel.includes(p) ? 'All' : [p]); return; }
    const next = sel.includes(p) ? sel.filter((x) => x !== p) : [...sel, p];
    onChange(!next.length || next.length === products.length ? 'All' : products.filter((x) => next.includes(x)));
  };
  return (
    <div className="fld ms" id={`${id}-w`} ref={ref} title={disabled ? title : undefined}>
      <label>Product</label>
      <details data-off={disabled ? '1' : undefined} onToggle={(e) => { if (disabled) e.currentTarget.open = false; }}>
        <summary aria-label={`Products: ${productText(value)}`}>{productText(value)}</summary>
        <div className="ms-pop" role="group" aria-label="Products" style={single ? { maxHeight: 320, overflowY: 'auto' } : undefined}>
          <label className="ms-o"><input type="checkbox" checked={value === 'All'} disabled={disabled} onChange={() => onChange('All')} /><span>All products</span></label>
          {products.map((p) => (
            <label className="ms-o" key={p}>
              <input type="checkbox" checked={sel.includes(p)} disabled={disabled} onChange={() => toggle(p)} />
              <i className="dot" style={{ background: productColor(products, p) }} /><span>{p}</span>
            </label>
          ))}
          <p className="ms-h">{hint || 'Tick two products to compare them side by side.'}</p>
        </div>
      </details>
    </div>
  );
}

export function Pill({ flag, noData = false }) {
  if (!flag && noData) return <span className="pill nd" title="Not enough data to compute this metric for the period">No data</span>;
  if (!flag) return <span className="pill ok">On track</span>;
  return <span className={`pill ${flag === 'Act now' ? 'act' : 'wat'}`}>{flag}</span>;
}

/** Tags a card with how filters apply: Filtered / Company / Quarterly (in the monthly view). */
export function Scope({ scope, quarterly, quarterLabel }) {
  return (
    <>
      {quarterly && <span className="scope q" title={`No monthly data for this metric; showing ${quarterLabel}`}>Quarterly</span>}
      {scope === 'filtered' && <span className="scope f">Filtered</span>}
      {scope === 'company' && <span className="scope c" title="This metric is company-wide; the active filters don't apply">Company</span>}
    </>
  );
}

export function Card({ title, sub, right, children, className = '', ...rest }) {
  return (
    <section className={`card ${className}`} {...rest}>
      {(title || right) && (
        <div className="card-h">
          <div>{title && <h3>{title}</h3>}{sub && <p>{sub}</p>}</div>
          {right && <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>{right}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

export function Loading({ what = 'Loading' }) { return <div className="loading" role="status">{what}…</div>; }
export function ErrorBox({ error }) { return <div className="err" role="alert">{error?.message || String(error)}</div>; }
