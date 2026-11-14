import React, { useEffect, useRef, useState } from 'react'
import { Check, ChevronsUpDown, Plus } from 'lucide-react'
import { useOrganizations } from '../hooks/useOrganizations'
import { useSwitchOrg, useCreateOrganization } from '../hooks/useAuthMutations'
import { useAuthContext } from '../../../shared/context/AuthContext'
import { Modal } from '../../../shared/components/Modal'
import { Banner } from '../../../shared/components/Banner'

const initialsOf = (name: string) =>
  name
    .split(' ')
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase()

const CreateOrganizationModal: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const createOrganization = useCreateOrganization()
  const { setSession } = useAuthContext()
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) return
    setError(null)
    try {
      const res = await createOrganization.mutateAsync(trimmed)
      setSession(res.accessToken, res.organization)
      onClose()
    } catch {
      setError('Could not create organization. Please try again.')
    }
  }

  return (
    <Modal title="New organization" onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && <Banner variant="error" message={error} onDismiss={() => setError(null)} />}
        <div>
          <label htmlFor="new-org-name" className="mb-1 block text-sm font-medium text-ink-2">
            Organization name
          </label>
          <input
            id="new-org-name"
            autoFocus
            className="form-input-dark w-full"
            placeholder="Acme Inc."
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={150}
          />
        </div>
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-outline-dark w-auto px-4 py-2" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn-primary w-auto px-4 py-2" disabled={createOrganization.isPending || !name.trim()}>
            {createOrganization.isPending ? 'Creating…' : 'Create'}
          </button>
        </div>
      </form>
    </Modal>
  )
}

/**
 * Org identity + switcher, lives in the sidebar footer. The trigger doubles
 * as the "who am I logged in as" display; opening it reveals a proper menu
 * instead of a form crammed into the dropdown.
 */
export const OrgSwitcher: React.FC = () => {
  const { data: orgs } = useOrganizations()
  const switchOrg = useSwitchOrg()
  const { organization, setSession } = useAuthContext()
  const [open, setOpen] = useState(false)
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [switchError, setSwitchError] = useState<string | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [])

  const handleSwitch = async (id: string) => {
    if (id === organization?.id) {
      setOpen(false)
      return
    }
    setSwitchError(null)
    try {
      const res = await switchOrg.mutateAsync(id)
      setSession(res.accessToken, res.organization)
      setOpen(false)
    } catch {
      setSwitchError('Could not switch organization. Please try again.')
    }
  }

  const initials = initialsOf(organization?.name ?? '?')

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        className="flex w-full items-center gap-3 rounded-lg px-1 py-1 text-left transition-colors duration-150 hover:bg-surface-3"
        onClick={() => setOpen((s) => !s)}
      >
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand/20 text-sm font-semibold text-brand">
          {initials}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-ink">{organization?.name ?? '—'}</p>
          <p className="truncate text-xs text-ink-3 capitalize">{organization?.role ?? ''}</p>
        </div>
        <ChevronsUpDown className="h-4 w-4 shrink-0 text-ink-3" />
      </button>

      {open && (
        <div className="card absolute bottom-full left-0 z-20 mb-2 w-72 p-1.5 shadow-2xl shadow-black/40">
          {switchError && (
            <div className="p-1.5">
              <Banner variant="error" message={switchError} onDismiss={() => setSwitchError(null)} />
            </div>
          )}
          <p className="px-2.5 py-1.5 text-xs font-semibold uppercase tracking-wide text-ink-3">Organizations</p>
          <div className="max-h-64 overflow-y-auto">
            {(orgs ?? []).map((o) => (
              <button
                key={o.id}
                className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors duration-150 hover:bg-surface-3"
                onClick={() => handleSwitch(o.id)}
              >
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-surface-4 text-xs font-semibold text-ink-2">
                  {initialsOf(o.name)}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-ink">{o.name}</p>
                  <p className="truncate text-xs text-ink-3 capitalize">{o.role}</p>
                </div>
                {o.id === organization?.id && <Check className="h-4 w-4 shrink-0 text-brand" />}
              </button>
            ))}
          </div>
          <div className="mt-1 border-t border-line pt-1">
            <button
              type="button"
              className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm font-medium text-brand transition-colors duration-150 hover:bg-surface-3"
              onClick={() => {
                setOpen(false)
                setShowCreateModal(true)
              }}
            >
              <Plus className="h-4 w-4" />
              New organization
            </button>
          </div>
        </div>
      )}

      {showCreateModal && <CreateOrganizationModal onClose={() => setShowCreateModal(false)} />}
    </div>
  )
}
