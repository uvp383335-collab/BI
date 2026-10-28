import React from 'react'
import { Opportunity, PaginatedResult } from '../api/syncApi'
import { PaginationFooter } from './PaginationFooter'

interface OpportunitiesTableProps {
  data?: PaginatedResult<Opportunity>
  isLoading: boolean
  onPageChange: (page: number) => void
  onRowClick: (opportunity: Opportunity) => void
}

const formatAmount = (amount?: number) => (amount != null ? `$${amount.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : '—')
const formatDate = (date?: string) => (date ? new Date(date).toLocaleDateString() : '—')

/** Raw, unaggregated opportunity/deal records — every synced field, not just what a metric needed. Click a row for the full detail view. */
export const OpportunitiesTable: React.FC<OpportunitiesTableProps> = ({ data, isLoading, onPageChange, onRowClick }) => (
  <div className="card border-line-strong p-4">
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-line text-ink-3">
            <th className="py-2 pr-4 font-medium">Name</th>
            <th className="py-2 pr-4 font-medium">Stage</th>
            <th className="py-2 pr-4 font-medium">Pipeline</th>
            <th className="py-2 pr-4 font-medium">Amount</th>
            <th className="py-2 pr-4 font-medium">Close Date</th>
            <th className="py-2 pr-4 font-medium">Lead Source</th>
            <th className="py-2 font-medium">Campaign</th>
          </tr>
        </thead>
        <tbody>
          {isLoading && !data ? (
            <tr>
              <td colSpan={7} className="py-6 text-center text-ink-3">
                Loading opportunities…
              </td>
            </tr>
          ) : !data || data.items.length === 0 ? (
            <tr>
              <td colSpan={7} className="py-6 text-center text-ink-3">
                No opportunities synced yet.
              </td>
            </tr>
          ) : (
            data.items.map((opp) => (
              <tr
                key={opp._id}
                className="cursor-pointer border-b border-line last:border-0 hover:bg-surface-3"
                onClick={() => onRowClick(opp)}
              >
                <td className="py-2 pr-4 text-ink">{opp.dealname ?? '—'}</td>
                <td className="py-2 pr-4 text-ink-2">{opp.dealstage ?? '—'}</td>
                <td className="py-2 pr-4 text-ink-2">{opp.pipeline ?? '—'}</td>
                <td className="py-2 pr-4 text-ink-2">{formatAmount(opp.amount)}</td>
                <td className="py-2 pr-4 text-ink-2">{formatDate(opp.closedate)}</td>
                <td className="py-2 pr-4 text-ink-2">{opp.leadSource ?? '—'}</td>
                <td className="py-2 text-ink-2">{opp.campaignName ?? opp.campaignId ?? '—'}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>

    {data && <PaginationFooter page={data.page} pageSize={data.pageSize} total={data.total} onPageChange={onPageChange} />}
  </div>
)
