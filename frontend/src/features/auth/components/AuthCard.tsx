import React from 'react'

export const AuthCard: React.FC<{ title: string; subtitle?: string; children: React.ReactNode }> = ({
  title,
  subtitle,
  children
}) => (
  <div className="auth-shell">
    <div className="w-full max-w-md">
      <div className="flex justify-center mb-6">
        <div className="auth-logo">H</div>
      </div>
      <div className="auth-card">
        <h1 className="auth-title">{title}</h1>
        {subtitle && <p className="auth-subtitle">{subtitle}</p>}
        {children}
      </div>
    </div>
  </div>
)
