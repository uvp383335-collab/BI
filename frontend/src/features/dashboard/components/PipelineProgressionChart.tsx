import React, { useMemo } from 'react'
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Cell } from 'recharts'
import { PipelineTransition } from '../api/syncApi'

interface PipelineProgressionChartProps {
  data: PipelineTransition[]
}

const formatStageName = (stage: string): string =>
  stage
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, (str) => str.toUpperCase())
    .trim()

const STAGE_COLORS: Record<string, string> = {
  appointmentscheduled: '#3b82f6',
  qualifiedtobuy: '#8b5cf6',
  presentationscheduled: '#ec4899',
  decisionmakerboughtin: '#f59e0b',
  contractsent: '#10b981',
  closedwon: '#22c55e',
  closedlost: '#ef4444'
}

const getStageColor = (stage: string): string => STAGE_COLORS[stage.toLowerCase()] || '#6b7280'

const STAGE_ORDER = [
  'appointmentscheduled',
  'qualifiedtobuy',
  'presentationscheduled',
  'decisionmakerboughtin',
  'contractsent',
  'closedwon',
  'closedlost'
]

/**
 * Bar chart of deals grouped by destination pipeline stage, ported from v1's
 * PipelineProgressionChart. Data comes solely from each deal's dealstage
 * change history, which is the only "history" data synced from HubSpot.
 */
export const PipelineProgressionChart: React.FC<PipelineProgressionChartProps> = ({ data }) => {
  const chartData = useMemo(() => {
    const counts: Record<string, number> = {}

    data.forEach((item) => {
      counts[item.toStage] = (counts[item.toStage] || 0) + item.count
      if (counts[item.fromStage] === undefined) counts[item.fromStage] = 0
    })

    const orderedStages = STAGE_ORDER.filter((s) => counts[s] !== undefined)
    const otherStages = Object.keys(counts).filter((s) => !orderedStages.includes(s))
    const stageArray = [...orderedStages, ...otherStages]

    return stageArray.map((stage) => ({
      stageKey: stage,
      name: formatStageName(stage),
      count: counts[stage] || 0
    }))
  }, [data])

  if (!data || data.length === 0) {
    return (
      <div className="flex h-80 items-center justify-center text-sm text-gray-500">
        No pipeline data available yet.
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="h-80">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} margin={{ top: 20, right: 20, left: 20, bottom: 20 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="name" tick={{ fontSize: 12 }} />
            <YAxis allowDecimals={false} />
            <Tooltip formatter={(value: number) => [`${value}`, 'Deals']} />
            <Bar dataKey="count" radius={[4, 4, 0, 0]}>
              {chartData.map((entry) => (
                <Cell key={entry.stageKey} fill={getStageColor(entry.stageKey)} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="overflow-hidden rounded-lg border border-gray-200">
        <table className="w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="p-3 text-left font-semibold text-gray-700">From Stage</th>
              <th className="p-3 text-left font-semibold text-gray-700">To Stage</th>
              <th className="p-3 text-right font-semibold text-gray-700">Count</th>
            </tr>
          </thead>
          <tbody>
            {data.map((item, index) => (
              <tr key={index} className="border-t border-gray-100 hover:bg-gray-50">
                <td className="p-3">{formatStageName(item.fromStage)}</td>
                <td className="p-3">{formatStageName(item.toStage)}</td>
                <td className="p-3 text-right font-medium">{item.count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
