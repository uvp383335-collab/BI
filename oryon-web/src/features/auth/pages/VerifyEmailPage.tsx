import React, { useEffect, useState } from 'react'
import { useSearchParams, Link } from 'react-router-dom'
import { AuthCard } from '../components/AuthCard'
import { useVerifyEmail } from '../hooks/useAuthMutations'

export const VerifyEmailPage: React.FC = () => {
  const [searchParams] = useSearchParams()
  const verifyEmail = useVerifyEmail()
  const [status, setStatus] = useState<'pending' | 'success' | 'error'>('pending')
  const token = searchParams.get('token')

  useEffect(() => {
    if (!token) {
      setStatus('error')
      return
    }
    verifyEmail.mutate(token, {
      onSuccess: () => setStatus('success'),
      onError: () => setStatus('error')
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token])

  return (
    <AuthCard title="Email verification">
      {status === 'pending' && (
        <div className="flex flex-col items-center gap-3 py-2">
          <span className="h-6 w-6 rounded-full border-2 border-surface-4 border-t-brand animate-spin" />
          <p className="text-sm text-ink-2">Verifying your email…</p>
        </div>
      )}
      {status === 'success' && (
        <div>
          <p className="text-sm text-success mb-4">Your email has been verified successfully.</p>
          <Link to="/login" className="auth-link text-sm">
            Continue to log in
          </Link>
        </div>
      )}
      {status === 'error' && (
        <div>
          <p className="text-sm text-danger mb-4">This verification link is invalid or has expired.</p>
          <Link to="/login" className="auth-link text-sm">
            Back to log in
          </Link>
        </div>
      )}
    </AuthCard>
  )
}
