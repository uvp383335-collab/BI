import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect } from 'vitest'
import { ForgotPasswordPage } from './ForgotPasswordPage'
import { renderWithProviders } from '../../../test/renderWithProviders'

describe('ForgotPasswordPage', () => {
  it('submits a valid email successfully', async () => {
    const user = userEvent.setup()
    renderWithProviders(<ForgotPasswordPage />, ['/forgot-password'])

    await user.type(screen.getByLabelText(/email/i), 'fiona@example.com')
    await user.click(screen.getByRole('button', { name: /send reset link/i }))

    expect(await screen.findByText(/reset link has been sent/i)).toBeInTheDocument()
  })

  it('validates the email field', async () => {
    const user = userEvent.setup()
    renderWithProviders(<ForgotPasswordPage />, ['/forgot-password'])

    await user.type(screen.getByLabelText(/email/i), 'not-an-email')
    await user.click(screen.getByRole('button', { name: /send reset link/i }))

    expect(await screen.findByText(/invalid email address/i)).toBeInTheDocument()
  })
})
