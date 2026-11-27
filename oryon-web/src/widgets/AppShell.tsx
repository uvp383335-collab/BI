import React from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { LogOut } from 'lucide-react'
import { useAuthContext } from '../shared/context/AuthContext'
import { OrgSwitcher } from '../features/auth/components/OrgSwitcher'
import { useIntegrationsStatus } from '../features/integrations/hooks/useIntegrations'
import { usePortfolioFlagCounts } from '../features/portfolio/hooks/usePortfolioFlagCounts'
import { Brand } from '../shared/components/Brand'

interface AppShellProps {
  title: string
  subtitle?: string
  headerRight?: React.ReactNode
  /** Replaces the default title header (the portfolio screens render their own filter bar). */
  header?: React.ReactNode
  children: React.ReactNode
}

interface NavItem {
  to: string
  label: string
  /** Key into the portfolio flag counts, for the sidebar badges. */
  countKey?: string
}

const NAV_GROUPS: Array<{ label: string; items: NavItem[] }> = [
  {
    label: 'Portfolio',
    items: [
      { to: '/', label: 'Overview' },
      { to: '/portfolio/VC', label: 'Value creation', countKey: 'VC' },
      { to: '/portfolio/CB', label: 'Capital & balance sheet', countKey: 'CB' },
      { to: '/portfolio/CM', label: 'Customer & market', countKey: 'CM' },
      { to: '/portfolio/alerts', label: 'Alerts', countKey: 'alerts' },
      { to: '/metrics', label: 'All metrics' }
    ]
  },
  {
    label: 'Workspace',
    items: [
      { to: '/analytics', label: 'Analytics' },
      { to: '/connect', label: 'Connect' },
      { to: '/invitations', label: 'Team' },
      { to: '/settings', label: 'Settings' }
    ]
  }
]

const PROVIDER_LABELS: Record<string, string> = { hubspot: 'HubSpot', salesforce: 'Salesforce', quickbooks: 'QuickBooks Online' }

/**
 * Oryon AI shell shared by every authenticated page: the always-dark sidebar
 * (portfolio screens, then the workspace pages carried over from the original
 * app), and a sticky top bar with the page title.
 */
export const AppShell: React.FC<AppShellProps> = ({ title, subtitle, headerRight, header, children }) => {
  const navigate = useNavigate()
  const { clearSession, organization } = useAuthContext()
  const { data: integrations } = useIntegrationsStatus()
  const counts = usePortfolioFlagCounts()
  const connected = Object.entries(integrations ?? {}).filter(([, s]) => s.connected).map(([p]) => PROVIDER_LABELS[p] ?? p)

  const handleLogout = async () => {
    await clearSession()
    navigate('/login')
  }

  const link = (item: NavItem, withCount: boolean) => {
    const c = withCount && item.countKey ? counts[item.countKey] : undefined
    return (
      <NavLink key={item.to} to={item.to} end={item.to === '/'}>
        <span>{item.label}</span>
        {c && c.n > 0 && <span className={`cnt ${c.hot ? 'hot' : ''}`}>{c.n}</span>}
      </NavLink>
    )
  }

  return (
    <div className="app">
      {/* The sidebar itself doesn't scroll (that would clip the org switcher's menu); the nav does. */}
      <aside className="side oryon-side" style={{ overflow: 'visible' }} aria-label="Oryon AI navigation">
        <Brand />
        <div className="co">
          <small>Organization</small>
          <span>{organization?.name ?? '—'}</span>
        </div>
        <div className="flex min-h-0 flex-1 flex-col gap-[22px] overflow-y-auto">
          {NAV_GROUPS.map((group) => (
            <nav className="nav" key={group.label}>
              <small>{group.label}</small>
              {group.items.map((item) => link(item, true))}
            </nav>
          ))}
        </div>
        <div className="sync" aria-label="Connected systems">
          {connected.length ? connected.map((s) => <div key={s}><i />{s}</div>) : <div style={{ color: '#7F8BA0' }}>No data source connected</div>}
        </div>
        {/* Kept outside .sync: Oryon styles every div in there as a flex row. */}
        <div className="-mt-2 flex items-center gap-1 border-t border-line pt-3">
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

      <div className="main">
        <div className="mobile-nav oryon-side">
          <div className="mt">
            <Brand size={20} />
            <em>{organization?.name}</em>
          </div>
          <nav aria-label="Pages">{NAV_GROUPS.flatMap((g) => g.items).map((item) => link(item, false))}</nav>
        </div>
        {header ?? (
          <header className="top">
            <div className="top-row">
              <div>
                <div className="crumb">{organization?.name}</div>
                <h1 className="pt">{title}</h1>
                {subtitle && <p className="mt-1 text-sm text-ink-2">{subtitle}</p>}
              </div>
              {headerRight && <div className="filters">{headerRight}</div>}
            </div>
          </header>
        )}
        <main className="content" id="view">
          {children}
        </main>
      </div>
    </div>
  )
}
