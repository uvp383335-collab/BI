import { screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { VerifyEmailPage } from './VerifyEmailPage'
import { renderWithProviders } from '../../../test/renderWithProviders'

describe('VerifyEmailPage', () => {
  it('shows success message for a valid token', async () => {
    renderWithProviders(<VerifyEmailPage />, ['/verify-email?token=good-token'])
    expect(await screen.findByText(/verified successfully/i)).toBeInTheDocument()
  })

  it('shows an error message for an invalid token', async () => {
    renderWithProviders(<VerifyEmailPage />, ['/verify-email?token=bad-token'])
    expect(await screen.findByText(/invalid or has expired/i)).toBeInTheDocument()
  })

  it('shows an error when no token is present', async () => {
    renderWithProviders(<VerifyEmailPage />, ['/verify-email'])
    expect(await screen.findByText(/invalid or has expired/i)).toBeInTheDocument()
  })
})
