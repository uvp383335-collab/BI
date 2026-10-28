import React from 'react'

export interface CompetitorBreakdownRow {
  competitor: string
  wins: number
  losses: number
  decided: number
  winRatePct: number | null
  priorWinRatePct: number | null
  deltaPoints: number | null
  eligible: boolean
}

interface CompetitorBreakdownTableProps {
  competitors: CompetitorBreakdownRow[]
}

/** CM-03's per-competitor opportunity win/loss detail — already computed by cmMetrics.service.ts, just not previously rendered anywhere (only the blended win rate was shown). */
export const CompetitorBreakdownTable: React.FC<CompetitorBreakdownTableProps> = ({ competitors }) => {
  if (competitors.length === 0) return null

  return (
    <div className="card border-line-strong p-4">
      <p className="mb-3 text-sm font-medium text-ink-2">Win rate by named competitor</p>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-line text-ink-3">
              <th className="py-2 pr-4 font-medium">Competitor</th>
              <th className="py-2 pr-4 font-medium">Wins</th>
              <th className="py-2 pr-4 font-medium">Losses</th>
              <th className="py-2 pr-4 font-medium">Win Rate</th>
              <th className="py-2 font-medium">Vs. Prior</th>
            </tr>
          </thead>
          <tbody>
            {competitors.map((c) => (
              <tr key={c.competitor} className="border-b border-line last:border-0">
                <td className="py-2 pr-4 text-ink">{c.competitor}</td>
                <td className="py-2 pr-4 text-ink-2">{c.wins}</td>
                <td className="py-2 pr-4 text-ink-2">{c.losses}</td>
                <td className="py-2 pr-4 text-ink-2">{c.winRatePct != null ? `${c.winRatePct.toFixed(1)}%` : '—'}</td>
                <td className="py-2 text-ink-2">
                  {c.deltaPoints != null ? `${c.deltaPoints > 0 ? '+' : ''}${c.deltaPoints.toFixed(1)} pts` : c.eligible ? '—' : 'Not enough decided deals yet'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
