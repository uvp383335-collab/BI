import React from 'react'
import { Navigate } from 'react-router-dom'
import { useAuthContext } from '../../shared/context/AuthContext'

export const ProtectedRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { isAuthenticated, isBootstrapping } = useAuthContext()

  if (isBootstrapping) {
    return <div className="p-6 text-center text-gray-500">Loading…</div>
  }
  if (!isAuthenticated) {
    return <Navigate to="/login" replace />
  }
  return <>{children}</>
}
