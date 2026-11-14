import React from 'react'
import { screen, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, it, expect } from 'vitest'
import { AppShell } from './AppShell'
import { renderWithProviders } from '../test/renderWithProviders'
import { server } from '../test/mswServer'

const BASE = 'http://localhost:4000/api/v1'

describe('AppShell', () => {
  it('shows portfolio and workspace navigation with the latest-quarter flag counts', async () => {
    server.use(
      http.post(`${BASE}/auth/refresh`, () =>
        HttpResponse.json({ success: true, data: { accessToken: 't', organization: { id: 'org1', name: 'Acme', slug: 'acme', role: 'owner' } } })
      ),
      http.get(`${BASE}/integrations/status`, () =>
        HttpResponse.json({ success: true, data: { hubspot: { connected: true }, salesforce: { connected: false }, quickbooks: { connected: true } } })
      ),
      http.get(`${BASE}/dashboard/alerts`, () =>
        HttpResponse.json({
          success: true,
          data: {
            quarters: ['2026-Q3'],
            alerts: [
              { id: 'VC-10', period: '2026-Q3', flag: 'Act now', why: 'Margin fell' },
              { id: 'VC-04', period: '2026-Q3', flag: 'Watch', why: 'COGS rose' },
              { id: 'CM-08', period: '2026-Q3', flag: 'Watch', why: 'MQLs down' }
            ]
          }
        })
      )
    )

    renderWithProviders(
      <AppShell title="Settings">
        <p>body</p>
      </AppShell>,
      ['/settings']
    )

    expect(await screen.findByText('QuickBooks Online')).toBeInTheDocument()
    const sidebar = screen.getByRole('complementary', { name: /oryon ai navigation/i })
    for (const label of ['Overview', 'Value creation', 'Customer & market', 'Alerts', 'Analytics', 'Connect', 'Team', 'Settings']) {
      expect(within(sidebar).getByRole('link', { name: new RegExp(`^${label}`) })).toBeInTheDocument()
    }
    const vc = await within(sidebar).findByRole('link', { name: /value creation\s*2/i })
    expect(vc.querySelector('.cnt.hot')).not.toBeNull()
    expect(within(sidebar).getByRole('link', { name: /^alerts/i })).toHaveTextContent('3')
    expect(screen.getByRole('heading', { name: 'Settings' })).toBeInTheDocument()
  })
})
