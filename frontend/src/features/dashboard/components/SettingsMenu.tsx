import React, { useEffect, useRef, useState } from 'react'
import { Settings, RefreshCw } from 'lucide-react'

interface SettingsMenuProps {
  onSyncNow: () => void
  isSyncing: boolean
}

/**
 * Gear-icon dropdown on the dashboard header. Currently exposes a single
 * "Sync now" action that kicks off a full resync of contacts + deals.
 */
export const SettingsMenu: React.FC<SettingsMenuProps> = ({ onSyncNow, isSyncing }) => {
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const handleSyncNow = () => {
    onSyncNow()
    setOpen(false)
  }

  return (
    <div className="relative inline-block text-left" ref={containerRef}>
      <button
        type="button"
        aria-label="Settings"
        className="btn-outline inline-flex items-center justify-center p-2"
        onClick={() => setOpen((s) => !s)}
      >
        <Settings className="h-4 w-4" />
      </button>
      {open && (
        <div className="absolute right-0 z-10 mt-2 w-48 rounded-md bg-white shadow-lg ring-1 ring-black ring-opacity-5">
          <div className="py-1">
            <button
              type="button"
              className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
              onClick={handleSyncNow}
              disabled={isSyncing}
            >
              <RefreshCw className={`h-4 w-4 ${isSyncing ? 'animate-spin' : ''}`} />
              {isSyncing ? 'Syncing…' : 'Sync now'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
