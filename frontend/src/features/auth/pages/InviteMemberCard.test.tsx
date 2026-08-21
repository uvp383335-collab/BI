import React from 'react'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from '../../../test/renderWithProviders'
import { InviteMemberCard } from '../components/InviteMemberCard'

describe('InviteMemberCard', () => {
  it('renders invite form and sends invitation successfully', async () => {
    const user = userEvent.setup()
    renderWithProviders(<InviteMemberCard organizationRole="owner" />, ['/invite'])

    expect(screen.getByRole('heading', { name: /invite someone to your organization/i })).toBeInTheDocument()

    await user.type(screen.getByLabelText(/email address/i), 'newmember@example.com')
    await user.selectOptions(screen.getByLabelText(/role/i), 'member')

    await user.click(screen.getByRole('button', { name: /send invitation/i }))

    expect(await screen.findByText(/invitation sent successfully/i)).toBeInTheDocument()
  })

  it('shows a permission message when role is not owner or admin', () => {
    renderWithProviders(<InviteMemberCard organizationRole="member" />, ['/invite'])

    expect(screen.getByText(/only organization owners and admins can invite new members/i)).toBeInTheDocument()
  })
})
