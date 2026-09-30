import React from 'react'
import { ChannelROI } from '../api/syncApi'
import { formatMetricValue } from '../utils/formatMetricValue'

interface MarketingROIByChannelTableProps {
  data: ChannelROI[]
}

function formatUsd(value: number): string {
  return formatMetricValue(value, 'usd')
}

/** "Marketing ROI by channel" (docs/server.js's renderMarketingROIByChannel) — CAC and blended ROI per Campaign Type, built from Salesforce Campaign cost + won-opportunity rollups. */
export const MarketingROIByChannelTable: React.FC<MarketingROIByChannelTableProps> = ({ data }) => {
  if (data.length === 0) {
    return <div className="flex h-24 items-center justify-center text-sm text-ink-3">No campaign data found.</div>
  }

  const totalCost = data.reduce((sum, c) => sum + c.cost, 0)
  const totalRevenue = data.reduce((sum, c) => sum + c.revenue, 0)
  const overallRoi = totalCost > 0 ? ((totalRevenue - totalCost) / totalCost) * 100 : null

  return (
    <div>
      <div className="flex flex-wrap items-center gap-5 rounded-lg border border-line bg-surface-2 p-4">
        <div className="flex min-w-[70px] flex-col items-center">
          <div className="text-2xl font-bold text-ink">{overallRoi === null ? 'N/A' : `${overallRoi >= 0 ? '+' : ''}${overallRoi.toFixed(0)}%`}</div>
          <div className="mt-1 text-[11px] font-semibold uppercase tracking-wide text-brand">Marketing ROI</div>
        </div>
        <div className="text-sm text-ink-2">
          {formatUsd(totalRevenue)} won revenue vs {formatUsd(totalCost)} spent across {data.length} channel{data.length === 1 ? '' : 's'}
        </div>
      </div>

      <div className="mt-4 overflow-x-auto rounded-lg border border-line">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line bg-surface-2 text-left text-xs font-semibold uppercase tracking-wide text-ink-3">
              <th className="px-4 py-2.5">Channel</th>
              <th className="px-4 py-2.5">Campaigns</th>
              <th className="px-4 py-2.5">Spend</th>
              <th className="px-4 py-2.5">Won Revenue</th>
              <th className="px-4 py-2.5">Customers</th>
              <th className="px-4 py-2.5">CAC</th>
              <th className="px-4 py-2.5">ROI</th>
            </tr>
          </thead>
          <tbody>
            {data.map((channel) => (
              <tr key={channel.channel} className="border-b border-line last:border-0">
                <td className="px-4 py-2.5 text-ink">{channel.channel}</td>
                <td className="px-4 py-2.5 text-ink-2">{channel.campaigns}</td>
                <td className="px-4 py-2.5 text-ink-2">{formatUsd(channel.cost)}</td>
                <td className="px-4 py-2.5 text-ink-2">{formatUsd(channel.revenue)}</td>
                <td className="px-4 py-2.5 text-ink-2">{channel.customers}</td>
                <td className="px-4 py-2.5 text-ink-2">{channel.cac === null ? <span className="text-ink-3">N/A</span> : formatUsd(channel.cac)}</td>
                <td className="px-4 py-2.5 text-ink-2">
                  {channel.roi === null ? <span className="text-ink-3">N/A</span> : `${channel.roi >= 0 ? '+' : ''}${channel.roi.toFixed(1)}%`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
