import { describe, it, expect } from 'vitest'
import { sourceRow, phaseOf, overallProgress, formatElapsed } from './syncPlan'

const iso = (ms: number) => new Date(ms).toISOString()
const job = (status: string, at: number, extra: Record<string, unknown> = {}) =>
  ({
    _id: 'j', orgId: 'o', provider: 'hubspot', status, progress: 40, currentStep: 'Syncing contacts (10)',
    createdAt: iso(at), updatedAt: iso(at), completedAt: status === 'completed' ? iso(at) : undefined,
    entities: { contacts: { status: 'syncing', synced: 10, total: 100 }, deals: { status: 'pending', synced: 0, total: 0 } },
    ...extra
  }) as never

describe('first-sync plan', () => {
  const since = 1_000_000

  it('a running job is syncing, with its step and counts', () => {
    const r = sourceRow('hubspot', job('running', since + 5), since)
    expect(r.state).toBe('syncing')
    expect(r.step).toBe('Syncing contacts (10)')
    expect(r.entities.map((e) => e.label)).toEqual(['Contacts', 'Deals'])
  })

  it('a job finished before the user connected does not count as this sync', () => {
    expect(sourceRow('hubspot', job('completed', since - 60_000), since).state).toBe('waiting')
    expect(sourceRow('hubspot', job('completed', since + 1), since).state).toBe('done')
  })

  it('a finished source hides records it never synced', () => {
    const r = sourceRow('hubspot', job('completed', since + 1, { entities: { contacts: { status: 'completed', synced: 100, total: 100 } } }), since)
    expect(r.entities.map((e) => e.key)).toEqual(['contacts'])
  })

  it('names Salesforce records the way Salesforce users know them', () => {
    expect(sourceRow('salesforce', null, since).entities.map((e) => e.label)).toEqual(['Accounts', 'Leads', 'Opportunities'])
  })

  it('phase: failure wins, then syncing, and a sync that never starts stops holding the screen', () => {
    const syncing = sourceRow('hubspot', job('running', since + 1), since)
    const failed = sourceRow('quickbooks', job('failed', since + 1), since)
    const waiting = sourceRow('hubspot', null, since)
    const done = sourceRow('hubspot', job('completed', since + 1), since)
    expect(phaseOf([syncing, failed], 0)).toBe('failed')
    expect(phaseOf([syncing, done], 0)).toBe('syncing')
    expect(phaseOf([waiting], 5_000)).toBe('syncing')
    expect(phaseOf([waiting], 31_000)).toBe('preparing')
    expect(phaseOf([done], 0)).toBe('preparing')
  })

  it('overall progress: copying is the first 85%, building the dashboard the rest', () => {
    const done = sourceRow('hubspot', job('completed', since + 1), since)
    expect(overallProgress([done], 'preparing', 0)).toBe(85)
    expect(overallProgress([done], 'ready')).toBe(100)
    expect(overallProgress([sourceRow('hubspot', job('running', since + 1), since)], 'syncing')).toBe(34)
    expect(formatElapsed(84_000)).toBe('1:24')
  })
})
