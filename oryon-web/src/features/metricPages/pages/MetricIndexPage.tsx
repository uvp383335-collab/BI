import React from 'react'
import { Link } from 'react-router-dom'
import { AppShell } from '../../../widgets/AppShell'
import { PAGE_BY_KEY, PAGE_GROUPS } from '../config'

/** Every Oryon metric page by group, like the reference app's sidebar. */
export const MetricIndexPage: React.FC = () => (
  <AppShell title="All metrics" subtitle="Full page for every Oryon metric: charts, table, drill-downs, CSV and how it's calculated.">
    <div className="grid gap-4 lg:grid-cols-2">
      {PAGE_GROUPS.map((g) => (
        <div key={g.name} className="card p-5">
          <h2 className="text-base font-semibold text-ink">{g.name}</h2>
          <ul className="mt-3 divide-y divide-line">
            {g.pages.map((k) => {
              const p = PAGE_BY_KEY.get(k)!
              return (
                <li key={k}>
                  <Link to={`/metrics/${k}`} className="flex items-baseline gap-3 py-2 hover:text-brand">
                    <span className="badge bg-surface-3 text-ink-3">{p.codes.join(' · ')}</span>
                    <span className="text-sm text-ink">{p.title}</span>
                  </Link>
                </li>
              )
            })}
          </ul>
        </div>
      ))}
    </div>
  </AppShell>
)

export default MetricIndexPage
