/* eslint-disable @typescript-eslint/no-explicit-any */
import React from 'react'
import {
  ResponsiveContainer, ComposedChart, Bar, Line, Area, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ReferenceLine
} from 'recharts'
import { Fmt, fmt, axisFmt, csvCell, SERIES } from './format'

export type Row = Record<string, any>

// ------------------------------------------------------------------------------------- chart

export interface SeriesCfg {
  label: string
  value: (r: Row) => number | null | undefined
  type?: 'line' | 'bar' | 'area'
  /** bars/areas with the same stack id are stacked */
  stack?: string
  axis?: 'left' | 'right'
  dashed?: boolean
  color?: string
}

export interface ChartCfg {
  title: string
  sub?: string
  /** rows to plot (default: the page's table rows) */
  rows?: (p: Row) => Row[]
  x: (r: Row) => string
  series: (p: Row) => SeriesCfg[]
  yFmt?: Fmt
  rightFmt?: Fmt
  refs?: (p: Row) => Array<{ y: number; label: string }>
  height?: number
}

export const MetricChart: React.FC<{ cfg: ChartCfg; payload: Row; rows: Row[] }> = ({ cfg, payload, rows }) => {
  const data = (cfg.rows ? cfg.rows(payload) : rows) ?? []
  const series = cfg.series(payload)
  const points = data.map((r) => {
    const o: Row = { __x: cfg.x(r) }
    series.forEach((s, i) => {
      const v = s.value(r)
      o[`s${i}`] = typeof v === 'number' && Number.isFinite(v) ? v : null
    })
    return o
  })
  const hasRight = series.some((s) => s.axis === 'right')
  const yf = cfg.yFmt ?? 'num'
  const rf = cfg.rightFmt ?? 'num'
  return (
    <div className="card p-5">
      <h3 className="text-sm font-semibold text-ink">{cfg.title}</h3>
      {cfg.sub && <p className="mt-0.5 text-xs text-ink-3">{cfg.sub}</p>}
      {points.length === 0 ? (
        <p className="mt-6 text-sm text-ink-3">No data for this view.</p>
      ) : (
        <div style={{ width: '100%', height: cfg.height ?? 260 }} className="mt-3">
          <ResponsiveContainer>
            <ComposedChart data={points} margin={{ top: 8, right: hasRight ? 8 : 16, left: 8, bottom: 0 }}>
              <CartesianGrid stroke="var(--line)" strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="__x" tick={{ fill: 'var(--faint)', fontSize: 11 }} stroke="var(--line)" minTickGap={16} />
              <YAxis yAxisId="left" tick={{ fill: 'var(--faint)', fontSize: 11 }} stroke="var(--line)" tickFormatter={axisFmt(yf)} width={64} />
              {hasRight && <YAxis yAxisId="right" orientation="right" tick={{ fill: 'var(--faint)', fontSize: 11 }} stroke="var(--line)" tickFormatter={axisFmt(rf)} width={56} />}
              <Tooltip
                contentStyle={{ background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 8, fontSize: 12 }}
                labelStyle={{ color: 'var(--fg)' }}
                formatter={(v: any, name: any, item: any) => {
                  const s = series[Number(String(item.dataKey).slice(1))]
                  return [fmt(v, s?.axis === 'right' ? rf : yf), name]
                }}
              />
              <Legend wrapperStyle={{ fontSize: 12, color: 'var(--muted)' }} />
              {(cfg.refs?.(payload) ?? []).map((r) => (
                <ReferenceLine key={r.label} yAxisId="left" y={r.y} ifOverflow="extendDomain" stroke="var(--bad)" strokeDasharray="5 4" label={{ value: r.label, fill: 'var(--faint)', fontSize: 10, position: 'insideTopRight' }} />
              ))}
              {series.map((s, i) => {
                const color = s.color ?? SERIES[i % SERIES.length]
                const common = { key: i, dataKey: `s${i}`, name: s.label, yAxisId: s.axis ?? 'left', isAnimationActive: false }
                if (s.type === 'bar') return <Bar {...common} fill={color} stackId={s.stack} maxBarSize={36} />
                if (s.type === 'area') return <Area {...common} type="monotone" stroke={color} fill={color} fillOpacity={0.25} stackId={s.stack} connectNulls />
                return <Line {...common} type="monotone" stroke={color} strokeWidth={2} strokeDasharray={s.dashed ? '5 4' : undefined} dot={points.length < 20} connectNulls />
              })}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  )
}

// ------------------------------------------------------------------------------------- table + CSV

export interface Column {
  label: string
  value: (r: Row) => unknown
  fmt?: Fmt
  /** highlight negative / warning values */
  tone?: (r: Row) => 'bad' | 'good' | undefined
}

export function downloadCsv(filename: string, columns: Column[], rows: Row[]): void {
  const lines = [columns.map((c) => csvCell(c.label)).join(','), ...rows.map((r) => columns.map((c) => csvCell(c.value(r))).join(','))]
  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export const DataTable: React.FC<{
  title?: string
  columns: Column[]
  rows: Row[]
  csvName?: string
  onRow?: (r: Row) => void
  rowLabel?: string
  maxHeight?: number
  rowClass?: (r: Row) => string
}> = ({ title, columns, rows, csvName, onRow, rowLabel = 'details', maxHeight = 520, rowClass }) => (
  <div className="card p-5">
    <div className="flex flex-wrap items-center justify-between gap-2">
      {title && <h3 className="text-sm font-semibold text-ink">{title}</h3>}
      {csvName && rows.length > 0 && (
        <button type="button" className="rounded-md border border-line px-3 py-1.5 text-xs text-ink-2 hover:bg-surface-3" onClick={() => downloadCsv(csvName, columns, rows)}>
          Download CSV
        </button>
      )}
    </div>
    {rows.length === 0 ? (
      <p className="mt-4 text-sm text-ink-3">No rows.</p>
    ) : (
      <div className="mt-3 overflow-auto rounded-md border border-line" style={{ maxHeight }}>
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-surface-2 text-left text-xs text-ink-3">
            <tr>
              {columns.map((c) => (
                <th key={c.label} className={`whitespace-nowrap px-3 py-2 ${c.fmt && c.fmt !== 'text' && c.fmt !== 'bool' ? 'text-right' : ''}`}>
                  {c.label}
                </th>
              ))}
              {onRow && <th className="px-3 py-2" />}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className={`border-t border-line ${rowClass?.(r) ?? ''}`}>
                {columns.map((c) => {
                  const tone = c.tone?.(r)
                  return (
                    <td
                      key={c.label}
                      className={`whitespace-nowrap px-3 py-1.5 tabular-nums ${c.fmt && c.fmt !== 'text' && c.fmt !== 'bool' ? 'text-right' : ''} ${tone === 'bad' ? 'text-danger' : tone === 'good' ? 'text-success' : ''}`}
                    >
                      {fmt(c.value(r), c.fmt ?? 'text')}
                    </td>
                  )
                })}
                {onRow && (
                  <td className="px-3 py-1.5 text-right">
                    <button type="button" className="text-xs text-brand hover:underline" onClick={() => onRow(r)}>
                      {rowLabel}
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )}
  </div>
)

// ------------------------------------------------------------------------------------- KPI cards

export interface Kpi {
  label: string
  value: unknown
  fmt?: Fmt
  sub?: string
  tone?: 'bad' | 'good'
}

export const KpiRow: React.FC<{ kpis: Kpi[] }> = ({ kpis }) => (
  <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
    {kpis.map((k) => (
      <div key={k.label} className="card p-4">
        <p className="text-xs text-ink-3">{k.label}</p>
        <p className={`mt-1 text-xl font-semibold tabular-nums ${k.tone === 'bad' ? 'text-danger' : k.tone === 'good' ? 'text-success' : 'text-ink'}`}>
          {fmt(k.value, k.fmt ?? 'num')}
        </p>
        {k.sub && <p className="mt-0.5 text-xs text-ink-3">{k.sub}</p>}
      </div>
    ))}
  </div>
)
