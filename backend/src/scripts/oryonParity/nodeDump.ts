/**
 * Node side of the Oryon parity check: computes every Oryon page with the same
 * views as python_dump.py and writes the same JSON shape.
 *
 * Usage (from backend/):
 *   npx tsx src/scripts/oryonParity/nodeDump.ts out.json [orgId]
 */
import 'dotenv/config'
import fs from 'node:fs'
import mongoose from 'mongoose'
import { connectDatabase } from '../../database/connection'
import { closeAllTenantConnections } from '../../database/tenantConnection'
import { OryonData } from '../../modules/metrics/oryon/oryonData'
import { PAGES, Query } from '../../modules/metrics/oryon/oryonPages'

const KEEP = ['rows', 'latest', 'prev', 'year_ago', 'ttm', 'q_rows', 'quarters', 'stacks', 'by_line', 'stale']

const g = ['month', 'quarter']
const gw = g.flatMap((grain) => ['period', 'ttm'].map((window) => ({ grain, window })))
export const VIEWS: Record<string, Query[]> = {
  mrr: [{}],
  retention: ['quarter', 'month'].flatMap((grain) => ['ttm', 'period'].flatMap((window) => ['all', 'subscription'].map((scope) => ({ grain, window, scope })))),
  new_logos: [{ grain: 'quarter' }, { grain: 'month' }],
  cac: [{}],
  cogs: gw, ga: gw, ebitda: gw,
  ltv: [{ grain: 'quarter' }, { grain: 'month' }],
  recurring: gw, growth: gw,
  cash: [{ grain: 'month' }, { grain: 'quarter' }],
  fcf: [{ view: 'ttm' }, { view: 'month' }],
  ccc: [{ view: 'quarter' }, { view: 'month' }],
  concentration: [{}], diversification: [{}],
  win_rate: ['period', 'ttm'].flatMap((view) => g.map((grain) => ({ view, grain }))),
  funnel: g.flatMap((grain) => ['period', 'ttm'].map((view) => ({ grain, view }))),
  mql: g.flatMap((grain) => ['period', 'ttm'].map((view) => ({ grain, view }))),
  roi: ['quarter', 'month'].flatMap((grain) => ['period', 'ttm'].map((view) => ({ grain, view }))),
  msp: ['quarter', 'month'].flatMap((grain) => ['period', 'ttm'].map((view) => ({ grain, view })))
}

const clean = (v: unknown): unknown =>
  JSON.parse(JSON.stringify(v, (_k, x) => (x === Infinity ? 'inf' : x === -Infinity ? '-inf' : x instanceof Set ? Array.from(x).sort() : x instanceof Map ? Object.fromEntries(x) : x)))

async function main() {
  await connectDatabase()
  const orgId = process.argv[3] ?? '6b1a00000000000000000001'
  const only = new Set(process.argv.slice(4))
  const data = await OryonData.forOrg(orgId)
  await data.load()
  const out: Record<string, unknown[]> = {}
  for (const [name, views] of Object.entries(VIEWS)) {
    if (only.size && !only.has(name)) continue
    out[name] = []
    for (const q of views) {
      const page = await PAGES[name](data, q)
      const kept: Record<string, unknown> = { query: q }
      for (const k of KEEP) if (k in page) kept[k] = clean(page[k])
      if (name === 'win_rate') kept.headline = page.info.headline // compared with the Python page's headline competitor
      out[name].push(kept)
    }
    console.error(name, 'ok')
  }
  fs.writeFileSync(process.argv[2], JSON.stringify(out))
  await closeAllTenantConnections()
  await mongoose.disconnect()
}

main().catch(async (e) => {
  console.error(e)
  process.exit(1)
})
