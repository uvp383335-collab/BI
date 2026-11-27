import { Request, Response } from 'express'
import { asyncHandler } from '../../../shared/utils/asyncHandler'
import { sendSuccess } from '../../../shared/utils/apiResponse'
import { AppError } from '../../../shared/utils/AppError'
import { oryonDataFor } from './oryonData'
import { PAGES, Query } from './oryonPages'
import * as O from './oryonMetrics.service'
import { getOryonSettings, saveOryonSettings, resetOryonSettings } from './oryonSettings.service'

/** Oryon metric id -> MetricResult at one month (same values the dashboard shows). */
const METRIC_COMPUTES: Record<string, (orgId: string, month: string) => Promise<unknown>> = {
  'VC-01': O.oryonVC01, 'VC-02': O.oryonVC02, 'VC-03': O.oryonVC03, 'VC-04': O.oryonVC04, 'VC-06': O.oryonVC06,
  'VC-07': O.oryonVC07, 'VC-09': O.oryonVC09, 'VC-10': O.oryonVC10, 'VC-12': O.oryonVC12, 'VC-13': O.oryonVC13,
  'VC-14': O.oryonVC14, 'CB-05': O.oryonCB05, 'CB-07': O.oryonCB07, 'CB-10': O.oryonCB10, 'CM-02': O.oryonCM02,
  'CM-03': O.oryonCM03, 'CM-05': O.oryonCM05, 'CM-06': O.oryonCM06, 'CM-07': O.oryonCM07, 'CM-08': O.oryonCM08,
  'ER-05': O.oryonER05
}

const ALLOWED_QUERY = ['grain', 'window', 'scope', 'view', 'from', 'to', 'line', 'segment']
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/

/** GET /metrics/oryon/pages/:page — the full series a reference-app page shows (rows, latest, ...). */
export const getOryonPage = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const page = PAGES[String(req.params.page)]
  if (!page) throw AppError.notFound(`Unknown Oryon page ${req.params.page}`, 'ORYON_PAGE_NOT_FOUND')
  const q: Query = {}
  for (const k of ALLOWED_QUERY) {
    const v = req.query[k]
    if (typeof v === 'string' && v.length <= 64) q[k] = v
  }
  for (const k of ['from', 'to']) if (q[k] && !MONTH.test(q[k]!)) throw AppError.badRequest(`${k} must be YYYY-MM`, 'INVALID_MONTH')
  const data = await oryonDataFor(req.auth!.orgId!)
  sendSuccess(res, await page(data, q))
})

/** GET /metrics/oryon/metrics/:id?month=YYYY-MM — one metric at one month as a MetricResult. */
export const getOryonMetric = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const compute = METRIC_COMPUTES[String(req.params.id).toUpperCase()]
  if (!compute) throw AppError.notFound(`Unknown Oryon metric ${req.params.id}`, 'METRIC_NOT_FOUND')
  const month = typeof req.query.month === 'string' ? req.query.month : ''
  if (!MONTH.test(month)) throw AppError.badRequest('month must be YYYY-MM', 'INVALID_MONTH')
  sendSuccess(res, await compute(req.auth!.orgId!, month))
})

/** GET /metrics/oryon/settings — every Oryon settings section with current values, automatic suggestions and choices. */
export const getOryonSettingsHandler = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  sendSuccess(res, await getOryonSettings(req.auth!.orgId!))
})

/** PUT /metrics/oryon/settings/:section — save one section (owner/admin). */
export const saveOryonSettingsHandler = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  await saveOryonSettings(req.auth!.orgId!, String(req.params.section), req.body)
  sendSuccess(res, { saved: true })
})

/** DELETE /metrics/oryon/settings/:section — back to the automatic choices (owner/admin). */
export const resetOryonSettingsHandler = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  await resetOryonSettings(req.auth!.orgId!, String(req.params.section))
  sendSuccess(res, { reset: true })
})
