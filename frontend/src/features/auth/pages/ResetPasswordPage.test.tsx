import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect } from 'vitest'
import { ResetPasswordPage } from './ResetPasswordPage'
import { renderWithProviders } from '../../../test/renderWithProviders'

describe('ResetPasswordPage', () => {
  it('resets password successfully with a valid token', async () => {
    const user = userEvent.setup()
    renderWithProviders(<ResetPasswordPage />, ['/reset-password?token=good-token'])

    await user.type(screen.getByLabelText(/new password/i), 'BrandNewPass123')
    await user.type(screen.getByLabelText(/confirm password/i), 'BrandNewPass123')
    await user.click(screen.getByRole('button', { name: /reset password/i }))

    expect(await screen.findByText(/reset successfully/i)).toBeInTheDocument()
  })

  it('shows a validation error when passwords do not match', async () => {
    const user = userEvent.setup()
    renderWithProviders(<ResetPasswordPage />, ['/reset-password?token=good-token'])

    await user.type(screen.getByLabelText(/new password/i), 'BrandNewPass123')
    await user.type(screen.getByLabelText(/confirm password/i), 'Different123')
    await user.click(screen.getByRole('button', { name: /reset password/i }))

    expect(await screen.findByText(/passwords do not match/i)).toBeInTheDocument()
  })

  it('shows an error when the reset token is invalid', async () => {
    const user = userEvent.setup()
    renderWithProviders(<ResetPasswordPage />, ['/reset-password?token=bad-token'])

    await user.type(screen.getByLabelText(/new password/i), 'BrandNewPass123')
    await user.type(screen.getByLabelText(/confirm password/i), 'BrandNewPass123')
    await user.click(screen.getByRole('button', { name: /reset password/i }))

    expect(await screen.findByText(/invalid or expired token/i)).toBeInTheDocument()
  })

  it('shows a message when no token is present in the URL', () => {
    renderWithProviders(<ResetPasswordPage />, ['/reset-password'])
    expect(screen.getByText(/missing reset token/i)).toBeInTheDocument()
  })
})
