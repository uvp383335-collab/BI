import { Request, Response } from 'express'
import { asyncHandler } from '../../../shared/utils/asyncHandler'
import { sendSuccess } from '../../../shared/utils/apiResponse'
import { AppError } from '../../../shared/utils/AppError'
import { computeVC01, computeVC02, computeVC03 } from '../service/metrics.service'
import { computeVC04, computeVC06, computeVC07, computeVC10, computeVC13, computeVC14 } from '../service/plMetrics.service'
import { computeCB05, computeCB07, computeCB10 } from '../service/cbMetrics.service'
import {
  computeCM02,
  computeCM03,
  computeCM04,
  computeCM05,
  computeCM06,
  computeCM07,
  computeCM08,
  getLeadToMqlTrend,
  getMqlToSqlTrend,
  getLeadToMqlTrendDetail,
  getMqlToSqlTrendDetail
} from '../service/cmMetrics.service'
import { computeMetricTrend, TREND_METRIC_IDS, TrendMetricId } from '../service/metricsTrend.service'
import {
  getProductRevenueGrowth,
  getProductRevenueGrowthDetail,
  getQuickBooksDepartments,
  getQuickBooksCustomerStates,
  getInvoiceRevenueGrowthByProduct,
  getInvoiceRevenueGrowthByProductDetail
} from '../service/productRevenueGrowth.service'
import { getRecurringRevenueTrend } from '../service/recurringRevenueTrend.service'
import { getGAndAExpenseTrend } from '../service/gaExpenseTrend.service'
import { getCACTrend } from '../service/cacTrend.service'
import {
  GetMetricQuery,
  GetProductRevenueGrowthQuery,
  GetProductRevenueGrowthDetailQuery,
  GetInvoiceRevenueGrowthByProductQuery,
  GetInvoiceRevenueGrowthByProductDetailQuery,
  GetRecurringRevenueTrendQuery,
  GetGAndAExpenseTrendQuery,
  GetNewCustomersTrendQuery,
  GetCustomerUpgradesTrendQuery,
  GetQualifiedPipelineTrendQuery,
  GetLeadToMqlTrendQuery,
  GetMqlToSqlTrendQuery
} from '../validator/metrics.validator'
import { getNewCustomersTrend, getNewCustomersTrendDetail } from '../service/newCustomersTrend.service'
import { getCustomerUpgradesTrend, getCustomerUpgradesTrendDetail } from '../service/customerUpgradesTrend.service'
import { getQualifiedPipelineTrend } from '../service/qualifiedPipelineTrend.service'

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

/** Record-level detail behind one product's "Revenue growth by product" series — QuickBooks' live per-product P&L revenue plus the matching locally-synced invoice lines, for the dashboard's "export to Excel" verification button. See productRevenueGrowth.service.ts's getProductRevenueGrowthDetail. */
export const getProductRevenueGrowthDetailHandler = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const orgId = req.auth!.orgId!
  const { productId, productName, fromYear, department, state } = req.query as unknown as GetProductRevenueGrowthDetailQuery
  const result = await getProductRevenueGrowthDetail(orgId, productId, productName, { fromYear, department, state })
  sendSuccess(res, result)
})

/** "Revenue growth by product," computed entirely from synced Invoice line items rather than a live QuickBooks Profit & Loss report — `?fromYear=YYYY`, see productRevenueGrowth.service.ts's getInvoiceRevenueGrowthByProduct. */
export const getInvoiceRevenueGrowthByProductHandler = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const orgId = req.auth!.orgId!
  const { fromYear } = req.query as unknown as GetInvoiceRevenueGrowthByProductQuery
  const result = await getInvoiceRevenueGrowthByProduct(orgId, { fromYear })
  sendSuccess(res, result)
})

/** Record-level detail behind one product's series in the chart above — every synced invoice line, for the dashboard's "export to Excel" verification button. See productRevenueGrowth.service.ts's getInvoiceRevenueGrowthByProductDetail. */
export const getInvoiceRevenueGrowthByProductDetailHandler = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const orgId = req.auth!.orgId!
  const { productId, productName, fromYear } = req.query as unknown as GetInvoiceRevenueGrowthByProductDetailQuery
  const result = await getInvoiceRevenueGrowthByProductDetail(orgId, productId, productName, { fromYear })
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

/** Record-level detail behind the "new customers" chart — every customer counted in each month, for the dashboard's "export to Excel" verification button. Same query params as the chart endpoint. */
export const getNewCustomersTrendDetailHandler = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const orgId = req.auth!.orgId!
  const { fromYear, item } = req.query as unknown as GetNewCustomersTrendQuery
  const result = await getNewCustomersTrendDetail(orgId, fromYear, item)
  sendSuccess(res, result)
})

/** Dashboard's "customer upgrades" bar chart — `?item=<quickBooksItemId>&granularity=monthly|annually` (default monthly), see customerUpgradesTrend.service.ts. */
export const getCustomerUpgradesTrendHandler = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const orgId = req.auth!.orgId!
  const { item, granularity } = req.query as unknown as GetCustomerUpgradesTrendQuery
  const result = await getCustomerUpgradesTrend(orgId, item, granularity ?? 'monthly')
  sendSuccess(res, result)
})

/** Record-level detail behind the customer upgrades/downgrades/churn charts — every existing customer's prior/current revenue and which bucket they fell into, for the "export to Excel" verification button shared by all three cards. Same query params as the aggregate endpoint. */
export const getCustomerUpgradesTrendDetailHandler = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const orgId = req.auth!.orgId!
  const { item, granularity } = req.query as unknown as GetCustomerUpgradesTrendQuery
  const result = await getCustomerUpgradesTrendDetail(orgId, item, granularity ?? 'monthly')
  sendSuccess(res, result)
})

/** Dashboard's "Qualified Pipeline Created vs. Target" chart — `?provider=hubspot|salesforce&fromMonth=YYYY-MM&toMonth=YYYY-MM` (defaults to trailing 12 months), see qualifiedPipelineTrend.service.ts. */
export const getQualifiedPipelineTrendHandler = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const orgId = req.auth!.orgId!
  const { provider, fromMonth, toMonth } = req.query as unknown as GetQualifiedPipelineTrendQuery
  const result = await getQualifiedPipelineTrend(orgId, provider ?? 'hubspot', fromMonth, toMonth)
  sendSuccess(res, result)
})

/** Dashboard's "Lead -> MQL Conversion Rate" trend chart — `?provider=hubspot|salesforce&granularity=monthly|quarterly|yearly&from=YYYY-MM&to=YYYY-MM` (defaults to quarterly, trailing window sized to the granularity), see cmMetrics.service.ts's getLeadToMqlTrend. */
export const getLeadToMqlTrendHandler = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const orgId = req.auth!.orgId!
  const { provider, granularity, from, to } = req.query as unknown as GetLeadToMqlTrendQuery
  const result = await getLeadToMqlTrend(orgId, provider ?? 'hubspot', granularity ?? 'quarterly', from, to)
  sendSuccess(res, result)
})

/** Dashboard's "MQL -> SQL Conversion Rate" trend chart — same query params as the Lead -> MQL chart above, see cmMetrics.service.ts's getMqlToSqlTrend. */
export const getMqlToSqlTrendHandler = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const orgId = req.auth!.orgId!
  const { provider, granularity, from, to } = req.query as unknown as GetMqlToSqlTrendQuery
  const result = await getMqlToSqlTrend(orgId, provider ?? 'hubspot', granularity ?? 'quarterly', from, to)
  sendSuccess(res, result)
})

/** Record-level detail behind the Lead -> MQL trend chart — every record counted in each period's cohort, for the dashboard's "export to Excel" verification button. Same query params as the chart endpoint. */
export const getLeadToMqlTrendDetailHandler = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const orgId = req.auth!.orgId!
  const { provider, granularity, from, to } = req.query as unknown as GetLeadToMqlTrendQuery
  const result = await getLeadToMqlTrendDetail(orgId, provider ?? 'hubspot', granularity ?? 'quarterly', from, to)
  sendSuccess(res, result)
})

/** Record-level detail behind the MQL -> SQL trend chart — same purpose as the Lead -> MQL detail handler above, one transition over. */
export const getMqlToSqlTrendDetailHandler = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const orgId = req.auth!.orgId!
  const { provider, granularity, from, to } = req.query as unknown as GetMqlToSqlTrendQuery
  const result = await getMqlToSqlTrendDetail(orgId, provider ?? 'hubspot', granularity ?? 'quarterly', from, to)
  sendSuccess(res, result)
})
