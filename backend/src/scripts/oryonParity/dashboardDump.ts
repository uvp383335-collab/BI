/**
 * Dumps what the oryon-web portfolio API (modules/dashboard getMetric) returns for
 * every metric — the series values per period — so dashboardCheck.py can compare
 * them with the Python reference dump.
 *   npx tsx src/scripts/oryonParity/dashboardDump.ts out.json [orgId]
 */
import 'dotenv/config'
import fs from 'node:fs'
import mongoose from 'mongoose'
import { connectDatabase } from '../../database/connection'
import { closeAllTenantConnections } from '../../database/tenantConnection'
import { getMetric, getOverview } from '../../modules/dashboard/service/dashboard.service'
import { METRICS } from '../../modules/dashboard/service/metricRegistry'

async function main() {
  await connectDatabase()
  const orgId = process.argv[3] ?? '6b1a00000000000000000001'
  const out: Record<string, Record<string, unknown>> = {}
  for (const m of METRICS) {
    if (m.id === 'CM-04') continue
    out[m.id] = {}
    for (const q of [{ asOf: '2026-Q3', span: '12' }, { asOf: '2026-09', span: '4' }]) {
      const r = (await getMetric(orgId, m.id, q)) as { series: { period: string; value: number | null }[]; subs: unknown; alert: unknown }
      out[m.id][q.asOf] = { series: r.series, subs: r.subs, alert: r.alert }
    }
  }
  const ov = (await getOverview(orgId, { asOf: '2026-Q3', span: '8' })) as { kpis: unknown }
  fs.writeFileSync(process.argv[2], JSON.stringify({ metrics: out, overviewKpis: ov.kpis }))
  await closeAllTenantConnections()
  await mongoose.disconnect()
  process.exit(0)
}
main().catch((e) => {
  console.error(e)
  process.exit(1)
})
