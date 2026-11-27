import React, { useState } from 'react'
import { PAGE_BY_KEY } from '../config'
import { MetricView, viewQuery } from './MetricView'

/**
 * The full metric view inside the portfolio metric drawer: the view switches live in local state (the
 * drawer has no URL of its own), the drill-down opens in place with a Back button, and the row of the
 * period selected on the dashboard is highlighted.
 */
export const DrawerMetric: React.FC<{ page: string; highlight?: string | null }> = ({ page, highlight }) => {
  const cfg = PAGE_BY_KEY.get(page)!
  const [query, setQuery] = useState<Record<string, string>>(() => viewQuery(cfg, () => undefined))
  return <MetricView cfg={cfg} query={query} onQuery={(k, v) => setQuery((q) => ({ ...q, [k]: v }))} highlight={highlight} compact />
}

export default DrawerMetric
