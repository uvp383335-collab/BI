import React from 'react'
import { render } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Toaster } from 'sonner'
import { AuthProvider } from '../shared/context/AuthContext'

// Renders the given page at "/login" (or the last provided initial entry) with a
// stand-in "/" route, so that components which call navigate('/') on success
// actually unmount instead of leaving stale state behind in the test DOM.
export function renderWithProviders(ui: React.ReactElement, initialEntries: string[] = ['/']) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  const fullPath = initialEntries[initialEntries.length - 1]
  const pathname = fullPath.split('?')[0]
  return {
    ...render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={initialEntries}>
          <AuthProvider>
            <Toaster />
            <Routes>
              <Route path="/" element={<div data-testid="home-page">Home</div>} />
              {pathname !== '/' && <Route path={pathname} element={ui} />}
            </Routes>
          </AuthProvider>
        </MemoryRouter>
      </QueryClientProvider>
    ),
    queryClient
  }
}
