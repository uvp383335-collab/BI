/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Oryon metric settings — read / save / reset, section by section, with the
 * same storage, validation and "what gets saved" rules as the reference
 * Python app's Settings page (mrr_app/app.py: settings_page + save_* /
 * reset_*). Settings live in the tenant's `mrr_settings` ({_id: "settings"})
 * and `mrr_product_mapping` collections, so the Python app and this app always
 * see the same settings and compute the same numbers.
 */
import { Types } from 'mongoose'
import { z } from 'zod'
import { getTenantConnection } from '../../../database/tenantConnection'
import { OrganizationModel } from '../../organizations/model/Organization.model'
import { AppError } from '../../../shared/utils/AppError'
import * as E from './engine'
import { OryonData, clearOryonData } from './oryonData'
import { Dict, truthy, or, sortedStr } from './pyCompat'

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/
const QUARTER = /^\d{4}-Q[1-4]$/
const id = z.string().min(1).max(200)
const ids = z.array(id).max(5000)
const label = z.string().max(300)

const pickRows = (rows: Dict[], keys: string[]) => rows.map((r) => Object.fromEntries(keys.map((k) => [k, r[k] ?? null])))

// ---------------------------------------------------------------------------------------------- read
/** Everything the Settings screens need: current values, automatic suggestions (with reasons) and the choices found in the data. */
export async function getOryonSettings(orgId: string): Promise<Dict> {
  const d = await OryonData.forOrg(orgId) // fresh read, never the shared cache: the screen must show what is saved now
  await d.load()
  const st = d.settings()
  const doc = d.settingsDoc

  const [cacAccs, cacSaved] = d.cacAccounts()
  const [cogsAccs, , , cogsSaved] = d.cogsAccounts()
  const [gaAccs, , gaSaved] = d.gaAccounts()
  const [ebAccs, , , ebSaved] = d.ebitdaAccounts()
  const [rtAccs, , rtSaved] = d.recurringAccounts()
  const [cashAccs, , cashSaved] = d.cashAccounts()
  const [capexAccs, , capexSaved] = d.fcfCapexAccounts()
  const [faDaAccs] = d.fcfFaDaAccounts(ebAccs)
  const [wcAccs, , wcSaved] = d.fcfWcAccounts()
  const [cccAccs, , cccSaved] = d.cccAccounts()
  const [wr, fn, roi, msp] = await Promise.all([d.wrConfig(), d.fnConfig(), d.roiConfig(), d.mspConfig()])
  const [, wrInfo] = await d.wrInputs()
  const bsLast = d.bsLastSectionTotals()
  const sectionsAvail = sortedStr(new Set(d.bsSnapshots.flatMap((x) => Object.keys((x.sectionTotals ?? {}) as Dict))))
  const acct = ['id', 'name', 'section', 'total', 'ttm', 'auto', 'reason']
  const dups = msp.duplicates as Map<string, string>

  return {
    general: {
      start_month: st.start_month, early_invoice_day: st.early_invoice_day, cad_countries: st.cad_countries,
      fx_cad_usd: st.fx_cad_usd, newlogo_lag_months: st.newlogo_lag_months, newlogo_group_parent: truthy(st.newlogo_group_parent)
    },
    mapping: {
      types: E.MAPPING_TYPES,
      products: pickRows(d.catalog(), ['itemId', 'name', 'category', 'frequency', 'lines', 'amount', 'classes', 'first', 'last', 'auto', 'reason', 'mapping', 'saved'])
    },
    cac: { saved: cacSaved, accounts: pickRows(cacAccs, [...acct, 'selected']) },
    cogs: { saved: cogsSaved, choices: E.COGS_LINE_CHOICES, accounts: pickRows(cogsAccs, [...acct, 'auto_da', 'line', 'da']) },
    ga: { saved: gaSaved, accounts: pickRows(gaAccs, [...acct, 'selected']) },
    ebitda: { saved: ebSaved, categories: E.EBITDA_CATEGORIES, accounts: pickRows(ebAccs, [...acct, 'auto_da', 'cat', 'da']) },
    ebitda_plan: { plan: d.plan() },
    ltv: { cap: Number(st.ltv_cap_months ?? 84), threshold: Number(st.ltv_threshold ?? 3), scope: st.ltv_grr_scope === 'subscription' ? 'subscription' : 'all' },
    recurring: { saved: rtSaved, accounts: pickRows(rtAccs, ['id', 'name', 'total', 'ttm', 'auto', 'reason', 'selected', 'in_revenue']) },
    cash: {
      saved: cashSaved, has_accounts: cashAccs.length > 0, categories: E.CASH_CATEGORIES,
      accounts: pickRows(cashAccs, ['id', 'name', 'section', 'latest', 'latest_month', 'auto', 'reason', 'cat']),
      sections: or(st.cash_sections, ['BankAccounts']), sections_available: sectionsAvail.map((k) => ({ key: k, total: (bsLast[k] ?? {}).Total ?? null })),
      lookback: Number(or(st.cash_lookback_months, 3)), restricted_adjust: Number(or(st.cash_restricted_adjust, 0)),
      show_ar_check: truthy(st.cash_show_ar_check ?? true)
    },
    fcf: {
      capex_saved: capexSaved, wc_saved: wcSaved, has_accounts: capexAccs.length > 0, has_wc_accounts: wcAccs.length > 0,
      capex_categories: E.CAPEX_CATEGORIES, wc_categories: E.WC_CATEGORIES, wc_sections: E.WC_SECTIONS,
      capex_accounts: pickRows(capexAccs, ['id', 'name', 'section', 'latest', 'auto', 'reason', 'cat']),
      wc_accounts: pickRows(wcAccs, ['id', 'name', 'section', 'latest', 'auto', 'reason', 'cat']),
      capex_sections: or(st.fcf_capex_sections, ['FixedAssets']), wc_section_map: or(st.fcf_wc_section_map, E.DEFAULT_SETTINGS.fcf_wc_section_map),
      fa_da_accounts: pickRows(faDaAccs, ['id', 'name', 'auto_fa', 'fa']), sections_available: sectionsAvail,
      show_ar_check: truthy(st.fcf_show_ar_check ?? true)
    },
    ccc: {
      saved: cccSaved, has_accounts: cccAccs.length > 0, categories: E.CCC_CATEGORIES, sections: E.CCC_SECTIONS,
      accounts: pickRows(cccAccs, ['id', 'name', 'section', 'latest', 'auto', 'reason', 'cat']),
      section_map: or(st.ccc_section_map, E.DEFAULT_SETTINGS.ccc_section_map), include_da: truthy(st.ccc_cogs_include_da ?? true)
    },
    concentration: { top_n: Number(or(st.conc_top_n, 10)), group_parent: truthy(st.conc_group_parent ?? true), classes: d.invoiceClasses() },
    diversification: d.divSettings(),
    win_rate: {
      provider: wr.provider, providers: wr.providers, labels: wr.labels, types: wr.types,
      standard_fields: { [E.STD_COMPETITOR]: 'Standard field: competitor', [E.STD_COMPETITORS]: 'Standard field: competitors (OpportunityCompetitor)' },
      competitor_field: wr.comp_field, competitor_auto: wr.comp_auto, loss_reason_field: wr.loss_field, loss_reason_auto: wr.loss_auto,
      exclude_loss_reasons: wr.exclude_reasons, new_business_types: wr.nb_types ?? [], new_business_auto: wr.nb_auto,
      headline: doc.wr_headline ?? null, headline_shown: wrInfo.headline, competitors: wrInfo.competitors, window: wr.window
    },
    funnel: {
      provider: fn.provider, providers: fn.providers, stages: fn.stages, sources: fn.sources, source_counts: fn.source_counts,
      lead_stage: fn.lead_stage, mql_stage: fn.mql_stage, sql_stage: fn.sql_stage, opp_stage: fn.opp_stage,
      sql_via_mql: fn.sql_via_mql, marketing_sources: fn.marketing, marketing_auto: fn.mkt_auto, dedupe_email: fn.dedupe, mature_days: fn.mature
    },
    mql: { plan_quarters: d.mqlPlanQuarters(), threshold: Number(or(st.mql_threshold, 0)), stage: fn.mql_stage, provider: fn.provider },
    roi: {
      provider: roi.provider, providers: roi.providers, value_field: roi.value_field, sources: roi.sources, types: roi.types,
      accounts: (roi.accounts as [string, string][]).map(([a, n]) => ({ id: a, name: n })),
      marketing_sources: roi.mk_sources ?? [], marketing_auto: roi.mk_auto, new_business_types: roi.nb_types ?? [], new_business_auto: roi.nb_auto,
      blended_accounts: roi.blended_ids ?? [], blended_auto: roi.bl_auto, programs_accounts: roi.programs_ids ?? [], programs_auto: roi.pr_auto,
      channels: roi.channels, threshold: roi.threshold
    },
    msp: {
      provider: msp.provider, providers: msp.providers, value_field: msp.value_field, sources: msp.sources, types: msp.types,
      marketing_sources: msp.mk_sources ?? [], marketing_auto: msp.mk_auto, new_business_types: msp.nb_types ?? [], new_business_auto: msp.nb_auto,
      exclude_duplicates: msp.exclude_dups, true_new_logos: msp.true_new, threshold: msp.threshold,
      duplicates: Array.from(dups.entries()).map(([accountId, original]) => ({ accountId, original }))
    }
  }
}

// ---------------------------------------------------------------------------------------------- write
const yesNo = z.boolean()
const provider = z.enum(['salesforce', 'hubspot'])
const valueField = z.enum(['arr', 'amount'])
const strList = z.array(label).max(500)

/** Per section: body schema, and the update it turns into (what the Python app's save_* sets). */
const SECTIONS: Record<string, { schema: z.ZodType; set: (b: any) => Dict; reset: string[] }> = {
  general: {
    schema: z.object({
      start_month: z.string().regex(MONTH), early_invoice_day: z.number().int().min(1).max(31),
      cad_countries: z.array(z.string().max(40)).max(50), fx_cad_usd: z.record(z.string().regex(MONTH), z.number().positive()),
      newlogo_lag_months: z.number().int(), newlogo_group_parent: yesNo
    }),
    set: (b) => ({
      start_month: b.start_month, early_invoice_day: b.early_invoice_day,
      cad_countries: b.cad_countries.map((c: string) => c.trim().toUpperCase()).filter(Boolean), fx_cad_usd: b.fx_cad_usd,
      newlogo_lag_months: Math.max(0, Math.min(6, b.newlogo_lag_months)), newlogo_group_parent: b.newlogo_group_parent
    }),
    reset: ['start_month', 'early_invoice_day', 'cad_countries', 'fx_cad_usd', 'newlogo_lag_months', 'newlogo_group_parent']
  },
  cac: { schema: z.object({ account_ids: ids }), set: (b) => ({ cac_account_ids: b.account_ids }), reset: ['cac_account_ids'] },
  cogs: {
    schema: z.object({ line_map: z.record(id, z.enum(['Platform', 'Services', 'Hardware', 'Unassigned', 'Exclude'])), da_ids: ids }),
    set: (b) => ({ cogs_account_map: b.line_map, cogs_da_ids: b.da_ids }), reset: ['cogs_account_map', 'cogs_da_ids']
  },
  ga: { schema: z.object({ account_ids: ids }), set: (b) => ({ ga_account_ids: b.account_ids }), reset: ['ga_account_ids'] },
  ebitda: {
    schema: z.object({ category_map: z.record(id, z.enum(['revenue', 'cogs', 'opex', 'below', 'exclude'])), da_ids: ids }),
    set: (b) => ({ ebitda_account_map: b.category_map, ebitda_da_ids: b.da_ids }), reset: ['ebitda_account_map', 'ebitda_da_ids']
  },
  ebitda_plan: {
    schema: z.object({ plan: z.record(z.string().regex(MONTH), z.tuple([z.number(), z.number()])) }),
    set: (b) => ({ ebitda_plan: b.plan }), reset: ['ebitda_plan']
  },
  ltv: {
    schema: z.object({ cap: z.number().min(1).max(600), threshold: z.number().gt(0).max(50), scope: z.enum(['all', 'subscription']) }),
    set: (b) => ({ ltv_cap_months: b.cap, ltv_threshold: b.threshold, ltv_grr_scope: b.scope }),
    reset: ['ltv_cap_months', 'ltv_threshold', 'ltv_grr_scope']
  },
  recurring: { schema: z.object({ account_ids: ids }), set: (b) => ({ recurring_tag_ids: b.account_ids }), reset: ['recurring_tag_ids'] },
  cash: {
    schema: z.object({
      category_map: z.record(id, z.enum(['unrestricted', 'restricted', 'exclude'])).optional(),
      sections: z.array(z.string().max(100)).min(1).max(50), lookback: z.number().int(), restricted_adjust: z.number(), show_ar_check: yesNo
    }),
    set: (b) => {
      if (b.category_map && !Object.values(b.category_map).includes('unrestricted')) {
        throw AppError.badRequest('Pick at least one unrestricted cash account', 'ORYON_SETTINGS_INVALID')
      }
      const u: Dict = {
        cash_sections: b.sections, cash_lookback_months: Math.max(1, Math.min(12, b.lookback)),
        cash_restricted_adjust: b.restricted_adjust, cash_show_ar_check: b.show_ar_check
      }
      if (b.category_map) u.cash_account_map = b.category_map
      return u
    },
    // the Python reset only clears the account picks; "Reset to automatic" here also restores the defaults below (same defaults in both apps)
    reset: ['cash_account_ids', 'cash_account_map', 'cash_sections', 'cash_lookback_months', 'cash_restricted_adjust', 'cash_show_ar_check']
  },
  fcf: {
    schema: z.object({
      capex_map: z.record(id, z.enum(['capex', 'accum', 'exclude'])).optional(),
      capex_sections: z.array(z.string().max(100)).max(50).optional(), fa_da_ids: ids.optional(),
      wc_map: z.record(id, z.enum(['ar', 'prepaid', 'inventory', 'ap', 'credit_card', 'accrued', 'deferred_revenue', 'exclude'])).optional(),
      wc_section_map: z.record(z.enum(['AR', 'OtherCurrentAssets', 'AP', 'CreditCards', 'OtherCurrentLiabilities']),
        z.enum(['ar', 'prepaid', 'inventory', 'ap', 'credit_card', 'accrued', 'deferred_revenue', 'exclude'])).optional(),
      show_ar_check: yesNo
    }),
    set: (b) => {
      if (b.capex_map && !Object.values(b.capex_map).includes('capex')) throw AppError.badRequest('Pick at least one capex account', 'ORYON_SETTINGS_INVALID')
      const u: Dict = { fcf_show_ar_check: b.show_ar_check }
      if (b.wc_map) u.fcf_wc_map = b.wc_map
      else if (b.wc_section_map) u.fcf_wc_section_map = b.wc_section_map
      if (b.capex_map) u.fcf_capex_map = b.capex_map
      else {
        u.fcf_capex_sections = b.capex_sections?.length ? b.capex_sections : ['FixedAssets']
        u.fcf_fa_da_ids = b.fa_da_ids ?? []
      }
      return u
    },
    reset: ['fcf_capex_map', 'fcf_capex_sections', 'fcf_fa_da_ids', 'fcf_wc_map', 'fcf_wc_section_map', 'fcf_show_ar_check']
  },
  ccc: {
    schema: z.object({
      account_map: z.record(id, z.enum(['ar', 'inventory', 'ap', 'exclude'])).optional(),
      section_map: z.record(z.enum(['AR', 'OtherCurrentAssets', 'AP', 'CreditCards', 'OtherCurrentLiabilities']), z.enum(['ar', 'inventory', 'ap', 'exclude'])).optional(),
      include_da: yesNo
    }),
    set: (b) => {
      const u: Dict = { ccc_cogs_include_da: b.include_da }
      if (b.account_map) {
        const v = Object.values(b.account_map)
        if (!v.includes('ar') || !v.includes('ap')) throw AppError.badRequest('Pick at least one AR and one AP account', 'ORYON_SETTINGS_INVALID')
        u.ccc_account_map = b.account_map
      } else if (b.section_map) u.ccc_section_map = b.section_map
      return u
    },
    reset: ['ccc_account_map', 'ccc_section_map', 'ccc_cogs_include_da']
  },
  concentration: {
    schema: z.object({ top_n: z.number().int(), group_parent: yesNo }),
    set: (b) => ({ conc_top_n: Math.max(1, Math.min(100, b.top_n)), conc_group_parent: b.group_parent }),
    reset: ['conc_top_n', 'conc_group_parent', 'conc_item_lines']
  },
  diversification: {
    schema: z.object({ top_n: z.number().int(), threshold: z.number() }),
    set: (b) => ({ div_top_n: Math.max(1, Math.min(100, b.top_n)), div_threshold: b.threshold }), reset: ['div_top_n', 'div_threshold']
  },
  win_rate: {
    schema: z.object({
      provider, competitor_field: label.nullable(), loss_reason_field: label.nullable(), exclude_loss_reasons: strList,
      new_business_types: strList.min(1, 'Pick at least one New Business deal type'), headline: label.nullable(), window: z.number().int()
    }),
    set: (b) => ({
      wr_provider: b.provider, wr_competitor_field: b.competitor_field || null, wr_loss_reason_field: b.loss_reason_field || '',
      wr_exclude_loss_reasons: b.exclude_loss_reasons.map((x: string) => x.trim()).filter(Boolean),
      wr_new_business_types: b.new_business_types, wr_headline: b.headline || null, wr_window_months: Math.max(1, Math.min(24, b.window))
    }),
    reset: ['wr_provider', 'wr_competitor_field', 'wr_loss_reason_field', 'wr_exclude_loss_reasons', 'wr_new_business_types', 'wr_headline', 'wr_window_months']
  },
  funnel: {
    schema: z.object({
      provider, lead_stage: label, mql_stage: label, sql_stage: label, opp_stage: label, sql_via_mql: yesNo,
      marketing_sources: strList, dedupe_email: yesNo, mature_days: z.array(z.number().int().min(0)).length(5)
    }),
    set: (b) => {
      if ((b.mql_stage || 'marketingqualifiedlead') === (b.sql_stage || 'salesqualifiedlead')) {
        throw AppError.badRequest('The MQL and SQL stages must be different', 'ORYON_SETTINGS_INVALID')
      }
      return {
        fn_provider: b.provider, fn_lead_stage: b.lead_stage || 'lead', fn_mql_stage: b.mql_stage || 'marketingqualifiedlead',
        fn_sql_stage: b.sql_stage || 'salesqualifiedlead', fn_opp_stage: b.opp_stage || 'opportunity', fn_sql_via_mql: b.sql_via_mql,
        fn_marketing_sources: b.marketing_sources, fn_dedupe_email: b.dedupe_email, fn_mature_days: b.mature_days
      }
    },
    reset: ['fn_provider', 'fn_lead_stage', 'fn_mql_stage', 'fn_sql_stage', 'fn_opp_stage', 'fn_sql_via_mql', 'fn_marketing_sources', 'fn_dedupe_email', 'fn_mature_days']
  },
  mql: {
    schema: z.object({ plan_quarters: z.record(z.string().regex(QUARTER), z.number().min(0)), threshold: z.number() }),
    set: (b) => ({ mql_plan_quarters: b.plan_quarters, mql_threshold: b.threshold }), reset: ['mql_plan_quarters', 'mql_threshold']
  },
  roi: {
    schema: z.object({
      provider, value_field: valueField, marketing_sources: strList, new_business_types: strList, blended_accounts: ids, programs_accounts: ids,
      channels: z.array(z.object({ name: z.string().max(100), sources: strList, gl_accounts: strList })).max(50), threshold: z.number()
    }),
    set: (b) => ({
      roi_provider: b.provider, roi_value_field: b.value_field, roi_marketing_sources: b.marketing_sources,
      roi_new_business_types: b.new_business_types, roi_blended_accounts: b.blended_accounts, roi_programs_accounts: b.programs_accounts,
      roi_channels: b.channels.map((c: Dict) => ({ ...c, name: c.name.trim() })).filter((c: Dict) => c.name), roi_threshold: b.threshold
    }),
    reset: ['roi_provider', 'roi_value_field', 'roi_marketing_sources', 'roi_new_business_types', 'roi_blended_accounts', 'roi_programs_accounts', 'roi_channels', 'roi_threshold']
  },
  msp: {
    schema: z.object({
      provider, value_field: valueField, marketing_sources: strList, new_business_types: strList,
      exclude_duplicates: yesNo, true_new_logos: yesNo, threshold: z.number()
    }),
    set: (b) => ({
      msp_provider: b.provider, msp_value_field: b.value_field, msp_marketing_sources: b.marketing_sources,
      msp_new_business_types: b.new_business_types, msp_exclude_duplicates: b.exclude_duplicates,
      msp_true_new_logos: b.true_new_logos, msp_threshold: b.threshold
    }),
    reset: ['msp_provider', 'msp_value_field', 'msp_marketing_sources', 'msp_new_business_types', 'msp_exclude_duplicates', 'msp_true_new_logos', 'msp_threshold']
  }
}

export const ORYON_SETTING_SECTIONS = ['mapping', ...Object.keys(SECTIONS)]

/** A settings change must show at once: drop the cached data and move the org's data version (dashboard cache key). */
async function afterChange(orgId: string): Promise<void> {
  clearOryonData(orgId)
  await OrganizationModel.updateOne({ _id: new Types.ObjectId(orgId) }, { $set: { updatedAt: new Date() } }, { timestamps: false })
}

const mappingSchema = z.object({ mapping: z.record(id, z.enum(Object.keys(E.MAPPING_TYPES) as [string, ...string[]])) })

export async function saveOryonSettings(orgId: string, section: string, body: unknown): Promise<void> {
  const conn = await getTenantConnection(orgId)
  const db = conn.db!
  if (section === 'mapping') {
    const parsed = mappingSchema.safeParse(body)
    if (!parsed.success) throw AppError.badRequest('Invalid product mapping', 'ORYON_SETTINGS_INVALID', parsed.error.issues)
    const now = new Date()
    const ops = Object.entries(parsed.data.mapping).map(([itemId, type]) => ({
      updateOne: { filter: { itemId }, update: { $set: { itemId, type, updatedAt: now } }, upsert: true }
    }))
    if (ops.length) await db.collection('mrr_product_mapping').bulkWrite(ops, { ordered: false })
    return afterChange(orgId)
  }
  const def = SECTIONS[section]
  if (!def) throw AppError.notFound(`Unknown settings section ${section}`, 'ORYON_SETTINGS_SECTION_NOT_FOUND')
  const parsed = def.schema.safeParse(body)
  if (!parsed.success) throw AppError.badRequest(parsed.error.issues[0]?.message ?? 'Invalid settings', 'ORYON_SETTINGS_INVALID', parsed.error.issues)
  await db.collection('mrr_settings').updateOne({ _id: 'settings' as any }, { $set: def.set(parsed.data) }, { upsert: true })
  await afterChange(orgId)
}

/** Back to the automatic choices (the Python app's reset_* routes). */
export async function resetOryonSettings(orgId: string, section: string): Promise<void> {
  const conn = await getTenantConnection(orgId)
  const db = conn.db!
  if (section === 'mapping') {
    await db.collection('mrr_product_mapping').deleteMany({})
    return afterChange(orgId)
  }
  const def = SECTIONS[section]
  if (!def) throw AppError.notFound(`Unknown settings section ${section}`, 'ORYON_SETTINGS_SECTION_NOT_FOUND')
  await db.collection('mrr_settings').updateOne({ _id: 'settings' as any }, { $unset: Object.fromEntries(def.reset.map((k) => [k, ''])) }, { upsert: true })
  await afterChange(orgId)
}
