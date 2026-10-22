import { productRepository } from '../../sync/repository/product.repository'
import { plItemSnapshotRepository } from '../../sync/repository/plItemSnapshot.repository'
import { sumColumn } from './plParser'

export interface ProductRecurringSplit {
  recurring: number
  nonRecurring: number
  /** False when the org hasn't categorized any product yet (or none have a quarter's PLItemSnapshot) — callers must return "not computable" instead of a misleading 0/0 split. */
  hasCategorizedProducts: boolean
}

const EMPTY_SPLIT: ProductRecurringSplit = { recurring: 0, nonRecurring: 0, hasCategorizedProducts: false }

/**
 * VC-13's recurring-vs-non-recurring revenue split, driven by the
 * Settings-page product categorization (`Product.category`) instead of the
 * retired `isRecurringIncomeAccount` keyword heuristic. Sums each
 * `recurring`/`non_recurring` product's quarterly income (`PLItemSnapshot`,
 * already synced per item per quarter — never a live QuickBooks call here)
 * into its bucket. `not_sure` and never-categorized products are excluded
 * from both buckets — their revenue still counts toward the whole-org
 * "Total" the caller reads separately from `PLSnapshot`; only this
 * recurring/non-recurring split is narrowed to categorized products.
 *
 * When `itemId` is given (VC-13's per-product P&L trend card filter), the
 * split narrows to that one product: its entire quarterly revenue lands in
 * whichever bucket its own category is, or `hasCategorizedProducts: false`
 * if that specific product hasn't been categorized yet (even if other
 * products in the org have).
 */
export async function getProductRecurringSplit(orgId: string, provider: string, quarterStart: string, itemId?: string): Promise<ProductRecurringSplit> {
  const categorized = await productRepository.findCategorizedForOrg(orgId, provider)
  if (categorized.length === 0) return EMPTY_SPLIT

  if (itemId) {
    const product = categorized.find((p) => p.providerRecordId === itemId)
    if (!product) return EMPTY_SPLIT
    const snapshot = await plItemSnapshotRepository.findByQuarterAndItem(orgId, provider, quarterStart, itemId)
    const income = snapshot ? sumColumn(snapshot.income, 'Total') : 0
    return product.category === 'recurring'
      ? { recurring: income, nonRecurring: 0, hasCategorizedProducts: true }
      : { recurring: 0, nonRecurring: income, hasCategorizedProducts: true }
  }

  const snapshots = await plItemSnapshotRepository.findAllForQuarter(orgId, provider, quarterStart)
  const incomeByItemId = new Map(snapshots.map((snapshot) => [snapshot.itemId, sumColumn(snapshot.income, 'Total')]))

  let recurring = 0
  let nonRecurring = 0
  for (const product of categorized) {
    const income = incomeByItemId.get(product.providerRecordId) ?? 0
    if (product.category === 'recurring') recurring += income
    else nonRecurring += income
  }

  return { recurring, nonRecurring, hasCategorizedProducts: true }
}
