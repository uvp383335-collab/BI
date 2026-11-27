/** Number formats used by the metric pages, charts and CSV export. */
export type Fmt = 'usd' | 'usd2' | 'pct' | 'pct1' | 'num' | 'int' | 'x' | 'days' | 'months' | 'text' | 'bool' | 'rate'

export function fmt(v: unknown, f: Fmt = 'num'): string {
  if (v === null || v === undefined || v === '') return '-'
  if (f === 'text') return String(v)
  if (f === 'bool') return v ? 'yes' : 'no'
  if (typeof v !== 'number' || !Number.isFinite(v)) return String(v)
  switch (f) {
    case 'usd':
      return `${v < -0.5 ? '-' : ''}$${Math.abs(v).toLocaleString('en-US', { maximumFractionDigits: 0 })}`
    case 'usd2':
      return `${v < 0 ? '-' : ''}$${Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    case 'pct':
      return `${v.toFixed(2)}%`
    case 'pct1':
      return `${v.toFixed(1)}%`
    case 'int':
      return Math.round(v).toLocaleString('en-US')
    case 'x':
      return `${v.toFixed(2)}x`
    case 'days':
      return `${v.toFixed(1)} days`
    case 'months':
      return `${v.toFixed(1)} mo`
    case 'rate':
      return v.toFixed(4)
    default:
      return v.toLocaleString('en-US', { maximumFractionDigits: 2 })
  }
}

/** Short axis labels: $1.2M, 45%, 3.1x */
export function axisFmt(f: Fmt) {
  return (v: number) => {
    if (!Number.isFinite(v)) return ''
    if (f === 'usd' || f === 'usd2') {
      const a = Math.abs(v)
      const s = a >= 1e6 ? `${(a / 1e6).toFixed(1)}M` : a >= 1e3 ? `${(a / 1e3).toFixed(0)}K` : a.toFixed(0)
      return `${v < 0 ? '-' : ''}$${s}`
    }
    if (f === 'pct' || f === 'pct1') return `${v.toFixed(0)}%`
    if (f === 'x') return `${v.toFixed(1)}x`
    return v.toLocaleString('en-US', { maximumFractionDigits: 1 })
  }
}

/** Raw value for CSV (unformatted numbers, like the reference app's CSV downloads). */
export function csvCell(v: unknown): string {
  if (v === null || v === undefined) return ''
  const s = typeof v === 'number' ? String(Math.round(v * 1e6) / 1e6) : String(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export const SERIES = ['var(--s1)', 'var(--s2)', 'var(--s3)', 'var(--s4)', 'var(--s5)', 'var(--s6)', 'var(--bad)', 'var(--good)']
