import React from 'react'
import { CheckCircle2, AlertTriangle, XCircle, Info, X } from 'lucide-react'

export type BannerVariant = 'success' | 'error' | 'warning' | 'info'

export interface BannerAction {
  label: string
  onClick: () => void
}

interface BannerProps {
  variant: BannerVariant
  /** Optional short headline. When set, `message` renders underneath as supporting detail
   *  instead of being the only line — use for anything longer than a single short sentence. */
  title?: string
  message: string
  action?: BannerAction
  onDismiss?: () => void
  className?: string
}

const VARIANT_STYLES: Record<
  BannerVariant,
  { bg: string; border: string; iconWrap: string; action: string; icon: React.ReactNode }
> = {
  success: {
    bg: 'bg-success/10',
    border: 'border-success/25',
    iconWrap: 'bg-success/15 text-success',
    action: 'text-success',
    icon: <CheckCircle2 className="h-4 w-4" />
  },
  error: {
    bg: 'bg-danger/10',
    border: 'border-danger/25',
    iconWrap: 'bg-danger/15 text-danger',
    action: 'text-danger',
    icon: <XCircle className="h-4 w-4" />
  },
  warning: {
    bg: 'bg-warning/10',
    border: 'border-warning/25',
    iconWrap: 'bg-warning/15 text-warning',
    action: 'text-warning',
    icon: <AlertTriangle className="h-4 w-4" />
  },
  info: {
    bg: 'bg-brand/10',
    border: 'border-brand/25',
    iconWrap: 'bg-brand/15 text-brand',
    action: 'text-brand',
    icon: <Info className="h-4 w-4" />
  }
}

/**
 * Inline, in-flow feedback — replaces toast popups everywhere in the app (see
 * project decision: no toast library, ever). Renders where the triggering
 * action lives (above a form, at the top of a page's content) instead of
 * floating over the UI, and stays until the user dismisses it or takes the
 * next action. Tinted background + icon chip + a brief entrance animation
 * make it read as a deliberate alert rather than a plain paragraph, without
 * resorting to a corner popup.
 */
export const Banner: React.FC<BannerProps> = ({ variant, title, message, action, onDismiss, className = '' }) => {
  const styles = VARIANT_STYLES[variant]
  return (
    <div
      role="alert"
      className={`animate-fade-in flex items-start gap-3 rounded-xl border ${styles.border} ${styles.bg} p-4 shadow-sm ${className}`}
    >
      <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${styles.iconWrap}`}>
        {styles.icon}
      </span>
      <div className="min-w-0 flex-1 pt-0.5">
        {title && <p className="text-sm font-semibold text-ink">{title}</p>}
        <p className={`text-sm ${title ? 'mt-0.5 text-ink-2' : 'text-ink'}`}>{message}</p>
        {action && (
          <button
            type="button"
            className={`mt-2 inline-flex items-center gap-1 text-sm font-semibold hover:underline ${styles.action}`}
            onClick={action.onClick}
          >
            {action.label}
            <span aria-hidden="true">&rarr;</span>
          </button>
        )}
      </div>
      {onDismiss && (
        <button
          type="button"
          aria-label="Dismiss"
          className="shrink-0 rounded-md p-1 text-ink-3 transition-colors duration-150 hover:bg-surface-3 hover:text-ink"
          onClick={onDismiss}
        >
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  )
}
