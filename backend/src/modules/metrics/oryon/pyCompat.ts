/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Small helpers that reproduce Python semantics the Oryon reference app
 * (mrr_app/, Python) relies on, so the TypeScript port computes the same
 * numbers: truthiness, `str()`, `round()`, tuple ordering and dict equality.
 */

export type Dict = Record<string, any>

/** Python truthiness: None/0/''/[]/{}/NaN-free false values. */
export function truthy(v: unknown): boolean {
  if (v === null || v === undefined || v === false || v === 0 || v === '') return false
  if (typeof v === 'number' && Number.isNaN(v)) return false
  if (Array.isArray(v)) return v.length > 0
  if (v instanceof Map || v instanceof Set) return v.size > 0
  if (typeof v === 'object' && !(v instanceof Date)) return Object.keys(v as object).length > 0
  return true
}

/** Python `a or b`. */
export const or = <A, B>(a: A, b: B): A | B => (truthy(a) ? a : b)

/** Python `str(v)` for the scalar values found in the synced documents. */
export function pyStr(v: unknown): string {
  if (v === null || v === undefined) return 'None'
  if (v === true) return 'True'
  if (v === false) return 'False'
  if (v instanceof Date) return v.toISOString().replace('T', ' ').replace('Z', '+00:00')
  return String(v)
}

/** Python `float(v or 0)`. */
export function num(v: unknown): number {
  if (!truthy(v)) return 0
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : 0
}

/**
 * Python `round(x, n)`: correctly rounded on the exact binary value, ties to
 * even. `toFixed` is also correctly rounded on the exact value but sends ties
 * up, so only true ties (exact decimal expansion ending in 5) are adjusted.
 */
export function pyRound(x: number, n = 0): number {
  if (!Number.isFinite(x)) return x
  const exact = Math.abs(x).toFixed(Math.min(100, n + 60))
  const dot = exact.indexOf('.')
  const tail = exact.slice(dot + 1 + n)
  if (/^50*$/.test(tail)) {
    const down = Number(exact.slice(0, dot + 1 + n).replace(/\.$/, ''))
    const lastDigit = Number(exact[dot + n === dot ? dot - 1 : dot + n])
    const even = lastDigit % 2 === 0 ? down : Number((down + 10 ** -n).toFixed(n))
    return x < 0 ? -even : even
  }
  return Number(x.toFixed(n))
}

/** Python tuple comparison for sort keys made of booleans, numbers and strings. */
export function cmpTuple(a: unknown[], b: unknown[]): number {
  const len = Math.min(a.length, b.length)
  for (let i = 0; i < len; i++) {
    const x = typeof a[i] === 'boolean' ? Number(a[i]) : a[i]
    const y = typeof b[i] === 'boolean' ? Number(b[i]) : b[i]
    if (x === y) continue
    if ((x as any) < (y as any)) return -1
    if ((x as any) > (y as any)) return 1
  }
  return a.length - b.length
}

/** Python `sorted(xs, key=key)` (stable, ascending by tuple key). */
export function sortedBy<T>(xs: Iterable<T>, key: (x: T) => unknown[] | string | number, reverse = false): T[] {
  const arr = Array.from(xs).map((x, i) => ({ x, k: key(x), i }))
  arr.sort((p, q) => {
    const c = Array.isArray(p.k) ? cmpTuple(p.k, q.k as unknown[]) : cmpTuple([p.k], [q.k])
    return (reverse ? -c : c) || p.i - q.i
  })
  return arr.map((e) => e.x)
}

/** Python `sorted()` of strings. */
export const sortedStr = (xs: Iterable<string>): string[] => Array.from(xs).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))

/** Python `==` on JSON-like values (dicts compare regardless of key order). */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (a === null || b === null || a === undefined || b === undefined) return false
  if (typeof a !== 'object' || typeof b !== 'object') return false
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false
    return a.every((x, i) => deepEqual(x, b[i]))
  }
  const ka = Object.keys(a as object)
  const kb = Object.keys(b as object)
  if (ka.length !== kb.length) return false
  return ka.every((k) => Object.prototype.hasOwnProperty.call(b, k) && deepEqual((a as Dict)[k], (b as Dict)[k]))
}

/**
 * Python `sum()` of floats. CPython 3.12+ adds float sums with Neumaier
 * compensated summation (not a plain left fold), so this does the same.
 */
export const sum = (xs: Iterable<number>): number => {
  let s = 0
  let c = 0
  for (const x of xs) {
    const t = s + x
    if (Math.abs(s) >= Math.abs(x)) c += s - t + x
    else c += x - t + s
    s = t
  }
  return c !== 0 && Number.isFinite(c) ? s + c : s
}

/** defaultdict(lambda: defaultdict(float)) helper. */
export function add2(m: Map<string, Map<string, number>>, k1: string, k2: string, v: number): void {
  let inner = m.get(k1)
  if (!inner) {
    inner = new Map()
    m.set(k1, inner)
  }
  inner.set(k2, (inner.get(k2) ?? 0) + v)
}

export function getOr<K, V>(m: Map<K, V>, k: K, make: () => V): V {
  let v = m.get(k)
  if (v === undefined) {
    v = make()
    m.set(k, v)
  }
  return v
}
