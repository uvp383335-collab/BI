import { Request, Response } from 'express'
import { asyncHandler } from '../../../shared/utils/asyncHandler'
import { sendSuccess } from '../../../shared/utils/apiResponse'
import { AppError } from '../../../shared/utils/AppError'
import { computeVC01, computeVC02, computeVC03 } from '../service/metrics.service'
import { computeVC04, computeVC06, computeVC07, computeVC10, computeVC13, computeVC14 } from '../service/plMetrics.service'
import { computeCB05, computeCB07, computeCB10 } from '../service/cbMetrics.service'
import { computeCM02, computeCM03, computeCM04, computeCM05, computeCM06, computeCM07, computeCM08 } from '../service/cmMetrics.service'
import { computeMetricTrend, TREND_METRIC_IDS, TrendMetricId } from '../service/metricsTrend.service'
import { getProductRevenueGrowth, getQuickBooksDepartments, getQuickBooksCustomerStates } from '../service/productRevenueGrowth.service'
import { getRecurringRevenueTrend } from '../service/recurringRevenueTrend.service'
import { getGAndAExpenseTrend } from '../service/gaExpenseTrend.service'
import { getCACTrend } from '../service/cacTrend.service'
import {
  GetMetricQuery,
  GetProductRevenueGrowthQuery,
  GetRecurringRevenueTrendQuery,
  GetGAndAExpenseTrendQuery,
  GetNewCustomersTrendQuery,
  GetCustomerUpgradesTrendQuery
} from '../validator/metrics.validator'
import { getNewCustomersTrend } from '../service/newCustomersTrend.service'
import { getCustomerUpgradesTrend } from '../service/customerUpgradesTrend.service'

function metricHandler(compute: (orgId: string, period?: string) => Promise<unknown>) {
  return asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const orgId = req.auth!.orgId!
    const { period } = req.query as unknown as GetMetricQuery
    const result = await compute(orgId, period)
    sendSuccess(res, result)
  })
}

/** CM-04/06/08 additionally depend on which CRM's funnel/pipeline data to read (`?provider=hubspot|salesforce`, defaults to hubspot). */
function metricHandlerWithProvider(compute: (orgId: string, provider: string, period?: string) => Promise<unknown>) {
  return asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const orgId = req.auth!.orgId!
    const { period, provider } = req.query as unknown as GetMetricQuery
    const result = await compute(orgId, provider ?? 'hubspot', period)
    sendSuccess(res, result)
  })
}

/** VC-04/09/10/13 additionally accept `?item=<quickBooksItemId>` to filter their P&L to a single product/service, and VC-13 accepts `?state=<state>&viewMode=percentage|absolute` for Revenue Growth specific filters. */
function metricHandlerWithItem(compute: (orgId: string, period?: string, itemId?: string, state?: string, viewMode?: string) => Promise<unknown>) {
  return asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const orgId = req.auth!.orgId!
    const { period, item, state, viewMode } = req.query as unknown as GetMetricQuery
    const result = await compute(orgId, period, item, state, viewMode)
    sendSuccess(res, result)
  })
}

export const getVC01 = metricHandler(computeVC01)
export const getVC02 = metricHandler(computeVC02)
export const getVC03 = metricHandler(computeVC03)
export const getVC04 = metricHandlerWithItem(computeVC04)
export const getVC06 = metricHandler(computeVC06)
export const getVC07 = metricHandler(computeVC07)
export const getVC10 = metricHandlerWithItem(computeVC10)
export const getVC13 = metricHandlerWithItem(computeVC13)
export const getVC14 = metricHandler(computeVC14)

// CB-05 is checked daily and has no meaningful `?period=` (it's always "as of the latest sync").
export const getCB05 = metricHandler((orgId) => computeCB05(orgId))
export const getCB07 = metricHandler(computeCB07)
export const getCB10 = metricHandler(computeCB10)
export const getCM02 = metricHandler(computeCM02)
export const getCM03 = metricHandler(computeCM03)
export const getCM04 = metricHandlerWithProvider(computeCM04)
export const getCM06 = metricHandlerWithProvider(computeCM06)
export const getCM08 = metricHandlerWithProvider(computeCM08)
export const getCM05 = metricHandlerWithProvider(computeCM05)
export const getCM07 = metricHandler(computeCM07)

export const getMetricTrend = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const orgId = req.auth!.orgId!
  const { id } = req.params
  const { item, fromYear, state, viewMode } = req.query as unknown as GetMetricQuery
  if (!TREND_METRIC_IDS.includes(id as TrendMetricId)) {
    throw AppError.badRequest(`Unsupported trend metric "${id}"`, 'UNSUPPORTED_TREND_METRIC')
  }
  const result = await computeMetricTrend(orgId, id as TrendMetricId, item, fromYear, state, viewMode)
  sendSuccess(res, result)
})

/** Location filter dropdown's contents for "Revenue growth by product" (docs/server.js §5). */
export const getQuickBooksDepartmentsHandler = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const orgId = req.auth!.orgId!
  const result = await getQuickBooksDepartments(orgId)
  sendSuccess(res, result)
})

/** Billing-state filter dropdown's contents for "Revenue growth by product" (docs/server.js §5). */
export const getQuickBooksCustomerStatesHandler = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const orgId = req.auth!.orgId!
  const result = await getQuickBooksCustomerStates(orgId)
  sendSuccess(res, result)
})

/** Live, on-demand month-over-month revenue growth per product (docs/server.js §5) — not pre-synced, see productRevenueGrowth.service.ts. */
export const getProductRevenueGrowthHandler = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const orgId = req.auth!.orgId!
  const { fromYear, department, state } = req.query as unknown as GetProductRevenueGrowthQuery
  const result = await getProductRevenueGrowth(orgId, { fromYear, department, state })
  sendSuccess(res, result)
})

/** Dashboard's recurring-vs-non-recurring revenue bar chart — `?granularity=monthly|quarterly` (default quarterly), see recurringRevenueTrend.service.ts. */
export const getRecurringRevenueTrendHandler = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const orgId = req.auth!.orgId!
  const { granularity } = req.query as unknown as GetRecurringRevenueTrendQuery
  const result = await getRecurringRevenueTrend(orgId, granularity)
  sendSuccess(res, result)
})

/** Dashboard's "G&A % of Revenue" bar chart — `?granularity=monthly|quarterly|yearly` (default quarterly), see gaExpenseTrend.service.ts. */
export const getGAndAExpenseTrendHandler = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const orgId = req.auth!.orgId!
  const { granularity } = req.query as unknown as GetGAndAExpenseTrendQuery
  const result = await getGAndAExpenseTrend(orgId, granularity)
  sendSuccess(res, result)
})

/** Dashboard's "Customer Acquisition Cost" bar chart — no query params, the window size is a Settings-configured duration, see cacTrend.service.ts. */
export const getCACTrendHandler = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const orgId = req.auth!.orgId!
  const result = await getCACTrend(orgId)
  sendSuccess(res, result)
})

/** Dashboard's "new customers" bar chart — `?fromYear=YYYY&item=<quickBooksItemId>` narrows "new" to that product, see newCustomersTrend.service.ts. */
export const getNewCustomersTrendHandler = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const orgId = req.auth!.orgId!
  const { fromYear, item } = req.query as unknown as GetNewCustomersTrendQuery
  const result = await getNewCustomersTrend(orgId, fromYear, item)
  sendSuccess(res, result)
})

/** Dashboard's "customer upgrades" bar chart — `?item=<quickBooksItemId>&granularity=monthly|annually` (default monthly), see customerUpgradesTrend.service.ts. */
export const getCustomerUpgradesTrendHandler = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const orgId = req.auth!.orgId!
  const { item, granularity } = req.query as unknown as GetCustomerUpgradesTrendQuery
  const result = await getCustomerUpgradesTrend(orgId, item, granularity ?? 'monthly')
  sendSuccess(res, result)
})
