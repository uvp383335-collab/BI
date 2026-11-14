import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect } from 'vitest'
import { SignupPage } from './SignupPage'
import { renderWithProviders } from '../../../test/renderWithProviders'

describe('SignupPage', () => {
  it('submits valid signup details successfully', async () => {
    const user = userEvent.setup()
    renderWithProviders(<SignupPage />, ['/signup'])

    await user.type(screen.getByLabelText(/full name/i), 'Alice Smith')
    await user.type(screen.getByLabelText(/organization name/i), 'Acme Inc')
    await user.type(screen.getByLabelText(/^email$/i), 'alice@example.com')
    await user.type(screen.getByLabelText(/^password$/i), 'Password123')
    await user.click(screen.getByRole('button', { name: /sign up/i }))

    await waitFor(() => {
      expect(screen.queryByText(/organization name is required/i)).not.toBeInTheDocument()
    })
  })

  it('shows validation errors for invalid input', async () => {
    const user = userEvent.setup()
    renderWithProviders(<SignupPage />, ['/signup'])

    await user.type(screen.getByLabelText(/^email$/i), 'not-an-email')
    await user.type(screen.getByLabelText(/^password$/i), 'short')
    await user.click(screen.getByRole('button', { name: /sign up/i }))

    expect(await screen.findByText(/invalid email address/i)).toBeInTheDocument()
    expect(await screen.findByText(/at least 8 characters/i)).toBeInTheDocument()
  })
})
