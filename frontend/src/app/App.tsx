import React from 'react'
import { Routes, Route } from 'react-router-dom'
import { AuthProvider } from '../shared/context/AuthContext'
import { ProtectedRoute } from './routes/ProtectedRoute'
import { RootRedirect } from './routes/RootRedirect'
import {
  SignupPage,
  LoginPage,
  VerifyEmailPage,
  ForgotPasswordPage,
  ResetPasswordPage,
  AcceptInvitationPage
} from '../features/auth'
import { ConnectPage } from '../features/auth/pages/ConnectPage'
import { InvitationsPage } from '../features/auth/pages/InvitationsPage'
import { CrmDashboardPage } from '../features/dashboard/pages/CrmDashboardPage'
import { SettingsPage } from '../features/integrations/pages/SettingsPage'

const App: React.FC = () => {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/signup" element={<SignupPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/verify-email" element={<VerifyEmailPage />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route path="/accept-invitation" element={<AcceptInvitationPage />} />
        <Route
          path="/"
          element={
            <ProtectedRoute>
              <RootRedirect />
            </ProtectedRoute>
          }
        />
        <Route
          path="/connect"
          element={
            <ProtectedRoute>
              <ConnectPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/dashboard/:provider"
          element={
            <ProtectedRoute>
              <CrmDashboardPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/invitations"
          element={
            <ProtectedRoute>
              <InvitationsPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/settings"
          element={
            <ProtectedRoute>
              <SettingsPage />
            </ProtectedRoute>
          }
        />
      </Routes>
    </AuthProvider>
  )
}

export default App

