import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { describe, it, expect } from 'vitest'
import { LoginPage } from './LoginPage'
import { renderWithProviders } from '../../../test/renderWithProviders'
import { server } from '../../../test/mswServer'

describe('LoginPage', () => {
  it('redirects to home when a session already exists', async () => {
    server.use(
      http.post('http://localhost:4000/api/v1/auth/refresh', () => {
        return HttpResponse.json({
          success: true,
          data: {
            accessToken: 'existing-access-token',
            organization: { id: 'org1', name: 'Existing Org', slug: 'existing-org', role: 'owner' }
          }
        })
      })
    )

    renderWithProviders(<LoginPage />, ['/login'])

    expect(await screen.findByTestId('home-page')).toBeInTheDocument()
  })

  it('logs in directly when the user has a single organization', async () => {
    const user = userEvent.setup()
    renderWithProviders(<LoginPage />, ['/login'])

    await user.type(screen.getByLabelText(/email/i), 'solo@example.com')
    await user.type(screen.getByLabelText(/password/i), 'Password123')
    await user.click(screen.getByRole('button', { name: /log in/i }))

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /log in/i })).not.toBeInTheDocument()
    })
  })

  it('shows an organization picker when the user belongs to multiple organizations', async () => {
    const user = userEvent.setup()
    renderWithProviders(<LoginPage />, ['/login'])

    await user.type(screen.getByLabelText(/email/i), 'multi@example.com')
    await user.type(screen.getByLabelText(/password/i), 'Password123')
    await user.click(screen.getByRole('button', { name: /log in/i }))

    expect(await screen.findByText(/choose an organization/i)).toBeInTheDocument()
    expect(screen.getByText('Org One')).toBeInTheDocument()
    expect(screen.getByText('Org Two')).toBeInTheDocument()

    await user.click(screen.getByText('Org One'))
    await waitFor(() => {
      expect(screen.queryByText(/choose an organization/i)).not.toBeInTheDocument()
    })
  })

  it('shows an error for invalid credentials', async () => {
    const user = userEvent.setup()
    renderWithProviders(<LoginPage />, ['/login'])

    await user.type(screen.getByLabelText(/email/i), 'wrong@example.com')
    await user.type(screen.getByLabelText(/password/i), 'WrongPass123')
    await user.click(screen.getByRole('button', { name: /log in/i }))

    expect(await screen.findByText(/invalid email or password/i)).toBeInTheDocument()
  })
})
