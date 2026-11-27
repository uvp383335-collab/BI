import { saveOryonSettings, resetOryonSettings, ORYON_SETTING_SECTIONS } from './oryonSettings.service'
import { getTenantConnection } from '../../../database/tenantConnection'
import { OrganizationModel } from '../../organizations/model/Organization.model'
import { clearOryonData } from './oryonData'

jest.mock('../../../database/tenantConnection')
jest.mock('../../organizations/model/Organization.model', () => ({ OrganizationModel: { updateOne: jest.fn() } }))
jest.mock('./oryonData', () => ({ clearOryonData: jest.fn(), OryonData: jest.fn() }))

const ORG = '6b071a4c0b4235082c7d5e64'
const settingsCol = { updateOne: jest.fn() }
const mappingCol = { bulkWrite: jest.fn(), deleteMany: jest.fn() }

beforeEach(() => {
  jest.clearAllMocks()
  ;(getTenantConnection as jest.Mock).mockResolvedValue({
    db: { collection: (name: string) => (name === 'mrr_product_mapping' ? mappingCol : settingsCol) }
  })
})

/** the $set the save wrote to mrr_settings */
const savedSet = () => settingsCol.updateOne.mock.calls[0][1].$set
const expectRejected = async (section: string, body: unknown, message: RegExp) => {
  await expect(saveOryonSettings(ORG, section, body)).rejects.toMatchObject({ message: expect.stringMatching(message) })
  expect(settingsCol.updateOne).not.toHaveBeenCalled()
}

describe('Oryon settings: saving writes the same keys the Python app writes', () => {
  it('product mapping upserts one mrr_product_mapping row per item', async () => {
    await saveOryonSettings(ORG, 'mapping', { mapping: { '28': 'subscription_monthly', '31': 'not_mrr' } })
    const ops = mappingCol.bulkWrite.mock.calls[0][0]
    expect(ops).toHaveLength(2)
    expect(ops[0].updateOne).toMatchObject({ filter: { itemId: '28' }, upsert: true, update: { $set: { itemId: '28', type: 'subscription_monthly' } } })
  })

  it('rejects an unknown mapping type', async () => {
    await expect(saveOryonSettings(ORG, 'mapping', { mapping: { '28': 'weekly' } })).rejects.toThrow('Invalid product mapping')
    expect(mappingCol.bulkWrite).not.toHaveBeenCalled()
  })

  it('general: uppercases countries and clamps the billing lag to 0-6', async () => {
    await saveOryonSettings(ORG, 'general', {
      start_month: '2024-01', early_invoice_day: 10, cad_countries: [' ca ', ''], fx_cad_usd: { '2024-01': 0.74 }, newlogo_lag_months: 9, newlogo_group_parent: true
    })
    expect(savedSet()).toEqual({
      start_month: '2024-01', early_invoice_day: 10, cad_countries: ['CA'], fx_cad_usd: { '2024-01': 0.74 }, newlogo_lag_months: 6, newlogo_group_parent: true
    })
  })

  it('general: rejects a bad start month and an early-invoice day outside 1-31', async () => {
    const ok = { start_month: '2024-01', early_invoice_day: 16, cad_countries: [], fx_cad_usd: {}, newlogo_lag_months: 1, newlogo_group_parent: false }
    await expectRejected('general', { ...ok, start_month: '2024-13' }, /./)
    await expectRejected('general', { ...ok, early_invoice_day: 40 }, /./)
  })

  it.each([
    ['cac', { account_ids: ['a', 'b'] }, { cac_account_ids: ['a', 'b'] }],
    ['ga', { account_ids: ['g'] }, { ga_account_ids: ['g'] }],
    ['recurring', { account_ids: [] }, { recurring_tag_ids: [] }],
    ['cogs', { line_map: { x: 'Platform' }, da_ids: ['x'] }, { cogs_account_map: { x: 'Platform' }, cogs_da_ids: ['x'] }],
    ['ebitda', { category_map: { x: 'opex' }, da_ids: [] }, { ebitda_account_map: { x: 'opex' }, ebitda_da_ids: [] }],
    ['ebitda_plan', { plan: { '2026-09': [1, 2] } }, { ebitda_plan: { '2026-09': [1, 2] } }],
    ['ltv', { cap: 60, threshold: 2.5, scope: 'subscription' }, { ltv_cap_months: 60, ltv_threshold: 2.5, ltv_grr_scope: 'subscription' }],
    ['concentration', { top_n: 500, group_parent: false }, { conc_top_n: 100, conc_group_parent: false }],
    ['diversification', { top_n: 0, threshold: 40 }, { div_top_n: 1, div_threshold: 40 }],
    ['mql', { plan_quarters: { '2026-Q3': 556 }, threshold: -5 }, { mql_plan_quarters: { '2026-Q3': 556 }, mql_threshold: -5 }]
  ])('%s', async (section, body, expected) => {
    await saveOryonSettings(ORG, section, body)
    expect(savedSet()).toEqual(expected)
    expect(settingsCol.updateOne.mock.calls[0][0]).toEqual({ _id: 'settings' })
    expect(settingsCol.updateOne.mock.calls[0][2]).toEqual({ upsert: true })
  })

  it('cash: needs an unrestricted account, clamps the look-back and keeps the map only when accounts are sent', async () => {
    const base = { sections: ['BankAccounts'], lookback: 20, restricted_adjust: 0, show_ar_check: true }
    await expectRejected('cash', { ...base, category_map: { a: 'exclude' } }, /unrestricted/)
    await saveOryonSettings(ORG, 'cash', { ...base, category_map: { a: 'unrestricted', b: 'restricted' } })
    expect(savedSet()).toEqual({ cash_sections: ['BankAccounts'], cash_lookback_months: 12, cash_restricted_adjust: 0, cash_show_ar_check: true, cash_account_map: { a: 'unrestricted', b: 'restricted' } })
    settingsCol.updateOne.mockClear()
    await saveOryonSettings(ORG, 'cash', base)
    expect(savedSet()).not.toHaveProperty('cash_account_map')
  })

  it('fcf: needs a capex account; without per-account balances it saves the section fallbacks instead', async () => {
    await expectRejected('fcf', { capex_map: { a: 'accum' }, show_ar_check: true }, /capex/)
    await saveOryonSettings(ORG, 'fcf', { capex_map: { a: 'capex' }, wc_map: { w: 'ar' }, show_ar_check: false })
    expect(savedSet()).toEqual({ fcf_show_ar_check: false, fcf_wc_map: { w: 'ar' }, fcf_capex_map: { a: 'capex' } })
    settingsCol.updateOne.mockClear()
    await saveOryonSettings(ORG, 'fcf', { capex_sections: [], fa_da_ids: ['d'], wc_section_map: { AR: 'ar' }, show_ar_check: true })
    expect(savedSet()).toEqual({ fcf_show_ar_check: true, fcf_wc_section_map: { AR: 'ar' }, fcf_capex_sections: ['FixedAssets'], fcf_fa_da_ids: ['d'] })
  })

  it('ccc: needs an AR and an AP account', async () => {
    await expectRejected('ccc', { account_map: { a: 'ar' }, include_da: true }, /AR and one AP/)
    await saveOryonSettings(ORG, 'ccc', { account_map: { a: 'ar', p: 'ap' }, include_da: false })
    expect(savedSet()).toEqual({ ccc_cogs_include_da: false, ccc_account_map: { a: 'ar', p: 'ap' } })
  })

  it('ccc: a section map naming only some sections is accepted (regression: zod 4 enum records are exhaustive)', async () => {
    await saveOryonSettings(ORG, 'ccc', { section_map: { AR: 'ar', AP: 'ap', OtherCurrentAssets: 'exclude' }, include_da: true })
    expect(savedSet()).toEqual({ ccc_cogs_include_da: true, ccc_section_map: { AR: 'ar', AP: 'ap', OtherCurrentAssets: 'exclude' } })
  })

  it('win rate: needs a New Business type; a blank loss-reason field is stored as "" like the Python app', async () => {
    const body = { provider: 'salesforce', competitor_field: '', loss_reason_field: null, exclude_loss_reasons: [' No Decision ', ''], new_business_types: ['New Business'], headline: '', window: 30 }
    await expectRejected('win_rate', { ...body, new_business_types: [] }, /New Business/)
    await saveOryonSettings(ORG, 'win_rate', body)
    expect(savedSet()).toEqual({
      wr_provider: 'salesforce', wr_competitor_field: null, wr_loss_reason_field: '', wr_exclude_loss_reasons: ['No Decision'],
      wr_new_business_types: ['New Business'], wr_headline: null, wr_window_months: 24
    })
  })

  it('funnel: MQL and SQL stages must differ; needs five maturity windows', async () => {
    const body = { provider: 'hubspot', lead_stage: 'lead', mql_stage: 'marketingqualifiedlead', sql_stage: 'salesqualifiedlead', opp_stage: 'opportunity', sql_via_mql: true, marketing_sources: ['ORGANIC_SEARCH'], dedupe_email: true, mature_days: [60, 90, 180, 60, 180] }
    await expectRejected('funnel', { ...body, sql_stage: 'marketingqualifiedlead' }, /must be different/)
    await expectRejected('funnel', { ...body, mature_days: [60] }, /./)
    await saveOryonSettings(ORG, 'funnel', body)
    expect(savedSet()).toMatchObject({ fn_provider: 'hubspot', fn_mql_stage: 'marketingqualifiedlead', fn_mature_days: [60, 90, 180, 60, 180] })
  })

  it('marketing ROI: drops channels without a name', async () => {
    await saveOryonSettings(ORG, 'roi', {
      provider: 'salesforce', value_field: 'arr', marketing_sources: ['Web'], new_business_types: ['New Business'], blended_accounts: ['m'], programs_accounts: [],
      channels: [{ name: ' Events ', sources: ['Trade Show'], gl_accounts: ['6130'] }, { name: '  ', sources: [], gl_accounts: [] }], threshold: 1
    })
    expect(savedSet().roi_channels).toEqual([{ name: 'Events', sources: ['Trade Show'], gl_accounts: ['6130'] }])
  })

  it('marketing-sourced: rejects an unknown deal value field', async () => {
    const body = { provider: 'salesforce', value_field: 'arr', marketing_sources: [], new_business_types: [], exclude_duplicates: true, true_new_logos: true, threshold: 0 }
    await expectRejected('msp', { ...body, value_field: 'mrr' }, /./)
    await saveOryonSettings(ORG, 'msp', body)
    expect(savedSet()).toMatchObject({ msp_value_field: 'arr', msp_exclude_duplicates: true })
  })

  it('refuses an unknown section', async () => {
    await expect(saveOryonSettings(ORG, 'nope', {})).rejects.toMatchObject({ status: 404 })
  })
})

describe('Oryon settings: every change refreshes the numbers', () => {
  it('a save drops the cached data and moves the org data version (the dashboard cache key)', async () => {
    await saveOryonSettings(ORG, 'ltv', { cap: 84, threshold: 3, scope: 'all' })
    expect(clearOryonData).toHaveBeenCalledWith(ORG)
    const [filter, update, opts] = (OrganizationModel.updateOne as jest.Mock).mock.calls[0]
    expect(String(filter._id)).toBe(ORG)
    expect(update.$set.updatedAt).toBeInstanceOf(Date)
    expect(opts).toEqual({ timestamps: false })
  })

  it('a rejected save changes nothing', async () => {
    await expect(saveOryonSettings(ORG, 'ltv', { cap: 9999, threshold: 3, scope: 'all' })).rejects.toBeTruthy()
    expect(clearOryonData).not.toHaveBeenCalled()
    expect(OrganizationModel.updateOne).not.toHaveBeenCalled()
  })
})

describe('Oryon settings: reset to automatic', () => {
  it('product mapping deletes every saved mapping', async () => {
    await resetOryonSettings(ORG, 'mapping')
    expect(mappingCol.deleteMany).toHaveBeenCalledWith({})
    expect(clearOryonData).toHaveBeenCalled()
  })

  it.each([
    ['cac', ['cac_account_ids']],
    ['cash', ['cash_account_ids', 'cash_account_map', 'cash_sections', 'cash_lookback_months', 'cash_restricted_adjust', 'cash_show_ar_check']],
    ['fcf', ['fcf_capex_map', 'fcf_capex_sections', 'fcf_fa_da_ids', 'fcf_wc_map', 'fcf_wc_section_map', 'fcf_show_ar_check']],
    ['concentration', ['conc_top_n', 'conc_group_parent', 'conc_item_lines']]
  ])('%s unsets its keys', async (section, keys) => {
    await resetOryonSettings(ORG, section)
    expect(Object.keys(settingsCol.updateOne.mock.calls[0][1].$unset).sort()).toEqual([...keys].sort())
  })

  it('every section can be reset', async () => {
    for (const section of ORYON_SETTING_SECTIONS) await resetOryonSettings(ORG, section)
    expect(settingsCol.updateOne).toHaveBeenCalledTimes(ORYON_SETTING_SECTIONS.length - 1)
  })
})
