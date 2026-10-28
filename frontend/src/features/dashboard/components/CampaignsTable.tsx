import React from 'react'
import { Campaign, PaginatedResult } from '../api/syncApi'
import { PaginationFooter } from './PaginationFooter'

interface CampaignsTableProps {
  data?: PaginatedResult<Campaign>
  isLoading: boolean
  onPageChange: (page: number) => void
  onRowClick: (campaign: Campaign) => void
}

const formatUsd = (n?: number) => (n != null ? `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : '—')

/** Raw Salesforce Campaign records — every synced field (including the standard ROI/influence rollups) is available in the detail view; click a row to open it. */
export const CampaignsTable: React.FC<CampaignsTableProps> = ({ data, isLoading, onPageChange, onRowClick }) => (
  <div className="card border-line-strong p-4">
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-line text-ink-3">
            <th className="py-2 pr-4 font-medium">Name</th>
            <th className="py-2 pr-4 font-medium">Type</th>
            <th className="py-2 pr-4 font-medium">Status</th>
            <th className="py-2 pr-4 font-medium">Opportunities</th>
            <th className="py-2 font-medium">Value Won</th>
          </tr>
        </thead>
        <tbody>
          {isLoading && !data ? (
            <tr>
              <td colSpan={5} className="py-6 text-center text-ink-3">
                Loading campaigns…
              </td>
            </tr>
          ) : !data || data.items.length === 0 ? (
            <tr>
              <td colSpan={5} className="py-6 text-center text-ink-3">
                No campaigns synced yet.
              </td>
            </tr>
          ) : (
            data.items.map((campaign) => (
              <tr
                key={campaign._id}
                className="cursor-pointer border-b border-line last:border-0 hover:bg-surface-3"
                onClick={() => onRowClick(campaign)}
              >
                <td className="py-2 pr-4 text-ink">{campaign.name ?? '—'}</td>
                <td className="py-2 pr-4 text-ink-2">{campaign.type ?? '—'}</td>
                <td className="py-2 pr-4 text-ink-2">{campaign.status ?? '—'}</td>
                <td className="py-2 pr-4 text-ink-2">{campaign.numberOfOpportunities ?? '—'}</td>
                <td className="py-2 text-ink-2">{formatUsd(campaign.amountWonOpportunities)}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>

    {data && <PaginationFooter page={data.page} pageSize={data.pageSize} total={data.total} onPageChange={onPageChange} />}
  </div>
)
