import React, { useState } from 'react'
import { useOrganizations } from '../hooks/useOrganizations'
import { useSwitchOrg } from '../hooks/useAuthMutations'
import { useAuthContext } from '../../../shared/context/AuthContext'

export const OrgSwitcher: React.FC = () => {
  const { data: orgs, isLoading } = useOrganizations()
  const switchOrg = useSwitchOrg()
  const { organization, setSession } = useAuthContext()
  const [open, setOpen] = useState(false)

  const handleSwitch = async (id: string) => {
    try {
      const res = await switchOrg.mutateAsync(id)
      setSession(res.accessToken, res.organization)
      setOpen(false)
    } catch (err) {
      // ignore — callers will show toast elsewhere
      console.error('Could not switch org', err)
    }
  }

  if (isLoading) return null
  if (!orgs || orgs.length <= 1) return null

  return (
    <div className="relative inline-block text-left">
      <button className="btn-outline" onClick={() => setOpen((s) => !s)}>
        {organization?.name ?? 'Switch organization'}
      </button>
      {open && (
        <div className="absolute right-0 mt-2 w-56 rounded-md bg-white shadow-lg ring-1 ring-black ring-opacity-5">
          <div className="py-1">
            {orgs.map((o) => (
              <button
                key={o.id}
                className={`block w-full text-left px-4 py-2 text-sm ${o.id === organization?.id ? 'font-semibold' : ''}`}
                onClick={() => handleSwitch(o.id)}
              >
                <div className="text-sm text-gray-900">{o.name}</div>
                <div className="text-xs text-gray-500">{o.role}</div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
