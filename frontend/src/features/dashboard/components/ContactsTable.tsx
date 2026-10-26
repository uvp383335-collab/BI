import React from 'react'
import { PaginatedResult, SalesforceContact } from '../api/syncApi'
import { PaginationFooter } from './PaginationFooter'

interface ContactsTableProps {
  data?: PaginatedResult<SalesforceContact>
  isLoading: boolean
  onPageChange: (page: number) => void
}

const fullName = (contact: SalesforceContact) => [contact.firstname, contact.lastname].filter(Boolean).join(' ') || '—'

/** Raw Salesforce Contact records (Salesforce's Contact object, not Leads) with the Account each belongs to. */
export const ContactsTable: React.FC<ContactsTableProps> = ({ data, isLoading, onPageChange }) => (
  <div className="card border-line-strong p-4">
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-line text-ink-3">
            <th className="py-2 pr-4 font-medium">Name</th>
            <th className="py-2 pr-4 font-medium">Email</th>
            <th className="py-2 font-medium">Account</th>
          </tr>
        </thead>
        <tbody>
          {isLoading && !data ? (
            <tr>
              <td colSpan={3} className="py-6 text-center text-ink-3">
                Loading contacts…
              </td>
            </tr>
          ) : !data || data.items.length === 0 ? (
            <tr>
              <td colSpan={3} className="py-6 text-center text-ink-3">
                No contacts synced yet.
              </td>
            </tr>
          ) : (
            data.items.map((contact) => (
              <tr key={contact._id} className="border-b border-line last:border-0">
                <td className="py-2 pr-4 text-ink">{fullName(contact)}</td>
                <td className="py-2 pr-4 text-ink-2">{contact.email ?? '—'}</td>
                <td className="py-2 text-ink-2">{contact.accountName ?? '—'}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>

    {data && <PaginationFooter page={data.page} pageSize={data.pageSize} total={data.total} onPageChange={onPageChange} />}
  </div>
)
