import React from 'react'
import { Opportunity } from '../api/syncApi'
import { Modal } from '../../../shared/components/Modal'
import { DetailFieldColumns } from './DetailField'

interface OpportunityDetailPanelProps {
  opportunity: Opportunity
  onClose: () => void
}

const formatUsd = (n?: number) => (n != null ? `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : undefined)
const formatDate = (d?: string) => (d ? new Date(d).toLocaleDateString() : undefined)
const formatDateTime = (d?: string) => (d ? new Date(d).toLocaleString() : undefined)

/**
 * Full opportunity detail, laid out to match Salesforce's own Opportunity
 * "Details" tab (owner/name/account/type/lead-source on the left; amount/
 * revenue/dates/stage/probability/campaign/competitor on the right). Fields
 * with no fixed Salesforce API name — Order Number, Current Generator(s),
 * Tracking Number, Delivery/Installation Status are common examples — are
 * org-specific custom fields (same category of gap CM-03's competitor field
 * solves per-org); they show up here as `customFields` once configured in
 * Settings → Opportunity detail fields, rather than being guessed at.
 */
export const OpportunityDetailPanel: React.FC<OpportunityDetailPanelProps> = ({ opportunity, onClose }) => {
  const competitors = opportunity.competitors && opportunity.competitors.length > 0 ? opportunity.competitors.join(', ') : opportunity.competitor

  return (
    <Modal title={opportunity.dealname ?? 'Opportunity'} onClose={onClose} size="xl">
      <DetailFieldColumns
        left={[
          { label: 'Opportunity Owner', value: opportunity.ownerName },
          { label: 'Opportunity Name', value: opportunity.dealname },
          { label: 'Account Name', value: opportunity.accountName },
          { label: 'Type', value: opportunity.type },
          { label: 'Lead Source', value: opportunity.leadSource },
          ...(opportunity.customFields ?? []).map((f) => ({ label: f.label, value: f.value != null ? String(f.value) : undefined })),
          { label: 'Description', value: opportunity.description }
        ]}
        right={[
          { label: 'Amount', value: formatUsd(opportunity.amount) },
          { label: 'Expected Revenue', value: formatUsd(opportunity.expectedRevenue) },
          { label: 'Close Date', value: formatDate(opportunity.closedate) },
          { label: 'Next Step', value: opportunity.nextStep },
          { label: 'Stage', value: opportunity.dealstage },
          { label: 'Probability (%)', value: opportunity.probability != null ? `${opportunity.probability}%` : undefined },
          { label: 'Primary Campaign Source', value: opportunity.campaignName },
          { label: 'Main Competitor(s)', value: competitors }
        ]}
      />

      <div className="mt-2 grid grid-cols-1 gap-x-10 border-t border-line pt-3 text-xs text-ink-3 sm:grid-cols-2">
        {opportunity.createdByName && <p>Created By {opportunity.createdByName}</p>}
        {opportunity.lastModifiedByName && <p>Last Modified By {opportunity.lastModifiedByName}{formatDateTime(opportunity.lastModifiedAt) ? `, ${formatDateTime(opportunity.lastModifiedAt)}` : ''}</p>}
      </div>
    </Modal>
  )
}
