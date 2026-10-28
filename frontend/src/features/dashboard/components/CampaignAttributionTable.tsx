import React from 'react'

export interface CampaignAttributionRow {
  label: string
  pipeline: number
  revenue: number
  dealCount: number
}

interface CampaignAttributionTableProps {
  campaigns: CampaignAttributionRow[]
}

const formatUsd = (n: number) => `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`

/** CM-05's Salesforce-only named-campaign breakdown of marketing-sourced pipeline/revenue — already computed by cmMetrics.service.ts, just not previously rendered anywhere. */
export const CampaignAttributionTable: React.FC<CampaignAttributionTableProps> = ({ campaigns }) => {
  if (campaigns.length === 0) return null

  return (
    <div className="card border-line-strong p-4">
      <p className="mb-3 text-sm font-medium text-ink-2">Marketing-sourced pipeline & revenue by campaign</p>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-line text-ink-3">
              <th className="py-2 pr-4 font-medium">Campaign</th>
              <th className="py-2 pr-4 font-medium">Pipeline</th>
              <th className="py-2 pr-4 font-medium">Revenue</th>
              <th className="py-2 font-medium">Deals</th>
            </tr>
          </thead>
          <tbody>
            {campaigns.map((campaign) => (
              <tr key={campaign.label} className="border-b border-line last:border-0">
                <td className="py-2 pr-4 text-ink">{campaign.label}</td>
                <td className="py-2 pr-4 text-ink-2">{formatUsd(campaign.pipeline)}</td>
                <td className="py-2 pr-4 text-ink-2">{formatUsd(campaign.revenue)}</td>
                <td className="py-2 text-ink-2">{campaign.dealCount}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
