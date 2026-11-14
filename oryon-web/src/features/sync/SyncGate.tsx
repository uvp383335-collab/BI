import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQueries, useQueryClient } from '@tanstack/react-query'
import { useLocation } from 'react-router-dom'
import { useIntegrationsStatus } from '../integrations/hooks/useIntegrations'
import { IntegrationProvider } from '../integrations/api/integrationsApi'
import { getSyncStatusRequest, startSyncRequest } from '../dashboard/api/syncApi'
import { portfolioApi } from '../portfolio/api/portfolioApi'
import { SyncLoaderScreen } from './components/SyncLoaderScreen'
import { Phase, overallProgress, phaseOf, sourceRow } from './syncPlan'

/**
 * Takes over the whole screen while a newly connected source runs its first sync, then builds the
 * portfolio dashboard so the first page the user sees is already computed.
 *
 * It engages when the user returns from connecting a source (the OAuth callback lands on
 * `?status=success`) or when a connected source has never finished a sync. A manual "Sync now"
 * on an already-synced source doesn't trigger it; that keeps its in-page progress banner.
 */

const FLAG_KEY = 'oryon:first-sync-since'
const PROVIDERS: IntegrationProvider[] = ['hubspot', 'salesforce', 'quickbooks']
const CONTINUE_AFTER_MS = 60_000
const PREPARE_TIMEOUT_MS = 120_000
const READY_HOLD_MS = 1_400

const readFlag = (): number | null => {
  try {
    const v = Number(sessionStorage.getItem(FLAG_KEY))
    return Number.isFinite(v) && v > 0 && Date.now() - v < 6 * 60 * 60 * 1000 ? v : null
  } catch {
    return null
  }
}
const writeFlag = (v: number | null) => {
  try {
    if (v) sessionStorage.setItem(FLAG_KEY, String(v))
    else sessionStorage.removeItem(FLAG_KEY)
  } catch {
    /* storage unavailable: the gate still works off lastSyncedAt */
  }
}

// Survives route changes (each protected route mounts its own gate) for the rest of the page session.
let releasedThisSession = false

export const SyncGate: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const location = useLocation()
  const queryClient = useQueryClient()
  const { data: integrations } = useIntegrationsStatus()

  // Returning from the provider's consent screen: remember when, so only syncs from now on count.
  const [since, setSince] = useState<number | null>(() => {
    if (new URLSearchParams(location.search).get('status') === 'success') {
      const now = Date.now()
      writeFlag(now)
      releasedThisSession = false
      return now
    }
    return readFlag()
  })
  const [released, setReleased] = useState(releasedThisSession)
  const startedAt = useRef(Date.now())
  const [now, setNow] = useState(Date.now())

  const connected = PROVIDERS.filter((p) => integrations?.[p]?.connected)
  const neverSynced = connected.filter((p) => !integrations?.[p]?.lastSyncedAt)
  const watched = since ? connected : neverSynced
  // Just back from connecting: take over at once, before the integrations list has loaded,
  // so the app never flashes underneath.
  const engaged = !released && (integrations ? watched.length > 0 : since !== null)

  const jobs = useQueries({
    queries: watched.map((p) => ({
      queryKey: ['sync', 'status', p],
      queryFn: () => getSyncStatusRequest(p),
      enabled: engaged,
      refetchInterval: engaged ? 2000 : (false as const)
    }))
  })

  const sources = useMemo(
    () => watched.map((p, i) => sourceRow(p, jobs[i]?.data, since ?? 0)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [watched.join(','), jobs.map((j) => j.dataUpdatedAt).join(','), since]
  )
  const syncPhase: Phase = integrations ? phaseOf(sources, now - startedAt.current) : 'syncing'
  const [prep, setPrep] = useState<'idle' | 'running' | 'done'>('idle')
  const prepStartedAt = useRef(0)
  const phase: Phase = syncPhase === 'preparing' ? (prep === 'done' ? 'ready' : 'preparing') : syncPhase

  // ticking clock for the elapsed time and the preparing progress
  useEffect(() => {
    if (!engaged) return undefined
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [engaged])

  const release = useCallback(() => {
    releasedThisSession = true
    writeFlag(null)
    setReleased(true)
    // everything cached while the sync ran is stale now
    void queryClient.invalidateQueries()
  }, [queryClient])

  // Data is in: compute the default portfolio view so the dashboard opens already built.
  useEffect(() => {
    if (!engaged || syncPhase !== 'preparing' || prep !== 'idle') return
    setPrep('running')
    prepStartedAt.current = Date.now()
    const build = (async () => {
      const meta = (await portfolioApi.meta()) as { quarters?: string[] }
      const quarter = meta.quarters?.[meta.quarters.length - 1] ?? null
      await portfolioApi.overview({ gran: 'Q', quarter, month: null, window: 'P', span: 8 })
    })()
    const timeout = new Promise((resolve) => setTimeout(resolve, PREPARE_TIMEOUT_MS))
    void Promise.race([build, timeout])
      .catch(() => undefined) // a slow or failed pre-build just means the dashboard computes on open
      .finally(() => setPrep('done'))
  }, [engaged, syncPhase, prep])

  useEffect(() => {
    if (phase !== 'ready') return undefined
    const t = setTimeout(release, READY_HOLD_MS)
    return () => clearTimeout(t)
  }, [phase, release])

  // keep the page underneath from scrolling while the screen is up
  useEffect(() => {
    if (!engaged) return undefined
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [engaged])

  const [retrying, setRetrying] = useState(false)
  const retry = async () => {
    setRetrying(true)
    const restartAt = Date.now()
    try {
      await Promise.all(sources.filter((s) => s.state === 'failed').map((s) => startSyncRequest(s.provider)))
      writeFlag(restartAt)
      setSince(restartAt)
      startedAt.current = restartAt
      setPrep('idle')
      await queryClient.invalidateQueries({ queryKey: ['sync', 'status'] })
    } finally {
      setRetrying(false)
    }
  }

  if (!engaged) return <>{children}</>

  // the pre-build has no progress of its own: ease towards (never reaching) the end of its slice
  const preparingPct = prep === 'running' ? 14 * (1 - Math.exp(-(now - prepStartedAt.current) / 20_000)) : 0
  return (
    <SyncLoaderScreen
      phase={phase}
      sources={sources}
      progress={overallProgress(sources, phase, preparingPct)}
      elapsedMs={now - startedAt.current}
      canContinue={now - startedAt.current > CONTINUE_AFTER_MS}
      retrying={retrying}
      onRetry={retry}
      onContinue={release}
    />
  )
}
