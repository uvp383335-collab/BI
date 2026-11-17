import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Loader2, Sparkles } from 'lucide-react'
import { ANALYSIS_METRIC_CODE, AnalysisChartKey, AnalysisReport, AnalysisStatus } from '../api/aiAnalysisApi'
import { useChartAnalysis } from '../hooks/useChartAnalysis'
import './analysisDrawer.css'

interface AnalyzeButtonProps {
  chartKey: AnalysisChartKey
  /** Drawer heading — usually the chart's own title. */
  chartTitle: string
}

/** The analysis always runs on unfiltered data — the server loads the chart itself with every dashboard filter off. */
const SCOPE_LABEL = 'All regions, segments and products'

const STATUS_TONE: Record<AnalysisStatus, string> = {
  Improving: 'up',
  Stable: 'flat',
  Mixed: 'mixed',
  Worsening: 'down',
  'Not enough data': 'none'
}

const METRIC_CODE_IN_TITLE = /\s*\b(?:VC|CB|CM|ER)-\d{2}\b/g

function errorMessage(error: unknown): string {
  return (error as any)?.response?.data?.error?.message || 'Could not generate the analysis. Please try again.'
}

/** Renders `**bold**` spans; everything else is plain text. */
function withBold(text: string): React.ReactNode {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith('**') && part.endsWith('**') && part.length > 4 ? <b key={i}>{part.slice(2, -2)}</b> : part
  )
}

/** Highlights the first occurrence of `figure` in the headline. */
function withFigure(headline: string, figure: string): React.ReactNode {
  const at = figure ? headline.indexOf(figure) : -1
  if (at < 0) return headline
  return (
    <>
      {headline.slice(0, at)}
      <mark>{figure}</mark>
      {headline.slice(at + figure.length)}
    </>
  )
}

const plain = (text: string) => text.replace(/\*\*([^*]+)\*\*/g, '$1')

function memoText(code: string | undefined, title: string, report: AnalysisReport): string {
  const bullets = (items: string[]) => items.map((item) => `- ${plain(item)}`).join('\n')
  return [
    `${code ? `${code} ` : ''}${title} (${report.status})`,
    `${report.periodLabel} · ${report.basis} · ${SCOPE_LABEL}`,
    '',
    plain(report.headline),
    '',
    'What is happening',
    bullets(report.whatIsHappening),
    '',
    'What is driving it',
    bullets(report.whatIsDrivingIt),
    '',
    'Why it matters',
    plain(report.whyItMatters),
    '',
    'What to do',
    bullets(report.whatToDo),
    `Ask management: ${plain(report.askManagement)}`
  ].join('\n')
}

const KickerMark: React.FC = () => (
  <svg width="14" height="10" viewBox="0 0 14 10" aria-hidden="true">
    <circle cx="2" cy="8" r="1.6" fill="currentColor" />
    <circle cx="7" cy="5" r="1.6" fill="currentColor" opacity=".75" />
    <path d="M9.5 9 13 1" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
  </svg>
)

const Bullets: React.FC<{ items: string[] }> = ({ items }) => (
  <ul className="an-list">
    {items.map((item, i) => (
      <li key={i}>{withBold(item)}</li>
    ))}
  </ul>
)

/**
 * "Analyze" action for a dashboard chart: opens the Oryon AI analysis drawer
 * (status, headline, what is happening / driving it / why it matters, and
 * what to do). The report always covers all products, regions and
 * segments, whatever filters are selected on the chart.
 */
export const AnalyzeButton: React.FC<AnalyzeButtonProps> = ({ chartKey, chartTitle }) => {
  const [isOpen, setIsOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const closeRef = useRef<HTMLButtonElement>(null)
  const analysis = useChartAnalysis(chartKey)

  const code = ANALYSIS_METRIC_CODE[chartKey]
  const title = chartTitle.replace(METRIC_CODE_IN_TITLE, '').trim()
  const report = analysis.data?.report

  const open = () => {
    setIsOpen(true)
    if (!analysis.data && !analysis.isPending) analysis.mutate(false)
  }
  const close = useCallback(() => setIsOpen(false), [])

  useEffect(() => {
    if (!isOpen) return
    closeRef.current?.focus()
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isOpen, close])

  useEffect(() => {
    if (!copied) return
    const timer = window.setTimeout(() => setCopied(false), 2000)
    return () => window.clearTimeout(timer)
  }, [copied])

  const copyForMemo = async () => {
    if (!report) return
    try {
      await navigator.clipboard.writeText(memoText(code, title, report))
      setCopied(true)
    } catch {
      // Clipboard can be blocked (permissions, insecure context); the button simply doesn't confirm.
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={open}
        className="flex shrink-0 items-center gap-1.5 rounded-md border border-line-strong px-2.5 py-1.5 text-xs font-medium text-ink-2 transition-colors hover:bg-surface-3 hover:text-brand"
        title="Open the Oryon AI analysis of this chart"
      >
        <Sparkles className="h-3.5 w-3.5" />
        Analyze
      </button>

      {isOpen && (
        <>
          <div className="an-scrim" onClick={close} />
          <aside className="an-drawer" role="dialog" aria-modal="true" aria-labelledby={`an-title-${chartKey}`}>
            <div className="an-head">
              <div>
                <div className="an-kicker">
                  <KickerMark />
                  <span>ORYONAI ANALYSIS{code ? ` · ${code}` : ''}</span>
                </div>
                <h2 className="an-title" id={`an-title-${chartKey}`}>
                  {title}
                </h2>
              </div>
              <div className="an-actions">
                <button type="button" className="an-btn" onClick={copyForMemo} disabled={!report}>
                  {copied ? 'Copied' : 'Copy for memo'}
                </button>
                <button type="button" className="an-btn an-x" onClick={close} aria-label="Close" ref={closeRef}>
                  <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
                    <path d="M2 2l10 10M12 2L2 12" stroke="currentColor" strokeWidth="1.6" fill="none" />
                  </svg>
                </button>
              </div>
            </div>

            {analysis.isPending ? (
              <div className="an-state">
                <Loader2 className="h-4 w-4 an-spin" />
                Analyzing… this can take up to a minute.
              </div>
            ) : analysis.isError ? (
              <div className="an-state" style={{ flexDirection: 'column', alignItems: 'flex-start' }}>
                <span className="an-error">{errorMessage(analysis.error)}</span>
                <button type="button" className="an-link" onClick={() => analysis.mutate(false)}>
                  Try again
                </button>
              </div>
            ) : report ? (
              <>
                <span className={`an-status ${STATUS_TONE[report.status]}`}>{report.status}</span>
                <div className="an-meta">
                  {report.periodLabel} · {report.basis} · {SCOPE_LABEL}
                </div>
                <p className="an-headline">{withFigure(report.headline, report.headlineFigure)}</p>

                {report.whatIsHappening.length > 0 && (
                  <section className="an-sec">
                    <h3 className="an-label">What is happening</h3>
                    <Bullets items={report.whatIsHappening} />
                  </section>
                )}
                {report.whatIsDrivingIt.length > 0 && (
                  <section className="an-sec">
                    <h3 className="an-label">What is driving it</h3>
                    <Bullets items={report.whatIsDrivingIt} />
                  </section>
                )}
                {report.whyItMatters && (
                  <section className="an-sec">
                    <h3 className="an-label">Why it matters</h3>
                    <p className="an-p">{withBold(report.whyItMatters)}</p>
                  </section>
                )}

                <section className="an-todo">
                  <h3 className="an-label">What to do</h3>
                  {report.whatToDo.length > 0 && <Bullets items={report.whatToDo} />}
                  {report.askManagement && (
                    <div className="an-ask">
                      <b>Ask management</b>
                      {withBold(report.askManagement)}
                    </div>
                  )}
                </section>

                <div className="an-foot">
                  <span>
                    Covers {analysis.data!.window.from} to {analysis.data!.window.to} · Generated {new Date(analysis.data!.generatedAt).toLocaleString()}
                  </span>
                  <button type="button" className="an-link" onClick={() => analysis.mutate(true)}>
                    Regenerate
                  </button>
                </div>
              </>
            ) : null}
          </aside>
        </>
      )}
    </>
  )
}
