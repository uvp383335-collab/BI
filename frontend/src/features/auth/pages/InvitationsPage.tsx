import React, { useState } from 'react'
import { useListInvitations } from '../hooks/useInvitations'
import { useAuthContext } from '../../../shared/context/AuthContext'
import { InviteMemberCard } from '../components/InviteMemberCard'
import { AppShell } from '../../../widgets/AppShell'

export const InvitationsPage: React.FC = () => {
  const { organization } = useAuthContext()
  const [page, setPage] = useState(1)
  const [pageSize] = useState(10)
  const [statusFilter, setStatusFilter] = useState<string | undefined>(undefined)
  const [roleFilter, setRoleFilter] = useState<string | undefined>(undefined)

  const { data, isLoading, isError, refetch } = useListInvitations({ page, pageSize, status: statusFilter, role: roleFilter })
  const items = (data && data.items) ?? []
  const total = (data && data.total) ?? 0
  return (
    <AppShell title="Invitation management" subtitle={`Manage pending and historical invitations for ${organization?.name ?? ''}`}>
      <InviteMemberCard />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <select
          className="form-input-dark"
          value={statusFilter ?? ''}
          onChange={(e) => setStatusFilter(e.target.value || undefined)}
        >
          <option value="">All statuses</option>
          <option value="pending">Pending</option>
          <option value="accepted">Accepted</option>
          <option value="expired">Expired</option>
          <option value="revoked">Revoked</option>
        </select>
        <select
          className="form-input-dark"
          value={roleFilter ?? ''}
          onChange={(e) => setRoleFilter(e.target.value || undefined)}
        >
          <option value="">All roles</option>
          <option value="owner">Owner</option>
          <option value="admin">Admin</option>
          <option value="member">Member</option>
        </select>
        <div className="flex gap-2">
          <button className="btn-primary w-auto px-5 py-2" onClick={() => { setPage(1); refetch() }}>Apply</button>
          <button
            className="btn-outline-dark w-auto px-5 py-2"
            onClick={() => { setStatusFilter(undefined); setRoleFilter(undefined); setPage(1); refetch() }}
          >
            Reset
          </button>
        </div>
      </div>

      <div className="card overflow-hidden">
        <table className="w-full text-left text-sm">
          <thead className="bg-surface-3">
            <tr>
              <th className="p-3 font-semibold text-ink-2">Email</th>
              <th className="p-3 font-semibold text-ink-2">Role</th>
              <th className="p-3 font-semibold text-ink-2">Invited by</th>
              <th className="p-3 font-semibold text-ink-2">Status</th>
              <th className="p-3 font-semibold text-ink-2">Created</th>
              <th className="p-3 font-semibold text-ink-2">Expires</th>
              <th className="p-3 font-semibold text-ink-2">Accepted</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr><td colSpan={7} className="p-4 text-ink-3">Loading…</td></tr>
            )}
            {isError && (
              <tr><td colSpan={7} className="p-4 text-danger">Could not load invitations</td></tr>
            )}
            {!isLoading && items.length === 0 && (
              <tr><td colSpan={7} className="p-4 text-ink-3">No invitations found</td></tr>
            )}
            {items.map((inv: any) => (
              <tr key={inv._id} className="border-t border-line hover:bg-surface-3/60">
                <td className="p-3 text-ink">{inv.email}</td>
                <td className="p-3 text-ink-2 capitalize">{inv.role}</td>
                <td className="p-3 text-ink-2">{inv.invitedBy?.name ?? inv.invitedBy?.email ?? '—'}</td>
                <td className="p-3 text-ink capitalize">{inv.status}</td>
                <td className="p-3 text-ink-3">{new Date(inv.createdAt).toLocaleString()}</td>
                <td className="p-3 text-ink-3">{inv.expiresAt ? new Date(inv.expiresAt).toLocaleString() : '—'}</td>
                <td className="p-3 text-ink-3">{inv.acceptedAt ? new Date(inv.acceptedAt).toLocaleString() : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between">
        <div className="text-sm text-ink-2">Showing page {page} of {Math.max(1, Math.ceil(total / pageSize))} — {total} invitations</div>
        <div className="flex gap-2">
          <button className="btn-outline-dark w-auto px-4 py-2" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
            Previous
          </button>
          <button
            className="btn-primary w-auto px-4 py-2"
            disabled={page >= Math.ceil(total / pageSize)}
            onClick={() => setPage((p) => p + 1)}
          >
            Next
          </button>
        </div>
      </div>
    </AppShell>
  )
}
