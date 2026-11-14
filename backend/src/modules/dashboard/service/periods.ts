/**
 * Period arithmetic for the dashboard view layer. Periods are either a month
 * ("YYYY-MM") or a quarter ("YYYY-Qn"), matching the oryon-web UI contract.
 */

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export const isMonth = (p: string): boolean => /^\d{4}-(0[1-9]|1[0-2])$/.test(p)
export const isQuarter = (p: string): boolean => /^\d{4}-Q[1-4]$/.test(p)

export function addMonths(month: string, n: number): string {
  const [y, m] = month.split('-').map(Number)
  const idx = y * 12 + (m - 1) + n
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, '0')}`
}

export function addQuarters(quarter: string, n: number): string {
  const y = Number(quarter.slice(0, 4))
  const q = Number(quarter.slice(-1))
  const idx = y * 4 + (q - 1) + n
  return `${Math.floor(idx / 4)}-Q${(idx % 4) + 1}`
}

export const quarterEndMonth = (q: string): string => `${q.slice(0, 4)}-${String(Number(q.slice(-1)) * 3).padStart(2, '0')}`
export const quarterOfMonth = (m: string): string => `${m.slice(0, 4)}-Q${Math.floor((Number(m.slice(5)) - 1) / 3) + 1}`

/** The latest quarter fully closed at the end of `month` (Aug 2026 -> 2026-Q2, Sep 2026 -> 2026-Q3). */
export function completedQuarterAt(month: string): string {
  const y = Number(month.slice(0, 4))
  const k = Math.floor(Number(month.slice(5)) / 3)
  return k === 0 ? `${y - 1}-Q4` : `${y}-Q${k}`
}

export const prevPeriod = (p: string): string => (isMonth(p) ? addMonths(p, -1) : addQuarters(p, -1))
export const yearAgo = (p: string): string => (isMonth(p) ? addMonths(p, -12) : addQuarters(p, -4))

/** The `n` periods ending with `p`, oldest first. */
export function trailingPeriods(p: string, n: number): string[] {
  const out: string[] = []
  for (let i = n - 1; i >= 0; i--) out.push(isMonth(p) ? addMonths(p, -i) : addQuarters(p, -i))
  return out
}

/** Inclusive range between two periods of the same kind. */
export function periodRange(from: string, to: string): string[] {
  const out: string[] = []
  let p = from
  while (p <= to && out.length < 1000) {
    out.push(p)
    p = isMonth(p) ? addMonths(p, 1) : addQuarters(p, 1)
  }
  return out
}

export const periodLabel = (p: string): string =>
  isMonth(p) ? `${MON[Number(p.slice(5)) - 1]} ${p.slice(0, 4)}` : `${p.slice(5)} ${p.slice(0, 4)}`
export const periodShort = (p: string): string =>
  isMonth(p) ? `${MON[Number(p.slice(5)) - 1]} '${p.slice(2, 4)}` : `${p.slice(5)} '${p.slice(2, 4)}`
