import React from 'react'
import { Navigate } from 'react-router-dom'
import { useAuthContext } from '../../shared/context/AuthContext'

export const ProtectedRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { isAuthenticated, isBootstrapping } = useAuthContext()

  if (isBootstrapping) {
    return <div className="min-h-screen bg-surface p-6 text-center text-ink-3">Loading…</div>
  }
  if (!isAuthenticated) {
    return <Navigate to="/login" replace />
  }
  return <>{children}</>
}
