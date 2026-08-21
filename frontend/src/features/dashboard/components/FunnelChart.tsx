import React from 'react'
import { FunnelChartData, FunnelStage } from '../api/syncApi'

interface FunnelChartProps {
  title: string
  description: string
  data?: FunnelChartData
  filters?: React.ReactNode
}

// Stages are ordered by magnitude, not distinct identity, so color follows the
// dataviz sequential rule: one hue (brand), lightness stepping down per rank.
// isWon/isClosed stages break out of the sequence into the reserved status
// colors so a "final outcome" bar always reads distinctly.
const SEQUENTIAL_OPACITY = [1, 0.78, 0.6, 0.46, 0.36]

function stageFill(index: number, isClosed: boolean, isWon: boolean): string {
  if (isWon) return 'var(--color-success)'
  if (isClosed) return 'var(--color-danger)'
  const opacity = SEQUENTIAL_OPACITY[Math.min(index, SEQUENTIAL_OPACITY.length - 1)]
  return `color-mix(in srgb, var(--color-brand) ${opacity * 100}%, var(--color-surface-2))`
}

interface FunnelRow {
  rawStage: string
  name: string
  value: number
  fill: string
  pctOfTotal: number
  dropFromPrevious: number | null
}

function buildRows(stages: FunnelStage[], total: number): FunnelRow[] {
  return stages.map((stage, index) => ({
    rawStage: stage.rawStage,
    name: stage.label,
    value: stage.count,
    fill: stageFill(index, stage.isClosed, stage.isWon),
    pctOfTotal: total === 0 ? 0 : (stage.count / total) * 100,
    dropFromPrevious:
      index === 0 || stages[index - 1].count === 0
        ? null
        : Math.round((1 - stage.count / stages[index - 1].count) * 100)
  }))
}

export const FunnelChart: React.FC<FunnelChartProps> = ({ title, description, data, filters }) => {
  const stages = data?.stages ?? []
  const total = data?.totalEntered ?? 0
  const rows = buildRows(stages, total)

  return (
    <div>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="text-lg font-semibold text-ink">{title}</h3>
          <p className="text-sm text-ink-2">{description}</p>
        </div>
        {filters && <div className="flex gap-3">{filters}</div>}
      </div>

      {rows.length === 0 || total === 0 ? (
        <div className="flex h-64 items-center justify-center text-sm text-ink-3">No funnel data available yet.</div>
      ) : (
        <div className="mt-5 flex flex-col gap-3.5">
          {rows.map((row) => (
            <div
              key={row.rawStage}
              className="grid grid-cols-[13rem_1fr_9rem] items-center gap-4"
              title={`${row.name}: ${row.value.toLocaleString()} (${row.pctOfTotal.toFixed(0)}% of total)`}
            >
              <span className="truncate text-sm font-medium text-ink">{row.name}</span>
              <div className="h-5">
                <div
                  className="h-full transition-[width] duration-300"
                  style={{
                    width: `${Math.max(row.pctOfTotal, row.value > 0 ? 1.5 : 0)}%`,
                    backgroundColor: row.fill,
                    borderRadius: '0 4px 4px 0'
                  }}
                />
              </div>
              <span className="text-right text-sm text-ink-2">
                <span className="font-semibold text-ink">{row.value.toLocaleString()}</span>
                {` · ${row.pctOfTotal.toFixed(0)}%`}
                {row.dropFromPrevious !== null && row.dropFromPrevious > 0 && (
                  <span className="text-danger">{` · -${row.dropFromPrevious}%`}</span>
                )}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
