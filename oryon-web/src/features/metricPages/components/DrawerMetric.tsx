import React, { useState } from 'react'
import { PAGE_BY_KEY } from '../config'
import { MetricView, useProducts, viewQuery } from './MetricView'
import type { ProductOption } from '../api/metricPagesApi'

/** Global product filter labels (the dashboard's: the item name, or "name (#id)" when names repeat) -> item ids. */
export function productIdsFor(labels: string[] | 'All' | undefined, products: ProductOption[]): string[] {
  if (!labels || labels === 'All') return []
  return products.filter((p) => labels.includes(p.name) || labels.includes(`${p.name} (#${p.id})`)).map((p) => p.id)
}

/**
 * The full metric view inside the portfolio metric drawer: the view switches live in local state (the
 * drawer has no URL of its own), the drill-down opens in place with a Back button, and the row of the
 * period selected on the dashboard is highlighted. A product-aware metric starts on the global product filter's
 * products; the drawer's own product filter then changes only this drawer.
 */
export const DrawerMetric: React.FC<{ page: string; highlight?: string | null; globalProducts?: string[] | 'All' }> = ({ page, highlight, globalProducts }) => {
  const cfg = PAGE_BY_KEY.get(page)!
  const wantsProducts = !!cfg.productFilter && !!globalProducts && globalProducts !== 'All' && globalProducts.length > 0
  const { data: products, isLoading } = useProducts()
  if (wantsProducts && isLoading) return <div className="card p-6 text-sm text-ink-3">Loading…</div>
  return <DrawerMetricBody page={page} highlight={highlight} initialItems={wantsProducts ? productIdsFor(globalProducts, products?.products ?? []) : []} />
}

const DrawerMetricBody: React.FC<{ page: string; highlight?: string | null; initialItems: string[] }> = ({ page, highlight, initialItems }) => {
  const cfg = PAGE_BY_KEY.get(page)!
  const [query, setQuery] = useState<Record<string, string>>(() => {
    const q = viewQuery(cfg, () => undefined)
    if (initialItems.length) q.items = initialItems.join(',')
    return q
  })
  return <MetricView cfg={cfg} query={query} onQuery={(k, v) => setQuery((q) => ({ ...q, [k]: v }))} highlight={highlight} compact />
}

export default DrawerMetric
