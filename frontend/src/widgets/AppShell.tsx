import React from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { LayoutGrid, Link2, Users, Settings, LogOut } from 'lucide-react'
import { useAuthContext } from '../shared/context/AuthContext'
import { OrgSwitcher } from '../features/auth/components/OrgSwitcher'

interface AppShellProps {
  title: string
  subtitle?: string
  headerRight?: React.ReactNode
  children: React.ReactNode
}

const NAV_ITEMS = [
  { to: '/', label: 'Dashboard', icon: LayoutGrid, match: (path: string) => path === '/' || path.startsWith('/dashboard') },
  { to: '/connect', label: 'Connect', icon: Link2, match: (path: string) => path === '/connect' },
  { to: '/invitations', label: 'Team', icon: Users, match: (path: string) => path === '/invitations' },
  { to: '/settings', label: 'Settings', icon: Settings, match: (path: string) => path === '/settings' }
]

/**
 * Dark sidebar + header shell shared by every authenticated page (dashboard,
 * connect, invitations), matched to the approved reference dashboard's
 * layout: fixed sidebar with grouped nav + org/role footer, content area with
 * a page title/subtitle header.
 */
export const AppShell: React.FC<AppShellProps> = ({ title, subtitle, headerRight, children }) => {
  const navigate = useNavigate()
  const location = useLocation()
  const { clearSession } = useAuthContext()

  const handleLogout = async () => {
    await clearSession()
    navigate('/login')
  }

  return (
    <div className="app-shell flex">
      <aside className="flex w-[220px] shrink-0 flex-col border-r border-line bg-surface-2 px-4 py-6">
        <div className="flex items-center gap-2 px-2">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand text-sm font-bold text-white">
            V
          </div>
          <p className="text-base font-semibold text-ink">Vantage</p>
        </div>

        <nav className="mt-8 flex flex-1 flex-col gap-1 overflow-y-auto">
          {NAV_ITEMS.map((item) => {
            const isActive = item.match(location.pathname)
            const Icon = item.icon
            return (
              <button
                key={item.to}
                type="button"
                className={`sidebar-link text-left ${isActive ? 'sidebar-link-active' : ''}`}
                onClick={() => navigate(item.to)}
              >
                <Icon className="h-4 w-4" />
                {item.label}
              </button>
            )
          })}
        </nav>

        <div className="flex shrink-0 items-center gap-1 border-t border-line pt-4">
          <div className="min-w-0 flex-1">
            <OrgSwitcher />
          </div>
          <button
            type="button"
            aria-label="Log out"
            className="shrink-0 rounded-lg p-2 text-ink-3 transition-colors hover:bg-surface-3 hover:text-ink"
            onClick={handleLogout}
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex shrink-0 items-center justify-between border-b border-line px-8 py-5">
          <div>
            <h1 className="text-xl font-semibold text-ink">{title}</h1>
            {subtitle && <p className="mt-1 text-sm text-ink-2">{subtitle}</p>}
          </div>
          {headerRight && <div className="flex items-center gap-3">{headerRight}</div>}
        </header>

        <main className="flex-1 space-y-6 overflow-y-auto px-8 py-8">{children}</main>
      </div>
    </div>
  )
}
