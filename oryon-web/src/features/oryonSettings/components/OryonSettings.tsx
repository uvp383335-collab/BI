/* eslint-disable @typescript-eslint/no-explicit-any */
import React, { useEffect, useMemo, useState } from 'react'
import { useOryonSettings, useResetOryonSettings, useSaveOryonSettings } from '../hooks/useOryonSettings'
import { OryonSettings as Payload } from '../api/oryonSettingsApi'

/**
 * "Metric settings (Oryon)": every setting the Oryon metrics use, section by
 * section, matching the reference Python app's Settings page. A ★ marks the
 * automatic choice; each section saves on its own and can be reset to the
 * automatic choices. Values are stored where the Python app keeps them, so
 * both apps always compute the same numbers.
 */

type Rows = Array<Record<string, any>>
interface SectionProps {
  data: Record<string, any>
  canManage: boolean
  onError: (message: string) => void
}

const usd = (v: unknown) =>
  typeof v === 'number' ? `${v < -0.5 ? '-' : ''}$${Math.abs(v).toLocaleString('en-US', { maximumFractionDigits: 0 })}` : '-'
const errMsg = (err: any, fallback: string) => err?.response?.data?.error?.message || fallback
const toggle = (list: string[], v: string) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v])

// ------------------------------------------------------------------------------------------- building blocks

const Section: React.FC<{
  section: string
  code?: string
  title: string
  description: React.ReactNode
  saved?: boolean
  canManage: boolean
  onError: (m: string) => void
  body: () => unknown
  noReset?: boolean
  children: React.ReactNode
}> = ({ section, code, title, description, saved, canManage, onError, body, noReset, children }) => {
  const save = useSaveOryonSettings()
  const reset = useResetOryonSettings()
  const [done, setDone] = useState<string | null>(null)

  const run = async (fn: () => Promise<unknown>, msg: string, fail: string) => {
    setDone(null)
    try {
      await fn()
      setDone(msg)
    } catch (err) {
      onError(errMsg(err, fail))
    }
  }

  return (
    <details className="card p-6">
      <summary className="cursor-pointer list-none">
        <div className="flex flex-wrap items-center gap-2">
          {code && <span className="badge bg-surface-3 text-ink-3">{code}</span>}
          <h3 className="text-base font-semibold text-ink">{title}</h3>
          {saved !== undefined && (
            <span className="text-xs text-ink-3">{saved ? 'saved choices' : 'automatic choices (★)'}</span>
          )}
        </div>
        <p className="mt-1 text-sm text-ink-2">{description}</p>
      </summary>
      <div className="mt-4 flex flex-col gap-4">
        {children}
        {canManage ? (
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              className="btn-primary w-auto px-4 py-2 text-sm"
              disabled={save.isPending}
              onClick={() => {
                let payload: unknown
                try {
                  payload = body()
                } catch (e) {
                  onError((e as Error).message)
                  return
                }
                void run(() => save.mutateAsync({ section, body: payload }), 'Saved.', `Could not save ${title}`)
              }}
            >
              {save.isPending ? 'Saving…' : 'Save'}
            </button>
            {!noReset && (
              <button
                type="button"
                className="rounded-md border border-line px-3 py-2 text-sm text-ink-2 hover:bg-surface-3"
                disabled={reset.isPending}
                onClick={() => void run(() => reset.mutateAsync(section), 'Reset to the automatic choices.', `Could not reset ${title}`)}
              >
                Reset to automatic
              </button>
            )}
            {done && <span className="text-xs text-success">{done}</span>}
          </div>
        ) : (
          <p className="text-xs text-ink-3">Only an owner or admin can change these settings.</p>
        )}
      </div>
    </details>
  )
}

const Field: React.FC<{ label: string; hint?: string; children: React.ReactNode }> = ({ label, hint, children }) => (
  <label className="flex flex-col gap-1 text-sm text-ink-2">
    <span className="font-medium text-ink">{label}</span>
    {children}
    {hint && <span className="text-xs text-ink-3">{hint}</span>}
  </label>
)

const NumberInput: React.FC<{ value: number; onChange: (v: number) => void; step?: number; disabled?: boolean }> = ({ value, onChange, step = 1, disabled }) => (
  <input
    type="number"
    className="form-input-dark w-full sm:w-40"
    step={step}
    value={Number.isFinite(value) ? value : ''}
    disabled={disabled}
    onChange={(e) => onChange(e.target.value === '' ? NaN : Number(e.target.value))}
  />
)

const Check: React.FC<{ checked: boolean; onChange: (v: boolean) => void; label: React.ReactNode; disabled?: boolean }> = ({ checked, onChange, label, disabled }) => (
  <label className="flex items-center gap-2 text-sm text-ink-2">
    <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
    {label}
  </label>
)

const Select: React.FC<{ value: string; onChange: (v: string) => void; options: Array<[string, string]>; disabled?: boolean; className?: string }> = ({
  value,
  onChange,
  options,
  disabled,
  className
}) => (
  <select className={className ?? 'form-input-dark w-full sm:max-w-xs'} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
    {options.map(([v, l]) => (
      <option key={v} value={v}>
        {l}
      </option>
    ))}
  </select>
)

/** Multi-pick list of values; ★ marks the values the automatic choice would pick. */
const CheckList: React.FC<{
  options: string[]
  selected: string[]
  onChange: (v: string[]) => void
  auto?: string[]
  labels?: Record<string, string>
  counts?: Record<string, number>
  disabled?: boolean
}> = ({ options, selected, onChange, auto, labels, counts, disabled }) =>
  options.length === 0 ? (
    <p className="text-xs text-ink-3">Nothing found in the synced data yet.</p>
  ) : (
    <div className="flex max-h-56 flex-col gap-1.5 overflow-y-auto rounded-md border border-line p-3">
      {options.map((o) => (
        <label key={o} className="flex items-center gap-2 text-sm text-ink-2">
          <input type="checkbox" checked={selected.includes(o)} disabled={disabled} onChange={() => onChange(toggle(selected, o))} />
          {labels?.[o] ?? o}
          {counts?.[o] !== undefined && <span className="text-xs text-ink-3">({counts[o]})</span>}
          {auto?.includes(o) && <span className="text-xs text-brand">★</span>}
        </label>
      ))}
    </div>
  )

/** Account table: name, amounts, the automatic choice with its reason, and the editable value cell. */
const AccountTable: React.FC<{
  rows: Rows
  amount?: 'ttm' | 'latest'
  autoLabel: (r: Record<string, any>) => string
  isAuto: (r: Record<string, any>) => boolean
  cell: (r: Record<string, any>) => React.ReactNode
  extra?: { head: string; cell: (r: Record<string, any>) => React.ReactNode }
}> = ({ rows, amount = 'ttm', autoLabel, isAuto, cell, extra }) =>
  rows.length === 0 ? (
    <p className="text-xs text-ink-3">No accounts found in the synced QuickBooks data yet.</p>
  ) : (
    <div className="max-h-96 overflow-auto rounded-md border border-line">
      <table className="w-full text-sm">
        <thead className="sticky top-0 bg-surface-2 text-left text-xs text-ink-3">
          <tr>
            <th className="px-3 py-2">Account</th>
            <th className="px-3 py-2">Section</th>
            <th className="px-3 py-2 text-right">{amount === 'ttm' ? 'Last 12 months' : 'Latest balance'}</th>
            <th className="px-3 py-2">Choice</th>
            {extra && <th className="px-3 py-2">{extra.head}</th>}
            <th className="px-3 py-2">Automatic</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-t border-line">
              <td className="px-3 py-2 text-ink">{r.name}</td>
              <td className="px-3 py-2 text-ink-3">{r.section ?? '-'}</td>
              <td className="px-3 py-2 text-right tabular-nums">{usd(amount === 'ttm' ? r.ttm : r.latest)}</td>
              <td className="px-3 py-2">{cell(r)}</td>
              {extra && <td className="px-3 py-2">{extra.cell(r)}</td>}
              <td className="px-3 py-2 text-xs text-ink-3">
                {isAuto(r) && <span className="text-brand">★ </span>}
                {autoLabel(r)} — {r.reason}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )

/** state initialised from the server value, re-initialised whenever the server value changes */
function useInit<T>(make: () => T, deps: unknown[]): [T, React.Dispatch<React.SetStateAction<T>>] {
  const [v, setV] = useState<T>(make)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => setV(make()), deps)
  return [v, setV]
}

const num = (v: number, label: string) => {
  if (!Number.isFinite(v)) throw new Error(`${label} must be a number`)
  return v
}

// ------------------------------------------------------------------------------------------- sections

const MappingSection: React.FC<SectionProps> = ({ data, canManage, onError }) => {
  const products: Rows = data.products
  const [map, setMap] = useInit<Record<string, string>>(() => Object.fromEntries(products.map((p) => [p.itemId, p.mapping])), [data])
  const types = Object.entries(data.types as Record<string, string>)
  const unsaved = products.filter((p) => !p.saved).length
  return (
    <Section
      section="mapping"
      title="Product mapping (MRR)"
      description="How each QuickBooks product counts in MRR: monthly / quarterly (÷3) / annual (÷12) subscription, retainer, or not MRR."
      saved={unsaved === 0}
      canManage={canManage}
      onError={onError}
      body={() => ({ mapping: map })}
    >
      {unsaved > 0 && <p className="text-xs text-ink-3">{unsaved} product(s) use the automatic choice — review and Save to keep them.</p>}
      <div className="max-h-96 overflow-auto rounded-md border border-line">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-surface-2 text-left text-xs text-ink-3">
            <tr>
              <th className="px-3 py-2">Product</th>
              <th className="px-3 py-2">Class</th>
              <th className="px-3 py-2 text-right">Lines</th>
              <th className="px-3 py-2 text-right">Invoiced</th>
              <th className="px-3 py-2">Months used</th>
              <th className="px-3 py-2">Counts in MRR as</th>
              <th className="px-3 py-2">Automatic</th>
            </tr>
          </thead>
          <tbody>
            {products.map((p) => (
              <tr key={p.itemId} className="border-t border-line">
                <td className="px-3 py-2 text-ink">{p.name}</td>
                <td className="px-3 py-2 text-ink-3">{p.classes}</td>
                <td className="px-3 py-2 text-right tabular-nums">{p.lines}</td>
                <td className="px-3 py-2 text-right tabular-nums">{usd(p.amount)}</td>
                <td className="px-3 py-2 text-xs text-ink-3">{p.first ? `${p.first} → ${p.last}` : '-'}</td>
                <td className="px-3 py-2">
                  <Select className="form-input-dark w-full" value={map[p.itemId]} disabled={!canManage} onChange={(v) => setMap({ ...map, [p.itemId]: v })} options={types} />
                </td>
                <td className="px-3 py-2 text-xs text-ink-3">
                  {map[p.itemId] === p.auto && <span className="text-brand">★ </span>}
                  {(data.types as Record<string, string>)[p.auto]} — {p.reason}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Section>
  )
}

const GeneralSection: React.FC<SectionProps> = ({ data, canManage, onError }) => {
  const [v, setV] = useInit(
    () => ({
      start_month: data.start_month as string,
      early: Number(data.early_invoice_day),
      countries: (data.cad_countries as string[]).join(', '),
      fx: Object.entries(data.fx_cad_usd as Record<string, number>).sort().map(([m, r]) => `${m}, ${r}`).join('\n'),
      lag: Number(data.newlogo_lag_months),
      groupParent: !!data.newlogo_group_parent
    }),
    [data]
  )
  const body = () => {
    const fx: Record<string, number> = {}
    for (const raw of v.fx.split('\n').map((l) => l.trim()).filter(Boolean)) {
      const [m, r] = raw.replace(/\t/g, ',').split(',').map((x) => x.trim())
      if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(m) || !Number.isFinite(Number(r)) || !r) throw new Error(`CAD→USD rate line "${raw}" must be "YYYY-MM, rate"`)
      fx[m] = Number(r)
    }
    return {
      start_month: v.start_month, early_invoice_day: num(v.early, 'Early-invoice day'),
      cad_countries: v.countries.split(',').map((c) => c.trim()).filter(Boolean), fx_cad_usd: fx,
      newlogo_lag_months: num(v.lag, 'New-logo billing lag'), newlogo_group_parent: v.groupParent
    }
  }
  return (
    <Section section="general" title="General" description="First month shown, early-invoice day, Canadian billing and CAD→USD rates, new-logo billing lag." canManage={canManage} onError={onError} body={body}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="First month shown">
          <input type="month" className="form-input-dark w-full sm:w-48" value={v.start_month} disabled={!canManage} onChange={(e) => setV({ ...v, start_month: e.target.value })} />
        </Field>
        <Field label="Early-invoice day" hint="Quarterly / annual invoices dated on or after this day start the next month (renewals are invoiced up to 15 days early).">
          <NumberInput value={v.early} disabled={!canManage} onChange={(x) => setV({ ...v, early: x })} />
        </Field>
        <Field label="Canadian billing countries" hint="Comma-separated; invoices billed to these countries are converted CAD → USD.">
          <input className="form-input-dark w-full" value={v.countries} disabled={!canManage} onChange={(e) => setV({ ...v, countries: e.target.value })} />
        </Field>
        <Field label="New-logo billing lag (months)" hint="Salesforce close month = first billing month − this (0-6).">
          <NumberInput value={v.lag} disabled={!canManage} onChange={(x) => setV({ ...v, lag: x })} />
        </Field>
      </div>
      <Check checked={v.groupParent} disabled={!canManage} onChange={(x) => setV({ ...v, groupParent: x })} label="Count a new subsidiary of a paying parent as expansion (not a new logo)" />
      <Field label="CAD → USD rate per month" hint='One line per month: "YYYY-MM, rate" (USD per 1 CAD). Months without a rate use the latest earlier one.'>
        <textarea className="form-input-dark h-40 w-full font-mono text-xs" value={v.fx} disabled={!canManage} onChange={(e) => setV({ ...v, fx: e.target.value })} />
      </Field>
    </Section>
  )
}

/** CAC / G&A / recurring %: tick the accounts that count. */
const AccountPickSection: React.FC<SectionProps & { section: string; code: string; title: string; description: string }> = ({ data, canManage, onError, section, code, title, description }) => {
  const rows: Rows = data.accounts
  const [sel, setSel] = useInit<string[]>(() => rows.filter((r) => r.selected).map((r) => r.id), [data])
  return (
    <Section section={section} code={code} title={title} description={description} saved={data.saved} canManage={canManage} onError={onError} body={() => ({ account_ids: sel })}>
      <AccountTable
        rows={rows}
        isAuto={(r) => sel.includes(r.id) === !!r.auto}
        autoLabel={(r) => (r.auto ? 'included' : 'left out')}
        cell={(r) => <input type="checkbox" checked={sel.includes(r.id)} disabled={!canManage} onChange={() => setSel(toggle(sel, r.id))} />}
        extra={section === 'recurring' ? { head: 'In revenue', cell: (r) => (r.in_revenue ? 'yes' : 'excluded') } : undefined}
      />
    </Section>
  )
}

/** COGS % / EBITDA / cash / capex / working capital / CCC: one category per account (+ optional D&A tick). */
const CategorySection: React.FC<
  SectionProps & {
    section: string
    code: string
    title: string
    description: React.ReactNode
    rows: Rows
    field: string
    choices: Record<string, string>
    da?: boolean
    amount?: 'ttm' | 'latest'
    body: (cats: Record<string, string>, da: string[]) => unknown
    saved?: boolean
    children?: React.ReactNode
  }
> = ({ canManage, onError, section, code, title, description, rows, field, choices, da, amount, body, saved, children }) => {
  const [cats, setCats] = useInit<Record<string, string>>(() => Object.fromEntries(rows.map((r) => [r.id, r[field]])), [rows])
  const [daIds, setDa] = useInit<string[]>(() => rows.filter((r) => r.da).map((r) => r.id), [rows])
  const options = Object.entries(choices)
  return (
    <Section section={section} code={code} title={title} description={description} saved={saved} canManage={canManage} onError={onError} body={() => body(cats, daIds)}>
      <AccountTable
        rows={rows}
        amount={amount}
        isAuto={(r) => cats[r.id] === r.auto && (!da || daIds.includes(r.id) === !!r.auto_da)}
        autoLabel={(r) => `${choices[r.auto] ?? r.auto}${da && r.auto_da ? ' + D&A' : ''}`}
        cell={(r) => (
          <Select className="form-input-dark w-full min-w-[160px]" value={cats[r.id]} disabled={!canManage} onChange={(v) => setCats({ ...cats, [r.id]: v })} options={options} />
        )}
        extra={da ? { head: 'D&A', cell: (r) => <input type="checkbox" checked={daIds.includes(r.id)} disabled={!canManage} onChange={() => setDa(toggle(daIds, r.id))} /> } : undefined}
      />
      {children}
    </Section>
  )
}

const EbitdaPlanSection: React.FC<SectionProps> = ({ data, canManage, onError }) => {
  const [text, setText] = useInit(
    () => Object.entries(data.plan as Record<string, [number, number]>).sort().map(([m, [e, r]]) => `${m}, ${e}, ${r}`).join('\n'),
    [data]
  )
  const body = () => {
    const plan: Record<string, [number, number]> = {}
    for (const raw of text.split('\n').map((l) => l.trim()).filter((l) => l && !l.toLowerCase().startsWith('month'))) {
      const parts = raw.replace(/\t/g, ',').split(',').map((x) => x.trim().replace(/[$_]/g, ''))
      const [m, e, r] = [parts[0], Number(parts[1]), Number(parts[2])]
      if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(m) || !Number.isFinite(e) || !Number.isFinite(r) || parts.length < 3) {
        throw new Error(`Plan line "${raw}" must be "YYYY-MM, plan EBITDA, plan revenue"`)
      }
      plan[m] = [e, r]
    }
    return { plan }
  }
  return (
    <Section section="ebitda_plan" code="VC-10 / VC-13" title="EBITDA & revenue plan" description="Optional budget used for EBITDA vs plan and revenue vs plan." canManage={canManage} onError={onError} body={body}>
      <Field label="Plan" hint='One line per month: "YYYY-MM, plan EBITDA, plan revenue".'>
        <textarea className="form-input-dark h-40 w-full font-mono text-xs" value={text} disabled={!canManage} onChange={(e) => setText(e.target.value)} />
      </Field>
    </Section>
  )
}

const LtvSection: React.FC<SectionProps> = ({ data, canManage, onError }) => {
  const [v, setV] = useInit(() => ({ cap: Number(data.cap), threshold: Number(data.threshold), scope: data.scope as string }), [data])
  return (
    <Section
      section="ltv"
      code="VC-07 / VC-14"
      title="LTV / CAC"
      description="Expected-lifetime cap, warning threshold and which GRR is used for churn. CAC inputs come from the CAC accounts."
      canManage={canManage}
      onError={onError}
      body={() => ({ cap: num(v.cap, 'Lifetime cap'), threshold: num(v.threshold, 'Threshold'), scope: v.scope })}
    >
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Lifetime cap (months)" hint="1-600; spec 84.">
          <NumberInput value={v.cap} disabled={!canManage} onChange={(x) => setV({ ...v, cap: x })} />
        </Field>
        <Field label="Warning below (x)" hint="Spec 3.0x.">
          <NumberInput step={0.1} value={v.threshold} disabled={!canManage} onChange={(x) => setV({ ...v, threshold: x })} />
        </Field>
        <Field label="GRR used for churn">
          <Select value={v.scope} disabled={!canManage} onChange={(x) => setV({ ...v, scope: x })} options={[['all', 'All recurring'], ['subscription', 'Subscription only']]} />
        </Field>
      </div>
    </Section>
  )
}

const CashSection: React.FC<SectionProps> = ({ data, canManage, onError }) => {
  const [v, setV] = useInit(
    () => ({ sections: data.sections as string[], lookback: Number(data.lookback), adjust: Number(data.restricted_adjust), showAr: !!data.show_ar_check }),
    [data]
  )
  return (
    <CategorySection
      data={data}
      canManage={canManage}
      onError={onError}
      section="cash"
      code="CB-05"
      title="Cash & runway"
      description="Which bank accounts are unrestricted cash (counted in cash and runway), restricted, or not cash."
      rows={data.accounts}
      field="cat"
      choices={data.categories}
      amount="latest"
      saved={data.saved}
      body={(cats) => ({
        ...(data.has_accounts ? { category_map: cats } : {}),
        sections: v.sections, lookback: num(v.lookback, 'Runway look-back'), restricted_adjust: num(v.adjust, 'Restricted cash'), show_ar_check: v.showAr
      })}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Runway look-back (months)" hint="Runway = cash ÷ average monthly decline over this many months (1-12).">
          <NumberInput value={v.lookback} disabled={!canManage} onChange={(x) => setV({ ...v, lookback: x })} />
        </Field>
        <Field label="Restricted cash to subtract (fallback)" hint="Only used when the snapshots have no per-account balances.">
          <NumberInput value={v.adjust} disabled={!canManage} onChange={(x) => setV({ ...v, adjust: x })} />
        </Field>
      </div>
      {!data.has_accounts && (
        <Field label="Balance Sheet sections that make up cash (fallback)">
          <CheckList options={(data.sections_available as Rows).map((s) => s.key)} selected={v.sections} disabled={!canManage} onChange={(x) => setV({ ...v, sections: x })} />
        </Field>
      )}
      <Check checked={v.showAr} disabled={!canManage} onChange={(x) => setV({ ...v, showAr: x })} label='Show the "cash + negative A/R" data-quality line' />
    </CategorySection>
  )
}

const FcfSection: React.FC<SectionProps> = ({ data, canManage, onError }) => {
  const capexRows: Rows = data.capex_accounts
  const wcRows: Rows = data.wc_accounts
  const [capex, setCapex] = useInit<Record<string, string>>(() => Object.fromEntries(capexRows.map((r) => [r.id, r.cat])), [data])
  const [wc, setWc] = useInit<Record<string, string>>(() => Object.fromEntries(wcRows.map((r) => [r.id, r.cat])), [data])
  const [wcSec, setWcSec] = useInit<Record<string, string>>(() => ({ ...data.wc_section_map }), [data])
  const [capexSecs, setCapexSecs] = useInit<string[]>(() => data.capex_sections, [data])
  const [faDa, setFaDa] = useInit<string[]>(() => (data.fa_da_accounts as Rows).filter((r) => r.fa).map((r) => r.id), [data])
  const [showAr, setShowAr] = useInit(() => !!data.show_ar_check, [data])
  const capexOpts = Object.entries(data.capex_categories as Record<string, string>)
  const wcOpts = Object.entries(data.wc_categories as Record<string, string>)
  const body = () => ({
    show_ar_check: showAr,
    ...(data.has_wc_accounts ? { wc_map: wc } : { wc_section_map: wcSec }),
    ...(data.has_accounts ? { capex_map: capex } : { capex_sections: capexSecs, fa_da_ids: faDa })
  })
  return (
    <Section section="fcf" code="CB-07" title="FCF conversion" description="Capex accounts and working-capital accounts for (OCF − capex) ÷ EBITDA." saved={data.capex_saved || data.wc_saved} canManage={canManage} onError={onError} body={body}>
      <p className="text-sm font-medium text-ink">Capex account classification</p>
      {data.has_accounts ? (
        <AccountTable
          rows={capexRows}
          amount="latest"
          isAuto={(r) => capex[r.id] === r.auto}
          autoLabel={(r) => data.capex_categories[r.auto]}
          cell={(r) => <Select className="form-input-dark w-full min-w-[160px]" value={capex[r.id]} disabled={!canManage} onChange={(x) => setCapex({ ...capex, [r.id]: x })} options={capexOpts} />}
        />
      ) : (
        <>
          <Field label="Capex = change in these Balance Sheet sections + D&A on them (fallback)">
            <CheckList options={data.sections_available} selected={capexSecs} disabled={!canManage} onChange={setCapexSecs} />
          </Field>
          <Field label="P&L D&A charged on those assets">
            <CheckList
              options={(data.fa_da_accounts as Rows).map((r) => r.id)}
              labels={Object.fromEntries((data.fa_da_accounts as Rows).map((r) => [r.id, r.name]))}
              auto={(data.fa_da_accounts as Rows).filter((r) => r.auto_fa).map((r) => r.id)}
              selected={faDa}
              disabled={!canManage}
              onChange={setFaDa}
            />
          </Field>
        </>
      )}
      <p className="text-sm font-medium text-ink">Working capital account classification</p>
      {data.has_wc_accounts ? (
        <AccountTable
          rows={wcRows}
          amount="latest"
          isAuto={(r) => wc[r.id] === r.auto}
          autoLabel={(r) => data.wc_categories[r.auto]}
          cell={(r) => <Select className="form-input-dark w-full min-w-[160px]" value={wc[r.id]} disabled={!canManage} onChange={(x) => setWc({ ...wc, [r.id]: x })} options={wcOpts} />}
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {(data.wc_sections as string[]).map((s) => (
            <Field key={s} label={s}>
              <Select value={wcSec[s] ?? 'exclude'} disabled={!canManage} onChange={(x) => setWcSec({ ...wcSec, [s]: x })} options={wcOpts} />
            </Field>
          ))}
        </div>
      )}
      <Check checked={showAr} disabled={!canManage} onChange={setShowAr} label="Show FCF % without the A/R swing (data-quality line)" />
    </Section>
  )
}

const CccSection: React.FC<SectionProps> = ({ data, canManage, onError }) => {
  const [secMap, setSecMap] = useInit<Record<string, string>>(() => ({ ...data.section_map }), [data])
  const [includeDa, setIncludeDa] = useInit(() => !!data.include_da, [data])
  const opts = Object.entries(data.categories as Record<string, string>)
  return (
    <CategorySection
      data={data}
      canManage={canManage}
      onError={onError}
      section="ccc"
      code="CB-10"
      title="Cash conversion cycle"
      description="Which accounts are AR, inventory and AP for DSO + DIO − DPO."
      rows={data.accounts}
      field="cat"
      choices={data.categories}
      amount="latest"
      saved={data.saved}
      body={(cats) => ({ ...(data.has_accounts ? { account_map: cats } : { section_map: secMap }), include_da: includeDa })}
    >
      {!data.has_accounts && (
        <div className="grid gap-3 sm:grid-cols-2">
          {(data.sections as string[]).map((s) => (
            <Field key={s} label={s}>
              <Select value={secMap[s] ?? 'exclude'} disabled={!canManage} onChange={(x) => setSecMap({ ...secMap, [s]: x })} options={opts} />
            </Field>
          ))}
        </div>
      )}
      <Check checked={includeDa} disabled={!canManage} onChange={setIncludeDa} label="Include D&A (capitalized-software amortization) in cost of sales" />
    </CategorySection>
  )
}

const TopNSection: React.FC<SectionProps & { section: 'concentration' | 'diversification' }> = ({ data, canManage, onError, section }) => {
  const [v, setV] = useInit(() => ({ topN: Number(data.top_n), group: !!data.group_parent, threshold: Number(data.threshold ?? 0) }), [data])
  const conc = section === 'concentration'
  return (
    <Section
      section={section}
      code={conc ? 'CM-02' : 'ER-05'}
      title={conc ? 'Customer concentration' : 'Customer & revenue diversification'}
      description={conc ? 'Top-N customer groups and whether customers are grouped under their parent.' : 'Top-N customer groups (grouping, mapping and FX come from the concentration and general settings).'}
      canManage={canManage}
      onError={onError}
      body={() => (conc ? { top_n: num(v.topN, 'Top N'), group_parent: v.group } : { top_n: num(v.topN, 'Top N'), threshold: num(v.threshold, 'Threshold') })}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Top N customer groups" hint={conc ? 'Spec 10.' : 'Spec 5.'}>
          <NumberInput value={v.topN} disabled={!canManage} onChange={(x) => setV({ ...v, topN: x })} />
        </Field>
        {!conc && (
          <Field label="Flag a top-N share above (%)" hint="0 = off.">
            <NumberInput step={0.1} value={v.threshold} disabled={!canManage} onChange={(x) => setV({ ...v, threshold: x })} />
          </Field>
        )}
      </div>
      {conc && (
        <Check checked={v.group} disabled={!canManage} onChange={(x) => setV({ ...v, group: x })} label="Group customers under their parent (Salesforce parent, else QuickBooks parent)" />
      )}
    </Section>
  )
}

const providerOpts = (list: string[], cur: string): Array<[string, string]> =>
  Array.from(new Set([cur, ...list])).map((p) => [p, p === 'hubspot' ? 'HubSpot' : p === 'salesforce' ? 'Salesforce' : p])

const WinRateSection: React.FC<SectionProps> = ({ data, canManage, onError }) => {
  const [v, setV] = useInit(
    () => ({
      provider: data.provider as string,
      comp: (data.competitor_field ?? '') as string,
      loss: (data.loss_reason_field ?? '') as string,
      excl: (data.exclude_loss_reasons as string[]).join('\n'),
      types: data.new_business_types as string[],
      headline: (data.headline ?? '') as string,
      window: Number(data.window)
    }),
    [data]
  )
  const fieldOpts: Array<[string, string]> = [
    ...Object.entries(data.standard_fields as Record<string, string>),
    ...(data.labels as string[]).map((l): [string, string] => [l, `Custom field: ${l}`])
  ]
  return (
    <Section
      section="win_rate"
      code="CM-03"
      title="Competitor win rate"
      description="Which field names the competitor, which losses aren't a decision, which deals are New Business, and the window."
      canManage={canManage}
      onError={onError}
      body={() => ({
        provider: v.provider, competitor_field: v.comp || null, loss_reason_field: v.loss || null,
        exclude_loss_reasons: v.excl.split('\n').map((x) => x.trim()).filter(Boolean), new_business_types: v.types,
        headline: v.headline || null, window: num(v.window, 'Window')
      })}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="CRM">
          <Select value={v.provider} disabled={!canManage} onChange={(x) => setV({ ...v, provider: x })} options={providerOpts(data.providers, data.provider)} />
        </Field>
        <Field label="Window (months)" hint="Spec 6 (trailing). 1-24.">
          <NumberInput value={v.window} disabled={!canManage} onChange={(x) => setV({ ...v, window: x })} />
        </Field>
        <Field label="Competitor field" hint={`Automatic: ${data.competitor_auto ?? 'none found'}`}>
          <Select value={v.comp} disabled={!canManage} onChange={(x) => setV({ ...v, comp: x })} options={[['', 'Automatic'], ...fieldOpts]} />
        </Field>
        <Field label="Loss-reason field" hint={`Automatic: ${data.loss_reason_auto ?? 'none found'}`}>
          <Select value={v.loss} disabled={!canManage} onChange={(x) => setV({ ...v, loss: x })} options={[['', 'None'], ...(data.labels as string[]).map((l): [string, string] => [l, l])]} />
        </Field>
        <Field label="Headline competitor" hint={`Shown now: ${data.headline_shown ?? '-'}`}>
          <Select
            value={v.headline}
            disabled={!canManage}
            onChange={(x) => setV({ ...v, headline: x })}
            options={[['', 'Automatic (Verdance FSM, else most deals)'], ...(data.competitors as string[]).map((c): [string, string] => [c, c])]}
          />
        </Field>
        <Field label="Loss reasons that aren't a decision" hint="One per line; these losses are dropped from decided deals.">
          <textarea className="form-input-dark h-20 w-full text-sm" value={v.excl} disabled={!canManage} onChange={(e) => setV({ ...v, excl: e.target.value })} />
        </Field>
      </div>
      <Field label="Deal types counted as New Business">
        <CheckList options={data.types} auto={data.new_business_auto} selected={v.types} disabled={!canManage} onChange={(x) => setV({ ...v, types: x })} />
      </Field>
    </Section>
  )
}

const MATURE_LABELS = ['MQL → SQL', 'Lead → MQL', 'SQL → won', 'SQL → opportunity', 'Opportunity → won']

const FunnelSection: React.FC<SectionProps> = ({ data, canManage, onError }) => {
  const [v, setV] = useInit(
    () => ({
      provider: data.provider as string,
      lead: data.lead_stage as string,
      mql: data.mql_stage as string,
      sql: data.sql_stage as string,
      opp: data.opp_stage as string,
      viaMql: !!data.sql_via_mql,
      sources: data.marketing_sources as string[],
      dedupe: !!data.dedupe_email,
      mature: (data.mature_days as number[]).slice()
    }),
    [data]
  )
  const stageOpts = (cur: string): Array<[string, string]> => Array.from(new Set([cur, ...(data.stages as string[])])).map((s) => [s, s])
  return (
    <Section
      section="funnel"
      code="CM-06"
      title="Funnel conversion"
      description="Lifecycle stages used as created / MQL / SQL / opportunity, marketing sources and the immature windows."
      canManage={canManage}
      onError={onError}
      body={() => ({
        provider: v.provider, lead_stage: v.lead, mql_stage: v.mql, sql_stage: v.sql, opp_stage: v.opp, sql_via_mql: v.viaMql,
        marketing_sources: v.sources, dedupe_email: v.dedupe, mature_days: v.mature.map((x, i) => num(x, `${MATURE_LABELS[i]} days`))
      })}
    >
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="CRM">
          <Select value={v.provider} disabled={!canManage} onChange={(x) => setV({ ...v, provider: x })} options={providerOpts(data.providers, data.provider)} />
        </Field>
        <Field label="Created stage">
          <Select value={v.lead} disabled={!canManage} onChange={(x) => setV({ ...v, lead: x })} options={stageOpts(v.lead)} />
        </Field>
        <Field label="MQL stage">
          <Select value={v.mql} disabled={!canManage} onChange={(x) => setV({ ...v, mql: x })} options={stageOpts(v.mql)} />
        </Field>
        <Field label="SQL stage">
          <Select value={v.sql} disabled={!canManage} onChange={(x) => setV({ ...v, sql: x })} options={stageOpts(v.sql)} />
        </Field>
        <Field label="Opportunity stage">
          <Select value={v.opp} disabled={!canManage} onChange={(x) => setV({ ...v, opp: x })} options={stageOpts(v.opp)} />
        </Field>
      </div>
      <Check checked={v.viaMql} disabled={!canManage} onChange={(x) => setV({ ...v, viaMql: x })} label="SQL cohort = contacts with an SQL date that also have an MQL date (reproduces the Oryon report)" />
      <Check checked={v.dedupe} disabled={!canManage} onChange={(x) => setV({ ...v, dedupe: x })} label="Lead → MQL counts one contact per email address" />
      <Field label="Original sources counted as marketing-sourced (Lead → MQL)">
        <CheckList options={data.sources} counts={data.source_counts} auto={data.marketing_auto} selected={v.sources} disabled={!canManage} onChange={(x) => setV({ ...v, sources: x })} />
      </Field>
      <div className="grid gap-3 sm:grid-cols-5">
        {MATURE_LABELS.map((l, i) => (
          <Field key={l} label={`${l} (days)`}>
            <NumberInput
              value={v.mature[i]}
              disabled={!canManage}
              onChange={(x) => {
                const m = v.mature.slice()
                m[i] = x
                setV({ ...v, mature: m })
              }}
            />
          </Field>
        ))}
      </div>
    </Section>
  )
}

const MqlSection: React.FC<SectionProps> = ({ data, canManage, onError }) => {
  const [rows, setRows] = useInit<Array<[string, string]>>(
    () => Object.entries(data.plan_quarters as Record<string, number>).sort().map(([q, t]) => [q, String(t)]),
    [data]
  )
  const [threshold, setThreshold] = useInit(() => Number(data.threshold), [data])
  const body = () => {
    const plan: Record<string, number> = {}
    for (const [q, t] of rows) {
      const qq = q.trim().toUpperCase()
      if (!qq && !t.trim()) continue
      if (!/^\d{4}-Q[1-4]$/.test(qq)) throw new Error(`Quarter "${q}" must be YYYY-Q1..Q4`)
      if (!t.trim()) continue
      const n = Number(t.replace(/,/g, ''))
      if (!Number.isFinite(n)) throw new Error(`Target for ${qq} must be a number`)
      plan[qq] = n
    }
    return { plan_quarters: plan, threshold: num(threshold, 'Alert threshold') }
  }
  return (
    <Section
      section="mql"
      code="CM-08"
      title="Lead volume vs plan (MQLs)"
      description={`Budgeted MQL target per quarter (a month carries a third). MQL stage "${data.stage}" comes from the funnel settings.`}
      canManage={canManage}
      onError={onError}
      body={body}
    >
      <div className="grid max-h-80 gap-2 overflow-y-auto sm:grid-cols-4">
        {rows.map(([q, t], i) => (
          <div key={i} className="flex items-center gap-2">
            <input
              className="form-input-dark w-28"
              value={q}
              disabled={!canManage}
              onChange={(e) => setRows(rows.map((r, j) => (j === i ? [e.target.value, r[1]] : r)))}
            />
            <input
              className="form-input-dark w-24"
              value={t}
              disabled={!canManage}
              onChange={(e) => setRows(rows.map((r, j) => (j === i ? [r[0], e.target.value] : r)))}
            />
          </div>
        ))}
      </div>
      {canManage && (
        <button type="button" className="w-fit text-sm text-brand hover:underline" onClick={() => setRows([...rows, ['', '']])}>
          + Add quarter
        </button>
      )}
      <Field label="Alert below (% vs plan)" hint="0 = alert whenever MQLs are below plan.">
        <NumberInput step={0.1} value={threshold} disabled={!canManage} onChange={setThreshold} />
      </Field>
    </Section>
  )
}

const RoiSection: React.FC<SectionProps> = ({ data, canManage, onError }) => {
  const [v, setV] = useInit(
    () => ({
      provider: data.provider as string,
      valueField: data.value_field as string,
      sources: data.marketing_sources as string[],
      types: data.new_business_types as string[],
      blended: data.blended_accounts as string[],
      programs: data.programs_accounts as string[],
      channels: (data.channels as Rows).map((c) => ({ name: c.name as string, sources: c.sources as string[], gl: (c.gl_accounts as string[]).join(', ') })),
      threshold: Number(data.threshold)
    }),
    [data]
  )
  const accIds = (data.accounts as Rows).map((a) => a.id)
  const accNames = Object.fromEntries((data.accounts as Rows).map((a) => [a.id, a.name]))
  const setChannel = (i: number, patch: Partial<{ name: string; sources: string[]; gl: string }>) =>
    setV({ ...v, channels: v.channels.map((c, j) => (j === i ? { ...c, ...patch } : c)) })
  return (
    <Section
      section="roi"
      code="CM-07"
      title="Marketing ROI by channel"
      description="Pipeline value, marketing lead sources, new-business types, marketing spend accounts and channels."
      canManage={canManage}
      onError={onError}
      body={() => ({
        provider: v.provider, value_field: v.valueField, marketing_sources: v.sources, new_business_types: v.types,
        blended_accounts: v.blended, programs_accounts: v.programs,
        channels: v.channels.map((c) => ({ name: c.name, sources: c.sources, gl_accounts: c.gl.split(',').map((x) => x.trim()).filter(Boolean) })),
        threshold: num(v.threshold, 'ROI threshold')
      })}
    >
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="CRM">
          <Select value={v.provider} disabled={!canManage} onChange={(x) => setV({ ...v, provider: x })} options={providerOpts(data.providers, data.provider)} />
        </Field>
        <Field label="Pipeline value">
          <Select value={v.valueField} disabled={!canManage} onChange={(x) => setV({ ...v, valueField: x })} options={[['arr', 'Deal ARR (Oryon basis)'], ['amount', 'Amount (total contract value)']]} />
        </Field>
        <Field label="Flag ROI below (x)">
          <NumberInput step={0.1} value={v.threshold} disabled={!canManage} onChange={(x) => setV({ ...v, threshold: x })} />
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Marketing lead sources">
          <CheckList options={data.sources} auto={data.marketing_auto} selected={v.sources} disabled={!canManage} onChange={(x) => setV({ ...v, sources: x })} />
        </Field>
        <Field label="New-business deal types">
          <CheckList options={data.types} auto={data.new_business_auto} selected={v.types} disabled={!canManage} onChange={(x) => setV({ ...v, types: x })} />
        </Field>
        <Field label="Blended spend: all marketing P&L accounts">
          <CheckList options={accIds} labels={accNames} auto={data.blended_auto} selected={v.blended} disabled={!canManage} onChange={(x) => setV({ ...v, blended: x })} />
        </Field>
        <Field label="Programs spend: non-people marketing accounts">
          <CheckList options={accIds} labels={accNames} auto={data.programs_auto} selected={v.programs} disabled={!canManage} onChange={(x) => setV({ ...v, programs: x })} />
        </Field>
      </div>
      <p className="text-sm font-medium text-ink">Channels</p>
      <p className="text-xs text-ink-3">A channel = its lead sources ÷ the P&L accounts that hold its spend (account id, full name or number, e.g. 6130).</p>
      {v.channels.map((c, i) => (
        <div key={i} className="flex flex-col gap-2 rounded-md border border-line p-3">
          <div className="flex flex-wrap items-center gap-2">
            <input className="form-input-dark w-48" placeholder="Channel name" value={c.name} disabled={!canManage} onChange={(e) => setChannel(i, { name: e.target.value })} />
            <input className="form-input-dark w-64" placeholder="P&L accounts, e.g. 6130" value={c.gl} disabled={!canManage} onChange={(e) => setChannel(i, { gl: e.target.value })} />
            {canManage && (
              <button type="button" className="text-sm text-danger hover:underline" onClick={() => setV({ ...v, channels: v.channels.filter((_, j) => j !== i) })}>
                Remove
              </button>
            )}
          </div>
          <CheckList options={data.sources} selected={c.sources} disabled={!canManage} onChange={(x) => setChannel(i, { sources: x })} />
        </div>
      ))}
      {canManage && (
        <button type="button" className="w-fit text-sm text-brand hover:underline" onClick={() => setV({ ...v, channels: [...v.channels, { name: '', sources: [], gl: '' }] })}>
          + Add channel
        </button>
      )}
    </Section>
  )
}

const MspSection: React.FC<SectionProps> = ({ data, canManage, onError }) => {
  const [v, setV] = useInit(
    () => ({
      provider: data.provider as string,
      valueField: data.value_field as string,
      sources: data.marketing_sources as string[],
      types: data.new_business_types as string[],
      dups: !!data.exclude_duplicates,
      trueNew: !!data.true_new_logos,
      threshold: Number(data.threshold)
    }),
    [data]
  )
  return (
    <Section
      section="msp"
      code="CM-05"
      title="Marketing-sourced pipeline"
      description="Deal value, which lead sources are marketing, new-business types, duplicate accounts and true new logos."
      canManage={canManage}
      onError={onError}
      body={() => ({
        provider: v.provider, value_field: v.valueField, marketing_sources: v.sources, new_business_types: v.types,
        exclude_duplicates: v.dups, true_new_logos: v.trueNew, threshold: num(v.threshold, 'Threshold')
      })}
    >
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="CRM">
          <Select value={v.provider} disabled={!canManage} onChange={(x) => setV({ ...v, provider: x })} options={providerOpts(data.providers, data.provider)} />
        </Field>
        <Field label="Deal value">
          <Select value={v.valueField} disabled={!canManage} onChange={(x) => setV({ ...v, valueField: x })} options={[['arr', 'ARR (spec)'], ['amount', 'Amount (total contract value)']]} />
        </Field>
        <Field label="Flag a share below (%)" hint="0 = off.">
          <NumberInput step={0.1} value={v.threshold} disabled={!canManage} onChange={(x) => setV({ ...v, threshold: x })} />
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Marketing lead sources">
          <CheckList options={data.sources} auto={data.marketing_auto} selected={v.sources} disabled={!canManage} onChange={(x) => setV({ ...v, sources: x })} />
        </Field>
        <Field label="New-business deal types">
          <CheckList options={data.types} auto={data.new_business_auto} selected={v.types} disabled={!canManage} onChange={(x) => setV({ ...v, types: x })} />
        </Field>
      </div>
      <Check
        checked={v.dups}
        disabled={!canManage}
        onChange={(x) => setV({ ...v, dups: x })}
        label={`Exclude duplicate-account deals (name = another account's name + extra words; ${(data.duplicates as Rows).length} found)`}
      />
      <Check checked={v.trueNew} disabled={!canManage} onChange={(x) => setV({ ...v, trueNew: x })} label="Won new-logo share: only accounts with no earlier won deal" />
    </Section>
  )
}

// ------------------------------------------------------------------------------------------- page block

export const OryonMetricSettings: React.FC<{ canManage: boolean; onError: (message: string) => void }> = ({ canManage, onError }) => {
  const { data, isLoading, error } = useOryonSettings()
  const s = data as Payload | undefined
  const common = { canManage, onError }
  const lineBody = useMemo(
    () => (cats: Record<string, string>, da: string[]) => ({ line_map: cats, da_ids: da }),
    []
  )
  return (
    <div className="flex flex-col gap-4">
      <div className="card p-6">
        <h2 className="text-lg font-semibold text-ink">Metric settings (Oryon)</h2>
        <p className="mt-1 text-sm text-ink-2">
          Everything the Oryon metrics on the portfolio screens use. Open a section to review it; ★ marks the automatic choice. Saving updates the
          numbers right away.
        </p>
        {isLoading && <p className="mt-4 text-sm text-ink-3">Loading…</p>}
        {error && <p className="mt-4 text-sm text-danger">Could not load the metric settings.</p>}
      </div>
      {s && (
        <>
          <MappingSection data={s.mapping} {...common} />
          <GeneralSection data={s.general} {...common} />
          <AccountPickSection data={s.cac} {...common} section="cac" code="VC-06" title="CAC expense accounts" description="Sales & marketing accounts in CAC (auto: 6010-6050 sales, 6110-6115 marketing payroll, 6120-6160 programs; customer success left out)." />
          <CategorySection
            data={s.cogs}
            {...common}
            section="cogs"
            code="VC-04"
            title="COGS % accounts"
            description="Product line of every income / COGS account (40xx/50xx Platform, 41xx/51xx Services, 42xx/52xx Hardware) and capitalized-software D&A (5040)."
            rows={s.cogs.accounts}
            field="line"
            choices={s.cogs.choices}
            da
            saved={s.cogs.saved}
            body={lineBody}
          />
          <AccountPickSection data={s.ga} {...common} section="ga" code="VC-09" title="G&A expense accounts" description="G&A accounts (auto: 6410-6485, 6495 and Insurance; 6490 deal fees and 6510/6520 D&A left out)." />
          <CategorySection
            data={s.ebitda}
            {...common}
            section="ebitda"
            code="VC-10"
            title="EBITDA account classification"
            description="Every P&L account as revenue / COGS / opex / below EBITDA / exclude, and which are D&A added back (auto: 5040, 6510, 6520)."
            rows={s.ebitda.accounts}
            field="cat"
            choices={s.ebitda.categories}
            da
            saved={s.ebitda.saved}
            body={(cats, da) => ({ category_map: cats, da_ids: da })}
          />
          <EbitdaPlanSection data={s.ebitda_plan} {...common} />
          <LtvSection data={s.ltv} {...common} />
          <AccountPickSection data={s.recurring} {...common} section="recurring" code="VC-12" title="Recurring revenue % accounts" description="Income accounts for the account-tagged comparison basis (auto: 4010 + 4015)." />
          <CashSection data={s.cash} {...common} />
          <FcfSection data={s.fcf} {...common} />
          <CccSection data={s.ccc} {...common} />
          <TopNSection data={s.concentration} {...common} section="concentration" />
          <TopNSection data={s.diversification} {...common} section="diversification" />
          <WinRateSection data={s.win_rate} {...common} />
          <FunnelSection data={s.funnel} {...common} />
          <MqlSection data={s.mql} {...common} />
          <RoiSection data={s.roi} {...common} />
          <MspSection data={s.msp} {...common} />
        </>
      )}
    </div>
  )
}
