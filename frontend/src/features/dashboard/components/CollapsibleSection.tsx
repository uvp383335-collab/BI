import React, { useState } from 'react'
import { ChevronDown } from 'lucide-react'

interface CollapsibleSectionProps {
  title: string
  description?: string
  defaultOpen?: boolean
  /** Tabs, filters, or badges rendered next to the title, before the collapse toggle. */
  headerContent?: React.ReactNode
  children: React.ReactNode
}

/**
 * A named page section the user can collapse once they've seen it — the
 * progressive-disclosure primitive for the dashboard's analysis sections.
 * Generalized from the Funnels section's original collapse behavior so every
 * section (Revenue & Margins, Unit Economics, Cash, Marketing & Pipeline...)
 * gets the same interaction instead of one bespoke implementation.
 */
export const CollapsibleSection: React.FC<CollapsibleSectionProps> = ({ title, description, defaultOpen = true, headerContent, children }) => {
  const [isOpen, setIsOpen] = useState(defaultOpen)

  return (
    <section className="card p-6 sm:p-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <button type="button" onClick={() => setIsOpen((open) => !open)} className="flex-1 rounded-lg text-left" aria-expanded={isOpen}>
          <h2 className="text-xl font-semibold text-ink sm:text-2xl">{title}</h2>
          {description && <p className="mt-1 text-sm text-ink-2">{description}</p>}
        </button>

        <div className="flex flex-wrap items-center gap-3">
          {headerContent}
          <button
            type="button"
            onClick={() => setIsOpen((open) => !open)}
            aria-label={isOpen ? `Collapse ${title}` : `Expand ${title}`}
            aria-expanded={isOpen}
            className="shrink-0 rounded-full p-2 text-ink-2 transition-colors duration-150 hover:bg-surface-3 hover:text-ink"
          >
            <ChevronDown className={`h-5 w-5 transition-transform duration-300 ease-in-out ${isOpen ? '' : '-rotate-90'}`} />
          </button>
        </div>
      </div>

      <div className={`grid transition-[grid-template-rows] duration-300 ease-in-out ${isOpen ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}>
        <div className="overflow-hidden">
          <div className={`pt-6 transition-opacity duration-300 sm:pt-8 ${isOpen ? 'opacity-100 delay-100' : 'opacity-0'}`}>{children}</div>
        </div>
      </div>
    </section>
  )
}
