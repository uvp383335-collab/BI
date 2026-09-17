import React from 'react'

type Accent = 'brand' | 'success' | 'warning' | 'violet' | 'teal' | 'danger'

interface StatsCardProps {
  title: string
  value: number
  valueSuffix?: string
  description: string
  icon: React.ReactNode
  accent?: Accent
}

const ACCENT_BORDER: Record<Accent, string> = {
  brand: 'border-t-brand',
  success: 'border-t-success',
  warning: 'border-t-warning',
  violet: 'border-t-violet',
  teal: 'border-t-teal',
  danger: 'border-t-danger'
}

const ACCENT_ICON: Record<Accent, string> = {
  brand: 'text-brand',
  success: 'text-success',
  warning: 'text-warning',
  violet: 'text-violet',
  teal: 'text-teal',
  danger: 'text-danger'
}

export const StatsCard: React.FC<StatsCardProps> = ({ title, value, valueSuffix, description, icon, accent = 'brand' }) => (
  <div className={`card border-t-2 p-5 ${ACCENT_BORDER[accent]}`}>
    <div className="flex items-center justify-between">
      <p className="text-xs font-semibold uppercase tracking-wide text-ink-3">{title}</p>
      <div className={ACCENT_ICON[accent]}>{icon}</div>
    </div>
    <p className="mt-3 text-2xl font-semibold text-ink">
      {value.toLocaleString()}
      {valueSuffix}
    </p>
    <p className="mt-1 text-xs text-ink-3">{description}</p>
  </div>
)
