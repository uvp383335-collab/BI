import React from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import { SyncLoaderScreen } from './SyncLoaderScreen'
import { sourceRow } from '../syncPlan'

const running = sourceRow(
  'hubspot',
  {
    _id: 'j', orgId: 'o', provider: 'hubspot', status: 'running', progress: 40, currentStep: 'Syncing contacts (18,400)',
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    entities: { contacts: { status: 'syncing', synced: 18400, total: 43076 }, deals: { status: 'pending', synced: 0, total: 0 } }
  } as never,
  0
)

describe('SyncLoaderScreen', () => {
  it('shows what is syncing, how far along and for how long, with no navigation', () => {
    render(<SyncLoaderScreen phase="syncing" sources={[running]} progress={34} elapsedMs={84_000} canContinue={false} onRetry={() => {}} onContinue={() => {}} />)
    expect(screen.getByRole('heading', { name: 'Bringing in your HubSpot data' })).toBeInTheDocument()
    expect(screen.getByText('18,400 of 43,076')).toBeInTheDocument()
    expect(screen.getByText('Waiting')).toBeInTheDocument()
    expect(screen.getByText(/Elapsed 1:24/)).toBeInTheDocument()
    expect(screen.queryByRole('navigation')).toBeNull()
    expect(screen.queryByRole('button', { name: /continue while it syncs/i })).toBeNull()
  })

  it('offers to continue once the sync has run a while', async () => {
    const onContinue = vi.fn()
    render(<SyncLoaderScreen phase="syncing" sources={[running]} progress={34} elapsedMs={90_000} canContinue onRetry={() => {}} onContinue={onContinue} />)
    await userEvent.click(screen.getByRole('button', { name: /continue while it syncs/i }))
    expect(onContinue).toHaveBeenCalled()
  })

  it('on failure explains it and offers to retry or continue', async () => {
    const failed = { ...running, state: 'failed' as const, error: 'HubSpot rate limit reached.' }
    const onRetry = vi.fn()
    render(<SyncLoaderScreen phase="failed" sources={[failed]} progress={30} elapsedMs={1000} canContinue={false} onRetry={onRetry} onContinue={() => {}} />)
    expect(screen.getByRole('heading', { name: 'The HubSpot sync didn’t finish' })).toBeInTheDocument()
    expect(screen.getByText('HubSpot rate limit reached.')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(onRetry).toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Continue to Oryon' })).toBeInTheDocument()
  })
})
