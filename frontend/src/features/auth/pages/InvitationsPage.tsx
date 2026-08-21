import React, { useState } from 'react'
import { Link } from 'react-router-dom'
import { useListInvitations } from '../hooks/useInvitations'
import { useAuthContext } from '../../../shared/context/AuthContext'
import { buttonClass, inputClass } from '../components/formControls'
import { InviteMemberCard } from '../components/InviteMemberCard'

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
    <div className="min-h-screen bg-gray-50 text-gray-900">
      <header className="border-b border-slate-200 bg-white px-6 py-6 shadow-sm shadow-slate-100/50">
        <div className="mx-auto flex max-w-6xl items-center justify-between">
          <div>
            <p className="text-sm font-semibold text-blue-600">Invitations</p>
            <h1 className="mt-2 text-2xl font-semibold text-slate-900">Invitation management</h1>
            <p className="mt-1 text-sm text-slate-600">Manage pending and historical invitations for {organization?.name}</p>
          </div>
          <Link to="/" className="btn-outline">
            Back to dashboard
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-8">
        <div className="mb-8">
          <InviteMemberCard />
        </div>

        <div className="mb-4 grid grid-cols-1 sm:grid-cols-3 gap-4">
          <select className={inputClass} value={statusFilter ?? ''} onChange={(e) => setStatusFilter(e.target.value || undefined)}>
            <option value="">All statuses</option>
            <option value="pending">Pending</option>
            <option value="accepted">Accepted</option>
            <option value="expired">Expired</option>
            <option value="revoked">Revoked</option>
          </select>
          <select className={inputClass} value={roleFilter ?? ''} onChange={(e) => setRoleFilter(e.target.value || undefined)}>
            <option value="">All roles</option>
            <option value="owner">Owner</option>
            <option value="admin">Admin</option>
            <option value="member">Member</option>
          </select>
          <div className="flex gap-2">
            <button className={buttonClass} onClick={() => { setPage(1); refetch() }}>Apply</button>
            <button className="btn-outline" onClick={() => { setStatusFilter(undefined); setRoleFilter(undefined); setPage(1); refetch() }}>Reset</button>
          </div>
        </div>

        <div className="overflow-x-auto bg-white rounded-2xl border border-gray-200">
          <table className="w-full text-left table-auto">
            <thead>
              <tr className="text-sm text-gray-600">
                <th className="px-4 py-3">Email</th>
                <th className="px-4 py-3">Role</th>
                <th className="px-4 py-3">Invited by</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Created</th>
                <th className="px-4 py-3">Expires</th>
                <th className="px-4 py-3">Accepted</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && (
                <tr><td colSpan={7} className="px-4 py-6 text-sm text-gray-500">Loading…</td></tr>
              )}
              {isError && (
                <tr><td colSpan={7} className="px-4 py-6 text-sm text-red-600">Could not load invitations</td></tr>
              )}
              {!isLoading && items.length === 0 && (
                <tr><td colSpan={7} className="px-4 py-6 text-sm text-gray-500">No invitations found</td></tr>
              )}
              {items.map((inv: any) => (
                <tr key={inv._id} className="border-t">
                  <td className="px-4 py-3 text-sm text-gray-800">{inv.email}</td>
                  <td className="px-4 py-3 text-sm text-gray-700 capitalize">{inv.role}</td>
                  <td className="px-4 py-3 text-sm text-gray-700">{inv.invitedBy?.name ?? inv.invitedBy?.email ?? '—'}</td>
                  <td className="px-4 py-3 text-sm">{inv.status}</td>
                  <td className="px-4 py-3 text-sm text-gray-600">{new Date(inv.createdAt).toLocaleString()}</td>
                  <td className="px-4 py-3 text-sm text-gray-600">{inv.expiresAt ? new Date(inv.expiresAt).toLocaleString() : '—'}</td>
                  <td className="px-4 py-3 text-sm text-gray-600">{inv.acceptedAt ? new Date(inv.acceptedAt).toLocaleString() : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-4 flex items-center justify-between">
          <div className="text-sm text-gray-600">Showing page {page} of {Math.max(1, Math.ceil(total / pageSize))} — {total} invitations</div>
          <div className="flex gap-2">
            <button className="btn-outline" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>Previous</button>
            <button className={buttonClass} disabled={page >= Math.ceil(total / pageSize)} onClick={() => setPage((p) => p + 1)}>Next</button>
          </div>
        </div>
      </main>
    </div>
  )
}
