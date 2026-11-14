import React from 'react'
import { BarChart3, RefreshCw, ShieldCheck } from 'lucide-react'
import { Brand } from '../../../shared/components/Brand'

const FEATURES = [
  { icon: RefreshCw, text: 'Real-time sync from HubSpot, Salesforce, and QuickBooks' },
  { icon: BarChart3, text: 'Pipeline, revenue, and contact analytics out of the box' },
  { icon: ShieldCheck, text: 'Tenant-isolated data, built for enterprise security' }
]

/**
 * Split-screen auth layout: a brand panel fills the left side on wide
 * screens so the page reads as a product, not an empty background with a
 * small floating box. Collapses to form-only below lg.
 */
export const AuthCard: React.FC<{ title: string; subtitle?: string; children: React.ReactNode }> = ({
  title,
  subtitle,
  children
}) => (
  <div className="flex min-h-screen bg-surface">
    <div className="oryon-side relative hidden w-[42%] shrink-0 flex-col justify-between overflow-hidden border-r border-line bg-surface p-12 text-ink lg:flex xl:w-[38%]">
      <div
        className="pointer-events-none absolute inset-0"
        style={{ backgroundImage: 'radial-gradient(ellipse 70% 50% at 20% 0%, rgba(221, 179, 90, 0.14), transparent)' }}
      />
      <div className="relative">
        <Brand />
      </div>

      <div className="relative max-w-md">
        <h2 className="font-display text-4xl font-normal leading-tight text-ink">One workspace for every customer signal.</h2>
        <p className="mt-4 text-sm text-ink-2">
          Connect your CRM and finance tools to see contacts, deals, and pipeline health in a single dashboard.
        </p>
        <ul className="mt-10 space-y-4">
          {FEATURES.map(({ icon: Icon, text }) => (
            <li key={text} className="flex items-start gap-3">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand/15 text-brand">
                <Icon className="h-4 w-4" />
              </span>
              <span className="pt-1.5 text-sm text-ink-2">{text}</span>
            </li>
          ))}
        </ul>
      </div>

      <p className="relative text-xs text-ink-3">© {new Date().getFullYear()} Oryon AI</p>
    </div>

    <div className="flex flex-1 flex-col items-center justify-center px-6 py-12 sm:px-12 lg:px-20">
      <div className="w-full max-w-xl">
        <div className="oryon-side mb-10 inline-flex rounded-lg bg-surface px-3 py-2 text-ink lg:hidden">
          <Brand size={20} />
        </div>
        <div className="auth-card">
          <h1 className="auth-title">{title}</h1>
          {subtitle && <p className="auth-subtitle">{subtitle}</p>}
          {children}
        </div>
      </div>
    </div>
  </div>
)
