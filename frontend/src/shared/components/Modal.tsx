import React, { useEffect } from 'react'
import { X } from 'lucide-react'

interface ModalProps {
  title: string
  onClose: () => void
  children: React.ReactNode
  /** 'md' (default) fits confirmation/form dialogs; 'xl' is for wider content like a record detail view. */
  size?: 'md' | 'xl'
}

const SIZE_CLASSES: Record<NonNullable<ModalProps['size']>, string> = {
  md: 'max-w-md',
  xl: 'max-w-4xl'
}

export const Modal: React.FC<ModalProps> = ({ title, onClose, children, size = 'md' }) => {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        className={`card w-full ${SIZE_CLASSES[size]} max-h-[85vh] overflow-y-auto p-6 shadow-2xl shadow-black/40 animate-fade-in`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-ink">{title}</h2>
          <button type="button" aria-label="Close" className="text-ink-3 hover:text-ink" onClick={onClose}>
            <X className="h-5 w-5" />
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}
