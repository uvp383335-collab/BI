import React from 'react'
import { Brand } from '../../../shared/components/Brand'
import { Constellation } from './Constellation'
import { EntityRow, Phase, SourceRow, formatElapsed } from '../syncPlan'

interface SyncLoaderScreenProps {
  phase: Phase
  sources: SourceRow[]
  progress: number
  elapsedMs: number
  /** Offered once the sync has run a while, so a very large first sync never traps the user. */
  canContinue: boolean
  retrying?: boolean
  onRetry: () => void
  onContinue: () => void
}

const nf = new Intl.NumberFormat('en-US')

const listNames = (names: string[]) =>
  names.length <= 1 ? names[0] ?? '' : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`

function copyFor(phase: Phase, sources: SourceRow[]) {
  const names = listNames(sources.map((s) => s.name))
  const failed = sources.filter((s) => s.state === 'failed').map((s) => s.name)
  switch (phase) {
    case 'syncing':
      return {
        eyebrow: 'First sync',
        title: names ? `Bringing in your ${names} data` : 'Bringing in your data',
        body: 'We’re copying your history so every metric has a full record to measure. Your dashboard opens by itself when it’s ready.'
      }
    case 'preparing':
      return {
        eyebrow: 'Almost there',
        title: 'Building your dashboard',
        body: 'Your data is in. Now we’re calculating your metrics across the last two years.'
      }
    case 'ready':
      return { eyebrow: 'Done', title: 'Your data is ready', body: 'Opening your dashboard…' }
    case 'failed':
      return {
        eyebrow: 'Sync stopped',
        title: `The ${listNames(failed)} sync didn’t finish`,
        body: 'Nothing you’ve synced so far is lost. Try again now, or continue and run it later from Settings.'
      }
  }
}

const StatusMark: React.FC<{ status: EntityRow['status'] }> = ({ status }) => {
  if (status === 'completed') {
    return (
      <svg viewBox="0 0 16 16" className="h-4 w-4 text-teal" aria-hidden="true">
        <path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    )
  }
  if (status === 'syncing') return <span className="syncl-spin h-3.5 w-3.5" aria-hidden="true" />
  if (status === 'failed') return <span className="h-2 w-2 rounded-full bg-danger" aria-hidden="true" />
  return <span className="h-1.5 w-1.5 rounded-full bg-line-strong" aria-hidden="true" />
}

const entityText = (e: EntityRow) => {
  if (e.status === 'pending') return 'Waiting'
  if (e.status === 'failed') return 'Stopped'
  if (e.total > 0 && e.status === 'syncing') return `${nf.format(e.synced)} of ${nf.format(e.total)}`
  return e.status === 'completed' ? nf.format(e.synced) : `${nf.format(e.synced)} so far`
}

const Source: React.FC<{ source: SourceRow; showName: boolean }> = ({ source, showName }) => (
  <section aria-label={`${source.name} sync`}>
    {showName && <h2 className="mb-2 font-mono text-[11px] uppercase tracking-[0.09em] text-ink-3">{source.name}</h2>}
    {source.state === 'waiting' ? (
      <p className="flex items-center gap-3 py-2 text-sm text-ink-2">
        <span className="syncl-spin h-3.5 w-3.5" aria-hidden="true" />
        Connecting to {source.name}…
      </p>
    ) : (
      <ul className="divide-y divide-line border-y border-line">
        {source.entities.map((e) => (
          <li key={e.key} className="flex items-center gap-3 py-2.5 text-sm">
            <span className="grid w-4 place-items-center">
              <StatusMark status={e.status} />
            </span>
            <span className={e.status === 'pending' ? 'text-ink-3' : 'text-ink'}>{e.label}</span>
            <span className="ml-auto font-mono text-xs tabular-nums text-ink-2">{entityText(e)}</span>
          </li>
        ))}
      </ul>
    )}
    {source.error && <p className="mt-2 text-sm text-danger">{source.error}</p>}
  </section>
)

/**
 * Full-screen first-sync screen: no navigation, just what is happening, how far along it is and
 * how long it has run. Always on the dark "night sky" palette, whatever the app theme.
 */
export const SyncLoaderScreen: React.FC<SyncLoaderScreenProps> = ({ phase, sources, progress, elapsedMs, canContinue, retrying, onRetry, onContinue }) => {
  const copy = copyFor(phase, sources)
  const working = phase === 'syncing' || phase === 'preparing'
  const step = phase === 'syncing' ? sources.find((s) => s.step)?.step : phase === 'preparing' ? 'Calculating metrics' : null

  return (
    <div className="oryon-side syncl-screen fixed inset-0 z-[100] overflow-y-auto bg-surface text-ink" role="status" aria-live="polite" aria-busy={working}>
      <div className="mx-auto flex min-h-full w-full max-w-[1120px] flex-col px-6 py-8 sm:px-10">
        <Brand size={22} />

        <div className="my-auto grid items-center gap-10 py-10 md:grid-cols-[minmax(0,380px)_minmax(0,1fr)] md:gap-20">
          <div className="mx-auto w-44 sm:w-56 md:w-full md:max-w-[340px]">
            <Constellation progress={progress} working={working} failed={phase === 'failed'} />
          </div>

          <div className="min-w-0">
            <p className={`font-mono text-[11px] uppercase tracking-[0.12em] ${phase === 'failed' ? 'text-danger' : 'text-brand'}`}>{copy.eyebrow}</p>
            <h1 className="mt-3 font-display text-[clamp(30px,4.2vw,46px)] font-normal leading-[1.08] tracking-[-0.015em] text-ink [text-wrap:balance]">{copy.title}</h1>
            <p className="mt-4 max-w-[52ch] text-[15px] leading-relaxed text-ink-2">{copy.body}</p>

            {phase !== 'failed' && (
              <div className="mt-8" aria-hidden="true">
                <div className="flex items-baseline justify-between font-mono text-xs text-ink-3">
                  <span className="truncate pr-4">{step ?? ' '}</span>
                  <span className="tabular-nums text-ink">{Math.round(progress)}%</span>
                </div>
                <div className="mt-2 h-[3px] w-full overflow-hidden rounded-full bg-surface-4">
                  <div className="syncl-bar h-full rounded-full bg-brand" style={{ width: `${progress}%` }} />
                </div>
              </div>
            )}

            <div className="mt-8 space-y-6">
              {sources.map((s) => (
                <Source key={s.provider} source={s} showName={sources.length > 1} />
              ))}
            </div>

            {phase === 'failed' ? (
              <div className="mt-8 flex flex-wrap gap-3">
                <button type="button" className="btn-primary w-auto px-5" onClick={onRetry} disabled={retrying}>
                  {retrying ? 'Restarting…' : 'Try again'}
                </button>
                <button type="button" className="btn-outline-dark" onClick={onContinue}>
                  Continue to Oryon
                </button>
              </div>
            ) : (
              <p className="mt-8 text-xs text-ink-3">
                <span className="font-mono tabular-nums">Elapsed {formatElapsed(elapsedMs)}</span>
                {phase === 'syncing' && <> · Large accounts can take several minutes. You can leave this tab open.</>}
                {canContinue && phase === 'syncing' && (
                  <>
                    {' '}
                    <button type="button" className="auth-link underline-offset-4" onClick={onContinue}>
                      Continue while it syncs
                    </button>
                  </>
                )}
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
