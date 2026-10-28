import React from 'react'
import { Campaign } from '../api/syncApi'
import { Modal } from '../../../shared/components/Modal'
import { DetailFieldColumns } from './DetailField'

interface CampaignDetailPanelProps {
  campaign: Campaign
  onClose: () => void
}

const formatUsd = (n?: number) => (n != null ? `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : undefined)
const formatDate = (d?: string) => (d ? new Date(d).toLocaleDateString() : undefined)
const formatDateTime = (d?: string) => (d ? new Date(d).toLocaleString() : undefined)

/**
 * Full campaign detail, matching Salesforce's own Campaign "Details" tab:
 * campaign setup on the left, the standard ROI/influence rollups
 * (Leads/Opportunities/Value in Campaign — the same figures Salesforce's own
 * Campaign Influence Report is built from) on the right.
 */
export const CampaignDetailPanel: React.FC<CampaignDetailPanelProps> = ({ campaign, onClose }) => (
  <Modal title={campaign.name ?? 'Campaign'} onClose={onClose} size="xl">
    <div className="mb-4 flex flex-wrap gap-x-8 gap-y-1 border-b border-line pb-4 text-sm">
      {campaign.type && (
        <span>
          <span className="text-ink-3">Type </span>
          <span className="text-ink">{campaign.type}</span>
        </span>
      )}
      {campaign.status && (
        <span>
          <span className="text-ink-3">Status </span>
          <span className="text-ink">{campaign.status}</span>
        </span>
      )}
      {formatDate(campaign.startDate) && (
        <span>
          <span className="text-ink-3">Start Date </span>
          <span className="text-ink">{formatDate(campaign.startDate)}</span>
        </span>
      )}
      {formatDate(campaign.endDate) && (
        <span>
          <span className="text-ink-3">End Date </span>
          <span className="text-ink">{formatDate(campaign.endDate)}</span>
        </span>
      )}
    </div>

    <DetailFieldColumns
      left={[
        { label: 'Campaign Owner', value: campaign.ownerName },
        { label: 'Campaign Name', value: campaign.name },
        { label: 'Active', value: campaign.active != null ? (campaign.active ? 'Yes' : 'No') : undefined },
        { label: 'Type', value: campaign.type },
        { label: 'Status', value: campaign.status },
        { label: 'Start Date', value: formatDate(campaign.startDate) },
        { label: 'End Date', value: formatDate(campaign.endDate) },
        { label: 'Expected Revenue in Campaign', value: formatUsd(campaign.expectedRevenue) },
        { label: 'Budgeted Cost in Campaign', value: formatUsd(campaign.budgetedCost) },
        { label: 'Actual Cost in Campaign', value: formatUsd(campaign.actualCost) },
        { label: 'Expected Response (%)', value: campaign.expectedResponsePct != null ? `${campaign.expectedResponsePct.toFixed(2)}%` : undefined },
        { label: 'Num Sent in Campaign', value: campaign.numberSent?.toLocaleString() },
        { label: 'Parent Campaign', value: campaign.parentCampaignName },
        { label: 'Description', value: campaign.description }
      ]}
      right={[
        { label: 'Leads in Campaign', value: campaign.numberOfLeads?.toLocaleString() },
        { label: 'Converted Leads in Campaign', value: campaign.numberOfConvertedLeads?.toLocaleString() },
        { label: 'Contacts in Campaign', value: campaign.numberOfContacts?.toLocaleString() },
        { label: 'Responses in Campaign', value: campaign.numberOfResponses?.toLocaleString() },
        { label: 'Opportunities in Campaign', value: campaign.numberOfOpportunities?.toLocaleString() },
        { label: 'Won Opportunities in Campaign', value: campaign.numberOfWonOpportunities?.toLocaleString() },
        { label: 'Value Opportunities in Campaign', value: formatUsd(campaign.amountAllOpportunities) },
        { label: 'Value Won Opportunities in Campaign', value: formatUsd(campaign.amountWonOpportunities) }
      ]}
    />

    <div className="mt-2 grid grid-cols-1 gap-x-10 border-t border-line pt-3 text-xs text-ink-3 sm:grid-cols-2">
      {campaign.createdByName && <p>Created By {campaign.createdByName}</p>}
      {campaign.lastModifiedByName && (
        <p>
          Last Modified By {campaign.lastModifiedByName}
          {formatDateTime(campaign.lastModifiedAt) ? `, ${formatDateTime(campaign.lastModifiedAt)}` : ''}
        </p>
      )}
    </div>
  </Modal>
)
