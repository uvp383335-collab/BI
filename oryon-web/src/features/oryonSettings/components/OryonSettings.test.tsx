import React from 'react'
import { render, screen, within, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { OryonMetricSettings } from './OryonSettings'

const save = vi.fn()
const reset = vi.fn()
let payload: Record<string, unknown>

vi.mock('../hooks/useOryonSettings', () => ({
  useOryonSettings: () => ({ data: payload, isLoading: false, error: null }),
  useSaveOryonSettings: () => ({ mutateAsync: save, isPending: false }),
  useResetOryonSettings: () => ({ mutateAsync: reset, isPending: false })
}))

const acct = (id: string, name: string, extra: Record<string, unknown> = {}) => ({ id, name, section: 'expenses', total: 1000, ttm: 500, reason: 'r', ...extra })

/** A trimmed GET /metrics/oryon/settings payload: two or three rows per section. */
function fixture(): Record<string, unknown> {
  return {
    general: { start_month: '2023-10', early_invoice_day: 16, cad_countries: ['CA', 'CAN'], fx_cad_usd: { '2026-01': 0.72 }, newlogo_lag_months: 1, newlogo_group_parent: false },
    mapping: {
      types: { subscription_monthly: 'Subscription - monthly', subscription_yearly: 'Subscription - annual (÷12)', not_mrr: 'Not MRR (one-time / usage / credit)' },
      products: [
        { itemId: '28', name: 'Platform Subscription', classes: '-', lines: 10, amount: 1000, first: '2024-08', last: '2026-09', auto: 'subscription_monthly', reason: 'name says monthly', mapping: 'subscription_monthly', saved: false },
        { itemId: '31', name: 'GPS Hardware Kit', classes: '-', lines: 2, amount: 50, first: '2024-08', last: '2026-07', auto: 'not_mrr', reason: 'hardware', mapping: 'not_mrr', saved: false }
      ]
    },
    cac: { saved: false, accounts: [acct('s1', 'Sales & Marketing - Salaries', { auto: true, selected: true }), acct('s2', 'Sales & Marketing - Advertising', { auto: true, selected: true })] },
    cogs: {
      saved: false, choices: { Platform: 'Platform', Services: 'Services', Hardware: 'Hardware', Unassigned: 'Company only', Exclude: 'Exclude' },
      accounts: [acct('c1', 'Hosting', { section: 'cogs', auto: 'Platform', auto_da: false, line: 'Platform', da: false })]
    },
    ga: { saved: false, accounts: [acct('g1', 'G&A - Rent', { auto: true, selected: true })] },
    ebitda: {
      saved: false, categories: { revenue: 'Revenue', cogs: 'COGS', opex: 'Opex', below: 'Below EBITDA', exclude: 'Exclude' },
      accounts: [acct('e1', 'Depreciation', { auto: 'opex', auto_da: true, cat: 'opex', da: true })]
    },
    ebitda_plan: { plan: {} },
    ltv: { cap: 84, threshold: 3, scope: 'all' },
    recurring: { saved: false, accounts: [{ id: 'r1', name: 'Subscription Revenue', total: 1, ttm: 1, auto: true, reason: 'r', selected: true, in_revenue: true }] },
    cash: {
      saved: false, has_accounts: true, categories: { unrestricted: 'Unrestricted cash', restricted: 'Restricted cash', exclude: 'Exclude' },
      accounts: [{ id: 'b1', name: 'Checking', section: 'BankAccounts', latest: 900, auto: 'unrestricted', reason: 'r', cat: 'unrestricted' }],
      sections: ['BankAccounts'], sections_available: [{ key: 'BankAccounts', total: 900 }], lookback: 3, restricted_adjust: 500000, show_ar_check: true
    },
    fcf: {
      capex_saved: false, wc_saved: false, has_accounts: true, has_wc_accounts: false,
      capex_categories: { capex: 'Capex', accum: 'Accumulated', exclude: 'Exclude' },
      wc_categories: { ar: 'AR', prepaid: 'Prepaid', inventory: 'Inventory', ap: 'AP', credit_card: 'Credit card', accrued: 'Accrued', deferred_revenue: 'Deferred revenue', exclude: 'Exclude' },
      wc_sections: ['AR', 'AP'], capex_accounts: [{ id: 'f1', name: 'Computers', section: 'FixedAssets', latest: 10, auto: 'capex', reason: 'r', cat: 'capex' }],
      wc_accounts: [], capex_sections: ['FixedAssets'], wc_section_map: { AR: 'ar', AP: 'ap' }, fa_da_accounts: [], sections_available: ['FixedAssets'], show_ar_check: true
    },
    ccc: {
      saved: false, has_accounts: false, categories: { ar: 'AR', inventory: 'Inventory', ap: 'AP', exclude: 'Exclude' },
      sections: ['AR', 'AP', 'OtherCurrentAssets'], accounts: [], section_map: { AR: 'ar', AP: 'ap' }, include_da: true
    },
    concentration: { top_n: 10, group_parent: true, classes: [] },
    diversification: { top_n: 5, threshold: 0, group_parent: true },
    win_rate: {
      provider: 'salesforce', providers: ['hubspot', 'salesforce'], labels: ['Primary Competitor'], types: ['New Business', 'Renewal', 'Expansion'],
      standard_fields: { '@competitor': 'Standard field: competitor' }, competitor_field: 'Primary Competitor', competitor_auto: 'Primary Competitor',
      loss_reason_field: null, loss_reason_auto: null, exclude_loss_reasons: ['No Decision / Status Quo'], new_business_types: ['New Business'],
      new_business_auto: ['New Business'], headline: null, headline_shown: 'Verdance FSM', competitors: ['Verdance FSM', 'FieldPro'], window: 6
    },
    funnel: {
      provider: 'hubspot', providers: ['hubspot'], stages: ['lead', 'marketingqualifiedlead', 'salesqualifiedlead', 'opportunity'], sources: ['ORGANIC_SEARCH', 'OFFLINE'],
      source_counts: { ORGANIC_SEARCH: 5, OFFLINE: 2 }, lead_stage: 'lead', mql_stage: 'marketingqualifiedlead', sql_stage: 'salesqualifiedlead', opp_stage: 'opportunity',
      sql_via_mql: true, marketing_sources: ['ORGANIC_SEARCH'], marketing_auto: ['ORGANIC_SEARCH'], dedupe_email: true, mature_days: [60, 90, 180, 60, 180]
    },
    mql: { plan_quarters: { '2026-Q3': 556 }, threshold: 0, stage: 'marketingqualifiedlead', provider: 'hubspot' },
    roi: {
      provider: 'salesforce', providers: ['salesforce'], value_field: 'arr', sources: ['Trade Show', 'Web'], types: ['New Business'],
      accounts: [{ id: 'm1', name: 'Sales & Marketing - Advertising' }], marketing_sources: ['Trade Show', 'Web'], marketing_auto: ['Trade Show', 'Web'],
      new_business_types: ['New Business'], new_business_auto: ['New Business'], blended_accounts: [], blended_auto: [], programs_accounts: [], programs_auto: [],
      channels: [{ name: 'Events', sources: ['Trade Show'], gl_accounts: ['6130'] }], threshold: 1
    },
    msp: {
      provider: 'salesforce', providers: ['salesforce'], value_field: 'arr', sources: ['Web', 'Partner'], types: ['New Business'], marketing_sources: ['Web'],
      marketing_auto: ['Web'], new_business_types: ['New Business'], new_business_auto: ['New Business'], exclude_duplicates: true, true_new_logos: true, threshold: 0,
      duplicates: [{ accountId: 'a2', original: 'Acme' }]
    }
  }
}

const onError = vi.fn()
const renderPage = (canManage = true) => render(<OryonMetricSettings canManage={canManage} onError={onError} />)
/** the <details> card of a section, by its title */
const section = (title: string) => screen.getByRole('heading', { name: title }).closest('details') as HTMLElement
const clickSave = (title: string) => userEvent.click(within(section(title)).getByRole('button', { name: 'Save' }))
const lastBody = () => save.mock.calls[save.mock.calls.length - 1][0]

beforeEach(() => {
  payload = fixture()
  save.mockReset().mockResolvedValue(undefined)
  reset.mockReset().mockResolvedValue(undefined)
  onError.mockReset()
})

describe('Metric settings (Oryon)', () => {
  it('shows all 19 sections', () => {
    renderPage()
    expect(screen.getAllByRole('heading', { level: 3 })).toHaveLength(19)
  })

  it('product mapping sends every product with its chosen type', async () => {
    renderPage()
    await userEvent.selectOptions(within(section('Product mapping (MRR)')).getAllByRole('combobox')[1], 'subscription_yearly')
    await clickSave('Product mapping (MRR)')
    expect(lastBody()).toEqual({ section: 'mapping', body: { mapping: { '28': 'subscription_monthly', '31': 'subscription_yearly' } } })
  })

  it('general parses the CAD rate lines, and refuses a bad line without saving', async () => {
    renderPage()
    const box = within(section('General')).getByRole('textbox', { name: /CAD → USD rate per month/ })
    fireEvent.change(box, { target: { value: '2026-01, 0.72\n2026-02\t0.73' } })
    await clickSave('General')
    expect(lastBody().body).toMatchObject({ fx_cad_usd: { '2026-01': 0.72, '2026-02': 0.73 }, cad_countries: ['CA', 'CAN'], early_invoice_day: 16 })

    fireEvent.change(box, { target: { value: 'January, 0.7' } })
    save.mockClear()
    await clickSave('General')
    expect(save).not.toHaveBeenCalled()
    expect(onError).toHaveBeenCalledWith(expect.stringContaining('YYYY-MM, rate'))
  })

  it('CAC sends the ticked accounts', async () => {
    renderPage()
    await userEvent.click(within(section('CAC expense accounts')).getAllByRole('checkbox')[0])
    await clickSave('CAC expense accounts')
    expect(lastBody()).toEqual({ section: 'cac', body: { account_ids: ['s2'] } })
  })

  it('COGS % sends the product line and D&A choices', async () => {
    renderPage()
    const s = section('COGS % accounts')
    await userEvent.selectOptions(within(s).getByRole('combobox'), 'Services')
    await userEvent.click(within(s).getByRole('checkbox'))
    await clickSave('COGS % accounts')
    expect(lastBody()).toEqual({ section: 'cogs', body: { line_map: { c1: 'Services' }, da_ids: ['c1'] } })
  })

  it('EBITDA plan parses "month, EBITDA, revenue" lines and refuses a short line', async () => {
    renderPage()
    const box = within(section('EBITDA & revenue plan')).getByRole('textbox')
    fireEvent.change(box, { target: { value: 'Month, EBITDA, Revenue\n2026-09, $150_000, 300000' } })
    await clickSave('EBITDA & revenue plan')
    expect(lastBody()).toEqual({ section: 'ebitda_plan', body: { plan: { '2026-09': [150000, 300000] } } })
    fireEvent.change(box, { target: { value: '2026-09, 1' } })
    save.mockClear()
    await clickSave('EBITDA & revenue plan')
    expect(save).not.toHaveBeenCalled()
  })

  it('LTV / CAC sends cap, threshold and GRR scope', async () => {
    renderPage()
    const s = section('LTV / CAC')
    const [cap, th] = within(s).getAllByRole('spinbutton')
    fireEvent.change(cap, { target: { value: '60' } })
    fireEvent.change(th, { target: { value: '2.5' } })
    await userEvent.selectOptions(within(s).getByRole('combobox'), 'subscription')
    await clickSave('LTV / CAC')
    expect(lastBody()).toEqual({ section: 'ltv', body: { cap: 60, threshold: 2.5, scope: 'subscription' } })
  })

  it('a blank number is refused instead of saved as 0', async () => {
    renderPage()
    fireEvent.change(within(section('LTV / CAC')).getAllByRole('spinbutton')[0], { target: { value: '' } })
    await clickSave('LTV / CAC')
    expect(save).not.toHaveBeenCalled()
    expect(onError).toHaveBeenCalledWith('Lifetime cap must be a number')
  })

  it('cash sends the account classification with the look-back', async () => {
    renderPage()
    const s = section('Cash & runway')
    await userEvent.selectOptions(within(s).getByRole('combobox'), 'restricted')
    fireEvent.change(within(s).getAllByRole('spinbutton')[0], { target: { value: '6' } })
    await clickSave('Cash & runway')
    expect(lastBody()).toEqual({
      section: 'cash', body: { category_map: { b1: 'restricted' }, sections: ['BankAccounts'], lookback: 6, restricted_adjust: 500000, show_ar_check: true }
    })
  })

  it('FCF sends the capex map and, without per-account working capital, the section map', async () => {
    renderPage()
    await clickSave('FCF conversion')
    expect(lastBody()).toEqual({ section: 'fcf', body: { show_ar_check: true, wc_section_map: { AR: 'ar', AP: 'ap' }, capex_map: { f1: 'capex' } } })
  })

  it('CCC without per-account balances sends the section map', async () => {
    renderPage()
    const s = section('Cash conversion cycle')
    await userEvent.selectOptions(within(s).getAllByRole('combobox')[2], 'inventory')
    await clickSave('Cash conversion cycle')
    expect(lastBody()).toEqual({ section: 'ccc', body: { section_map: { AR: 'ar', AP: 'ap', OtherCurrentAssets: 'inventory' }, include_da: true } })
  })

  it('concentration and diversification send their top N', async () => {
    renderPage()
    fireEvent.change(within(section('Customer concentration')).getByRole('spinbutton'), { target: { value: '5' } })
    await clickSave('Customer concentration')
    expect(lastBody()).toEqual({ section: 'concentration', body: { top_n: 5, group_parent: true } })
    fireEvent.change(within(section('Customer & revenue diversification')).getAllByRole('spinbutton')[1], { target: { value: '40' } })
    await clickSave('Customer & revenue diversification')
    expect(lastBody()).toEqual({ section: 'diversification', body: { top_n: 5, threshold: 40 } })
  })

  it('win rate sends the deal types, loss reasons and an automatic headline as null', async () => {
    renderPage()
    const s = section('Competitor win rate')
    await userEvent.click(within(s).getByRole('checkbox', { name: /Expansion/ }))
    await clickSave('Competitor win rate')
    expect(lastBody()).toEqual({
      section: 'win_rate',
      body: { provider: 'salesforce', competitor_field: 'Primary Competitor', loss_reason_field: null, exclude_loss_reasons: ['No Decision / Status Quo'], new_business_types: ['New Business', 'Expansion'], headline: null, window: 6 }
    })
  })

  it('funnel sends stages, sources and the five maturity windows', async () => {
    renderPage()
    const s = section('Funnel conversion')
    await userEvent.click(within(s).getByRole('checkbox', { name: /OFFLINE/ }))
    fireEvent.change(within(s).getAllByRole('spinbutton')[0], { target: { value: '30' } })
    await clickSave('Funnel conversion')
    expect(lastBody().body).toEqual({
      provider: 'hubspot', lead_stage: 'lead', mql_stage: 'marketingqualifiedlead', sql_stage: 'salesqualifiedlead', opp_stage: 'opportunity',
      sql_via_mql: true, marketing_sources: ['ORGANIC_SEARCH', 'OFFLINE'], dedupe_email: true, mature_days: [30, 90, 180, 60, 180]
    })
  })

  it('MQL plan adds a quarter and refuses a badly written one', async () => {
    renderPage()
    const s = section('Lead volume vs plan (MQLs)')
    await userEvent.click(within(s).getByRole('button', { name: '+ Add quarter' }))
    const inputs = within(s).getAllByRole('textbox')
    fireEvent.change(inputs[2], { target: { value: '2026-q4' } })
    fireEvent.change(inputs[3], { target: { value: '1,200' } })
    await clickSave('Lead volume vs plan (MQLs)')
    expect(lastBody()).toEqual({ section: 'mql', body: { plan_quarters: { '2026-Q3': 556, '2026-Q4': 1200 }, threshold: 0 } })

    fireEvent.change(inputs[2], { target: { value: 'Q4 2026' } })
    save.mockClear()
    await clickSave('Lead volume vs plan (MQLs)')
    expect(save).not.toHaveBeenCalled()
  })

  it('marketing ROI sends spend accounts and channels with their P&L accounts split', async () => {
    renderPage()
    const s = section('Marketing ROI by channel')
    await userEvent.click(within(s).getAllByRole('checkbox', { name: /Sales & Marketing - Advertising/ })[0])
    await userEvent.click(within(s).getByRole('button', { name: '+ Add channel' }))
    const names = within(s).getAllByPlaceholderText('Channel name')
    fireEvent.change(names[1], { target: { value: 'Web' } })
    fireEvent.change(within(s).getAllByPlaceholderText('P&L accounts, e.g. 6130')[1], { target: { value: '6120, 6125' } })
    await clickSave('Marketing ROI by channel')
    expect(lastBody().body).toMatchObject({
      blended_accounts: ['m1'],
      channels: [{ name: 'Events', sources: ['Trade Show'], gl_accounts: ['6130'] }, { name: 'Web', sources: [], gl_accounts: ['6120', '6125'] }]
    })
  })

  it('marketing-sourced sends the duplicate and new-logo options', async () => {
    renderPage()
    const s = section('Marketing-sourced pipeline')
    await userEvent.click(within(s).getByRole('checkbox', { name: /Exclude duplicate-account deals/ }))
    await clickSave('Marketing-sourced pipeline')
    expect(lastBody().body).toMatchObject({ exclude_duplicates: false, true_new_logos: true, value_field: 'arr' })
  })

  it('clicking a tick-box list title does not toggle a box (regression)', async () => {
    renderPage()
    await userEvent.click(within(section('Competitor win rate')).getByText('Deal types counted as New Business'))
    await clickSave('Competitor win rate')
    expect(lastBody().body.new_business_types).toEqual(['New Business'])
  })

  it('reset to automatic resets only that section', async () => {
    renderPage()
    await userEvent.click(within(section('G&A expense accounts')).getByRole('button', { name: 'Reset to automatic' }))
    expect(reset).toHaveBeenCalledWith('ga')
    expect(save).not.toHaveBeenCalled()
  })

  it('a failed save shows the backend message', async () => {
    save.mockRejectedValue({ response: { data: { error: { message: 'Pick at least one unrestricted cash account' } } } })
    renderPage()
    await clickSave('Cash & runway')
    expect(onError).toHaveBeenCalledWith('Pick at least one unrestricted cash account')
  })

  it('members see the settings but cannot change them', () => {
    renderPage(false)
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull()
    expect(screen.getAllByText('Only an owner or admin can change these settings.')).toHaveLength(19)
  })
})
