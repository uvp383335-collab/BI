import React from 'react'
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { OwnerLeadCount } from '../api/syncApi'

interface LeadsByOwnerChartProps {
  data: OwnerLeadCount[]
}

/** Horizontal "Leads by Owner" histogram — how many open leads each rep currently owns (docs/server.js's renderLeadsByOwnerHistogram, computeLeadsByOwner). */
export const LeadsByOwnerChart: React.FC<LeadsByOwnerChartProps> = ({ data }) => {
  if (data.length === 0) {
    return <div className="flex h-32 items-center justify-center text-sm text-ink-3">No leads found.</div>
  }

  const rowHeight = 32
  const chartHeight = Math.max(120, data.length * rowHeight)

  return (
    <div style={{ height: chartHeight }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ top: 4, right: 24, left: 0, bottom: 4 }}>
          <CartesianGrid stroke="var(--color-line)" horizontal={false} />
          <XAxis
            type="number"
            allowDecimals={false}
            stroke="var(--color-ink-3)"
            tick={{ fill: 'var(--color-ink-2)', fontSize: 11 }}
            tickLine={false}
            axisLine={{ stroke: 'var(--color-line)' }}
          />
          <YAxis
            type="category"
            dataKey="owner"
            stroke="var(--color-ink-3)"
            tick={{ fill: 'var(--color-ink-2)', fontSize: 12 }}
            tickLine={false}
            axisLine={false}
            width={140}
          />
          <Tooltip
            contentStyle={{ background: 'var(--color-surface-3)', border: '1px solid var(--color-line-strong)', borderRadius: 8, fontSize: 12 }}
            labelStyle={{ color: 'var(--color-ink)', fontWeight: 600, marginBottom: 4 }}
            formatter={(value) => [`${value} lead${value === 1 ? '' : 's'}`, undefined]}
          />
          <Bar dataKey="count" name="Leads" fill="var(--color-brand)" radius={[0, 4, 4, 0]} maxBarSize={18} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
