import { Router } from 'express'
import * as metricsController from '../controller/metrics.controller'
import * as oryonController from '../oryon/oryon.controller'
import { requireAuth, requireOrgContext } from '../../../middleware/auth'
import { validateQuery } from '../../../middleware/validate'
import {
  getMetricQuerySchema,
  getProductRevenueGrowthQuerySchema,
  getProductRevenueGrowthDetailQuerySchema,
  getInvoiceRevenueGrowthByProductQuerySchema,
  getInvoiceRevenueGrowthByProductDetailQuerySchema,
  getInvoiceRevenueGrowthByClassQuerySchema,
  getInvoiceRevenueGrowthByClassDetailQuerySchema,
  getInvoiceRevenueGrowthByStateQuerySchema,
  getInvoiceRevenueGrowthByStateDetailQuerySchema,
  getRecurringRevenueTrendQuerySchema,
  getGAndAExpenseTrendQuerySchema,
  getNewCustomersTrendQuerySchema,
  getCustomerUpgradesTrendQuerySchema,
  getQualifiedPipelineTrendQuerySchema,
  getLeadToMqlTrendQuerySchema,
  getMqlToSqlTrendQuerySchema,
  getOpportunitiesByLeadSourceByMonthQuerySchema,
  getCustomerRevenueConcentrationQuerySchema,
  getCustomerRevenueConcentrationByMonthQuerySchema
} from '../validator/metrics.validator'

export const metricsRouter = Router()

const guards = [requireAuth, requireOrgContext, validateQuery(getMetricQuerySchema)] as const
const productRevenueGrowthGuards = [requireAuth, requireOrgContext, validateQuery(getProductRevenueGrowthQuerySchema)] as const
const productRevenueGrowthDetailGuards = [requireAuth, requireOrgContext, validateQuery(getProductRevenueGrowthDetailQuerySchema)] as const
const invoiceRevenueGrowthByProductGuards = [requireAuth, requireOrgContext, validateQuery(getInvoiceRevenueGrowthByProductQuerySchema)] as const
const invoiceRevenueGrowthByProductDetailGuards = [requireAuth, requireOrgContext, validateQuery(getInvoiceRevenueGrowthByProductDetailQuerySchema)] as const
const invoiceRevenueGrowthByClassGuards = [requireAuth, requireOrgContext, validateQuery(getInvoiceRevenueGrowthByClassQuerySchema)] as const
const invoiceRevenueGrowthByClassDetailGuards = [requireAuth, requireOrgContext, validateQuery(getInvoiceRevenueGrowthByClassDetailQuerySchema)] as const
const invoiceRevenueGrowthByStateGuards = [requireAuth, requireOrgContext, validateQuery(getInvoiceRevenueGrowthByStateQuerySchema)] as const
const invoiceRevenueGrowthByStateDetailGuards = [requireAuth, requireOrgContext, validateQuery(getInvoiceRevenueGrowthByStateDetailQuerySchema)] as const
const recurringRevenueTrendGuards = [requireAuth, requireOrgContext, validateQuery(getRecurringRevenueTrendQuerySchema)] as const
const gaExpenseTrendGuards = [requireAuth, requireOrgContext, validateQuery(getGAndAExpenseTrendQuerySchema)] as const
const newCustomersTrendGuards = [requireAuth, requireOrgContext, validateQuery(getNewCustomersTrendQuerySchema)] as const
const customerUpgradesTrendGuards = [requireAuth, requireOrgContext, validateQuery(getCustomerUpgradesTrendQuerySchema)] as const
const qualifiedPipelineTrendGuards = [requireAuth, requireOrgContext, validateQuery(getQualifiedPipelineTrendQuerySchema)] as const
const leadToMqlTrendGuards = [requireAuth, requireOrgContext, validateQuery(getLeadToMqlTrendQuerySchema)] as const
const mqlToSqlTrendGuards = [requireAuth, requireOrgContext, validateQuery(getMqlToSqlTrendQuerySchema)] as const
const opportunitiesByLeadSourceByMonthGuards = [requireAuth, requireOrgContext, validateQuery(getOpportunitiesByLeadSourceByMonthQuerySchema)] as const
const customerRevenueConcentrationGuards = [requireAuth, requireOrgContext, validateQuery(getCustomerRevenueConcentrationQuerySchema)] as const
const customerRevenueConcentrationByMonthGuards = [requireAuth, requireOrgContext, validateQuery(getCustomerRevenueConcentrationByMonthQuerySchema)] as const

// Oryon metrics: port of the reference Python app (mrr_app/), parity-checked by src/scripts/oryonParity
metricsRouter.get('/oryon/pages/:page', requireAuth, requireOrgContext, oryonController.getOryonPage)
metricsRouter.get('/oryon/metrics/:id', requireAuth, requireOrgContext, oryonController.getOryonMetric)
metricsRouter.get('/trend/:id', ...guards, metricsController.getMetricTrend)
metricsRouter.get('/qualified-pipeline-trend', ...qualifiedPipelineTrendGuards, metricsController.getQualifiedPipelineTrendHandler)
metricsRouter.get('/salesforce/campaign-won-opportunities', requireAuth, requireOrgContext, metricsController.getCampaignWonOpportunitiesHandler)
metricsRouter.get('/salesforce/campaign-won-opportunities/detail', requireAuth, requireOrgContext, metricsController.getCampaignWonOpportunitiesDetailHandler)
metricsRouter.get('/salesforce/campaign-roi', requireAuth, requireOrgContext, metricsController.getCampaignRoiHandler)
metricsRouter.get('/salesforce/competitor-win-rate', requireAuth, requireOrgContext, metricsController.getCompetitorWinRateHandler)
metricsRouter.get('/hubspot/lead-volume-vs-target-mql', requireAuth, requireOrgContext, metricsController.getLeadVolumeVsTargetHandler)
metricsRouter.get('/salesforce/leads-by-month-by-campaign', requireAuth, requireOrgContext, metricsController.getLeadsByMonthByCampaignHandler)
metricsRouter.get('/salesforce/opportunities-by-lead-source', requireAuth, requireOrgContext, metricsController.getOpportunitiesByLeadSourceHandler)
metricsRouter.get('/salesforce/opportunities-by-lead-source-by-month', ...opportunitiesByLeadSourceByMonthGuards, metricsController.getOpportunitiesByLeadSourceByMonthHandler)
metricsRouter.get('/quickbooks/customer-revenue-concentration', ...customerRevenueConcentrationGuards, metricsController.getCustomerRevenueConcentrationHandler)
metricsRouter.get('/quickbooks/customer-revenue-concentration/detail', ...customerRevenueConcentrationGuards, metricsController.getCustomerRevenueConcentrationDetailHandler)
metricsRouter.get('/quickbooks/customer-revenue-concentration-by-month', ...customerRevenueConcentrationByMonthGuards, metricsController.getCustomerRevenueConcentrationByMonthHandler)
metricsRouter.get(
  '/quickbooks/customer-revenue-concentration-by-month/detail',
  ...customerRevenueConcentrationByMonthGuards,
  metricsController.getCustomerRevenueConcentrationByMonthDetailHandler
)
metricsRouter.get('/lead-to-mql-trend', ...leadToMqlTrendGuards, metricsController.getLeadToMqlTrendHandler)
metricsRouter.get('/lead-to-mql-trend/detail', ...leadToMqlTrendGuards, metricsController.getLeadToMqlTrendDetailHandler)
metricsRouter.get('/mql-to-sql-trend', ...mqlToSqlTrendGuards, metricsController.getMqlToSqlTrendHandler)
metricsRouter.get('/mql-to-sql-trend/detail', ...mqlToSqlTrendGuards, metricsController.getMqlToSqlTrendDetailHandler)

// Live "Revenue growth by product" section (docs/server.js §5) — not pre-synced, see productRevenueGrowth.service.ts.
metricsRouter.get('/quickbooks/departments', requireAuth, requireOrgContext, metricsController.getQuickBooksDepartmentsHandler)
metricsRouter.get('/quickbooks/customer-states', requireAuth, requireOrgContext, metricsController.getQuickBooksCustomerStatesHandler)
metricsRouter.get('/quickbooks/product-revenue-growth', ...productRevenueGrowthGuards, metricsController.getProductRevenueGrowthHandler)
metricsRouter.get('/quickbooks/product-revenue-growth/detail', ...productRevenueGrowthDetailGuards, metricsController.getProductRevenueGrowthDetailHandler)
metricsRouter.get('/quickbooks/invoice-revenue-growth-by-product', ...invoiceRevenueGrowthByProductGuards, metricsController.getInvoiceRevenueGrowthByProductHandler)
metricsRouter.get(
  '/quickbooks/invoice-revenue-growth-by-product/detail',
  ...invoiceRevenueGrowthByProductDetailGuards,
  metricsController.getInvoiceRevenueGrowthByProductDetailHandler
)
metricsRouter.get('/quickbooks/invoice-revenue-growth-by-class', ...invoiceRevenueGrowthByClassGuards, metricsController.getInvoiceRevenueGrowthByClassHandler)
metricsRouter.get(
  '/quickbooks/invoice-revenue-growth-by-class/detail',
  ...invoiceRevenueGrowthByClassDetailGuards,
  metricsController.getInvoiceRevenueGrowthByClassDetailHandler
)
metricsRouter.get('/quickbooks/invoice-revenue-growth-by-state', ...invoiceRevenueGrowthByStateGuards, metricsController.getInvoiceRevenueGrowthByStateHandler)
metricsRouter.get(
  '/quickbooks/invoice-revenue-growth-by-state/detail',
  ...invoiceRevenueGrowthByStateDetailGuards,
  metricsController.getInvoiceRevenueGrowthByStateDetailHandler
)
metricsRouter.get('/quickbooks/recurring-revenue-trend', ...recurringRevenueTrendGuards, metricsController.getRecurringRevenueTrendHandler)
metricsRouter.get('/quickbooks/recurring-revenue-trend/detail', ...recurringRevenueTrendGuards, metricsController.getRecurringRevenueTrendDetailHandler)
metricsRouter.get('/quickbooks/ga-expense-trend', ...gaExpenseTrendGuards, metricsController.getGAndAExpenseTrendHandler)
metricsRouter.get('/quickbooks/cac-trend', requireAuth, requireOrgContext, metricsController.getCACTrendHandler)
metricsRouter.get('/quickbooks/new-customers-trend', ...newCustomersTrendGuards, metricsController.getNewCustomersTrendHandler)
metricsRouter.get('/quickbooks/new-customers-trend/detail', ...newCustomersTrendGuards, metricsController.getNewCustomersTrendDetailHandler)
metricsRouter.get('/quickbooks/customer-upgrades-trend', ...customerUpgradesTrendGuards, metricsController.getCustomerUpgradesTrendHandler)
metricsRouter.get('/quickbooks/customer-retention-trend-adjusted', ...customerUpgradesTrendGuards, metricsController.getCustomerRetentionTrendAdjustedHandler)
metricsRouter.get('/quickbooks/customer-retention-trend-adjusted/detail', ...customerUpgradesTrendGuards, metricsController.getCustomerRetentionTrendAdjustedDetailHandler)
metricsRouter.get('/quickbooks/customer-upgrades-trend/detail', ...customerUpgradesTrendGuards, metricsController.getCustomerUpgradesTrendDetailHandler)

metricsRouter.get('/vc-01', ...guards, metricsController.getVC01)
metricsRouter.get('/vc-02', ...guards, metricsController.getVC02)
metricsRouter.get('/vc-03', ...guards, metricsController.getVC03)
metricsRouter.get('/vc-04', ...guards, metricsController.getVC04)
metricsRouter.get('/vc-06', ...guards, metricsController.getVC06)
metricsRouter.get('/vc-07', ...guards, metricsController.getVC07)
metricsRouter.get('/vc-10', ...guards, metricsController.getVC10)
metricsRouter.get('/vc-13', ...guards, metricsController.getVC13)
metricsRouter.get('/vc-14', ...guards, metricsController.getVC14)
metricsRouter.get('/cb-05', ...guards, metricsController.getCB05)
metricsRouter.get('/cb-07', ...guards, metricsController.getCB07)
metricsRouter.get('/cb-10', ...guards, metricsController.getCB10)
metricsRouter.get('/cm-02', ...guards, metricsController.getCM02)
metricsRouter.get('/cm-03', ...guards, metricsController.getCM03)
metricsRouter.get('/cm-04', ...guards, metricsController.getCM04)
metricsRouter.get('/cm-05', ...guards, metricsController.getCM05)
metricsRouter.get('/cm-06', ...guards, metricsController.getCM06)
metricsRouter.get('/cm-07', ...guards, metricsController.getCM07)
metricsRouter.get('/cm-08', ...guards, metricsController.getCM08)
