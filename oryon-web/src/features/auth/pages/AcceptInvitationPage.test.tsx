import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect } from 'vitest'
import { AcceptInvitationPage } from './AcceptInvitationPage'
import { renderWithProviders } from '../../../test/renderWithProviders'

describe('AcceptInvitationPage', () => {
  it('shows a set-password form for a new user invitation', async () => {
    renderWithProviders(<AcceptInvitationPage />, ['/accept-invitation?token=new-user-invite'])

    expect(await screen.findByText(/join acme inc/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/your name/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/set a password/i)).toBeInTheDocument()
  })

  it('shows a confirm-password form for an existing user invitation', async () => {
    renderWithProviders(<AcceptInvitationPage />, ['/accept-invitation?token=existing-user-invite'])

    expect(await screen.findByText(/join acme inc/i)).toBeInTheDocument()
    expect(screen.queryByLabelText(/your name/i)).not.toBeInTheDocument()
    expect(screen.getByLabelText(/current password/i)).toBeInTheDocument()
  })

  it('accepts the invitation for a new user', async () => {
    const user = userEvent.setup()
    renderWithProviders(<AcceptInvitationPage />, ['/accept-invitation?token=new-user-invite'])

    await screen.findByText(/join acme inc/i)
    await user.type(screen.getByLabelText(/your name/i), 'New Member')
    await user.type(screen.getByLabelText(/set a password/i), 'NewMemberPass123')
    await user.click(screen.getByRole('button', { name: /accept invitation/i }))

    expect(await screen.findByText(/invitation accepted/i)).toBeInTheDocument()
  })

  it('refreshes cached organizations after an existing user accepts an invitation', async () => {
    const user = userEvent.setup()
    const { queryClient } = renderWithProviders(<AcceptInvitationPage />, ['/accept-invitation?token=existing-user-invite'])
    queryClient.setQueryData(['organizations'], [{ id: 'org1', name: 'Existing Org', slug: 'existing-org', role: 'owner' }])

    await screen.findByText(/join acme inc/i)
    await user.type(screen.getByLabelText(/current password/i), 'CorrectPass123')
    await user.click(screen.getByRole('button', { name: /accept invitation/i }))

    await waitFor(() => {
      expect(queryClient.getQueryState(['organizations'])?.isInvalidated).toBe(true)
    })
  })

  it('rejects an incorrect password for an existing user', async () => {
    const user = userEvent.setup()
    renderWithProviders(<AcceptInvitationPage />, ['/accept-invitation?token=existing-user-invite'])

    await screen.findByText(/join acme inc/i)
    await user.type(screen.getByLabelText(/current password/i), 'WrongPassword1')
    await user.click(screen.getByRole('button', { name: /accept invitation/i }))

    expect(await screen.findByText(/incorrect password/i)).toBeInTheDocument()
  })

  it('shows an error for an invalid invitation link', async () => {
    renderWithProviders(<AcceptInvitationPage />, ['/accept-invitation?token=bad-invite'])
    expect(await screen.findByText(/invalid or has expired/i)).toBeInTheDocument()
  })
})
