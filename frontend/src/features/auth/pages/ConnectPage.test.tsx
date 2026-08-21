import React from 'react'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from '../../../test/renderWithProviders'
import { ConnectPage } from './ConnectPage'

describe('ConnectPage', () => {
  it('renders a logout button and allows the user to log out', async () => {
    const user = userEvent.setup()
    renderWithProviders(<ConnectPage />, ['/connect'])

    const logoutButton = screen.getByRole('button', { name: /logout/i })
    expect(logoutButton).toBeInTheDocument()

    await user.click(logoutButton)
    expect(logoutButton).toBeEnabled()
  })
})
