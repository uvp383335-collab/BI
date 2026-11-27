import React, { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useMutation } from '@tanstack/react-query'
import { AnalysisReport, AnalysisStatus, MetricAnalysisView, analyzeMetricRequest } from '../api/aiAnalysisApi'
import './metricAnalysis.css'

/** The portfolio view the drawer is showing (features/portfolio PortfolioView). */
interface DrawerView {
  gran: 'M' | 'Q'
  month: string | null
  quarter: string | null
  window: 'P' | 'TTM'
  span: number
  product?: 'All' | string[]
}

interface MetricAnalyzeButtonProps {
  metricId: string
  metricName: string
  view: DrawerView
  /** Connected data sources, for the footer ("QuickBooks, Salesforce and HubSpot"). */
  sources?: string[]
}

/** Status from the report -> the readout's tone pill (class, label), as in the Oryon reference page. */
const TONE: Record<AnalysisStatus, [string, string]> = {
  Improving: ['up', 'Improving'],
  Worsening: ['dn', 'Deteriorating'],
  Mixed: ['wat', 'Mixed signals'],
  Stable: ['fl', 'Stable'],
  'Not enough data': ['fl', 'No data']
}

function toRequestView(v: DrawerView): MetricAnalysisView {
  const asOf = (v.gran === 'M' ? v.month : v.quarter) ?? undefined
  const product = v.product && v.product !== 'All' && v.product.length > 0 ? v.product[0] : undefined
  return { asOf, window: v.window, span: String(v.span) as MetricAnalysisView['span'], product }
}

function listText(items: string[]): string {
  return items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`
}

/** Renders `**bold**` spans as <b>; everything else is plain text. */
function withBold(text: string): React.ReactNode {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith('**') && part.endsWith('**') && part.length > 4 ? <b key={i}>{part.slice(2, -2)}</b> : part
  )
}

/** The verdict with its key figure in <b>, like the reference page. */
function verdict(headline: string, figure: string): React.ReactNode {
  const text = headline.replace(/\*\*([^*]+)\*\*/g, '$1')
  const at = figure ? text.indexOf(figure) : -1
  if (at < 0) return text
  return (
    <>
      {text.slice(0, at)}
      <b>{figure}</b>
      {text.slice(at + figure.length)}
    </>
  )
}

const plain = (text: string) => text.replace(/\*\*([^*]+)\*\*/g, '$1')

function memoText(name: string, scope: string, r: AnalysisReport): string {
  const lines = [`${name}: ${scope}`, '', plain(r.headline)]
  const sec = (h: string, items: string[]) => {
    if (!items.length) return
    lines.push('', h.toUpperCase(), ...items.map((x) => `• ${plain(x)}`))
  }
  sec('What is happening', r.whatIsHappening)
  sec('What is driving it', r.whatIsDrivingIt)
  if (r.whyItMatters) lines.push('', 'WHY IT MATTERS', plain(r.whyItMatters))
  if (r.whatToDo.length || r.askManagement) {
    lines.push('', 'WHAT TO DO', ...r.whatToDo.map((x) => `• ${plain(x)}`))
    if (r.askManagement) lines.push(`• Ask management: ${plain(r.askManagement)}`)
  }
  return lines.join('\n')
}

/** Oryon mark in the logo colours (light outer stars, gold centre, slate line). */
export const OryonMark: React.FC<{ width: number; height: number }> = ({ width, height }) => (
  <svg className="om" width={width} height={height} viewBox="0 0 30 22" aria-hidden="true">
    <line x1="5" y1="17" x2="25" y2="5" strokeWidth="1.6" />
    <circle cx="5" cy="17" r="3" />
    <circle className="c" cx="15" cy="11" r="3.8" />
    <circle cx="25" cy="5" r="3" />
  </svg>
)

const CloseIcon = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
    <path d="M2 2l10 10M12 2L2 12" stroke="currentColor" strokeWidth="1.6" fill="none" />
  </svg>
)

const Section: React.FC<{ title: string; items: string[] }> = ({ title, items }) =>
  items.length ? (
    <section>
      <h4>{title}</h4>
      <ul>
        {items.map((x, i) => (
          <li key={i}>{withBold(x)}</li>
        ))}
      </ul>
    </section>
  ) : null

/**
 * "Analyze" button for the portfolio metric drawer header. Opens the OryonAI
 * analysis card (centred over the drawer): a short summary readout of the
 * metric for the selection on screen — tone, verdict, what is happening,
 * what is driving it, why it matters, what to do and a question for
 * management, with "Copy for memo".
 */
export const MetricAnalyzeButton: React.FC<MetricAnalyzeButtonProps> = ({ metricId, metricName, view, sources = [] }) => {
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const closeRef = useRef<HTMLButtonElement>(null)
  const analysis = useMutation({
    mutationKey: ['ai-analysis', 'metric', metricId],
    mutationFn: (refresh: boolean) => analyzeMetricRequest(metricId, toRequestView(view), refresh)
  })

  const close = useCallback(() => setOpen(false), [])

  const start = () => {
    analysis.reset()
    setCopied(false)
    setOpen(true)
    analysis.mutate(false)
  }

  // Escape closes only the analysis, not the drawer underneath it (capture runs before the drawer's listener).
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopImmediatePropagation()
      close()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [open, close])

  useEffect(() => {
    if (open && analysis.isSuccess) closeRef.current?.focus()
  }, [open, analysis.isSuccess])

  useEffect(() => {
    if (!copied) return
    const t = window.setTimeout(() => setCopied(false), 1600)
    return () => window.clearTimeout(t)
  }, [copied])

  const report = analysis.data?.report
  const productText = view.product && view.product !== 'All' && view.product.length ? view.product[0] : 'All regions, segments and products'
  const scope = report ? [report.periodLabel, report.basis, productText].filter(Boolean).join(' · ') : ''
  const [toneClass, toneLabel] = report ? TONE[report.status] : ['fl', '']
  const crumb = `OryonAI analysis · ${metricId}`

  const copy = async () => {
    if (!report) return
    try {
      await navigator.clipboard.writeText(memoText(metricName, scope, report))
      setCopied(true)
    } catch {
      // Clipboard can be blocked (permissions, insecure context); the button simply doesn't confirm.
    }
  }

  const header = (
    <div className="oa-h">
      <div>
        <div className="crumb" style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <OryonMark width={18} height={13} />
          {crumb}
        </div>
        <h3 id="oa-t">{metricName}</h3>
      </div>
      <div className="dr-acts">
        {report && (
          <button type="button" className="oa-copy" onClick={copy} title="Copy this analysis as plain text for a memo or email">
            {copied ? 'Copied' : 'Copy for memo'}
          </button>
        )}
        <button type="button" className="x" onClick={close} aria-label="Close analysis" ref={closeRef}>
          <CloseIcon />
        </button>
      </div>
    </div>
  )

  let card: React.ReactNode
  if (analysis.isPending || analysis.isIdle) {
    card = (
      <div className="oa-load">
        <span className="oa-spark" aria-hidden="true" />
        Analyzing {metricName.toLowerCase()} for the current selection…
      </div>
    )
  } else if (analysis.isError || !report) {
    const msg = (analysis.error as any)?.response?.data?.error?.message
    card = (
      <>
        {header}
        <p style={{ margin: 0 }}>The analysis could not be generated for this selection.</p>
        {msg && <p className="note" style={{ margin: 0 }}>{msg}</p>}
      </>
    )
  } else {
    card = (
      <>
        {header}
        <div className="oa-scope">
          <span className={`oa-tone ${toneClass}`}>{toneLabel}</span>
          <span>{scope}</span>
        </div>
        <p className="oa-v">{verdict(report.headline, report.headlineFigure)}</p>
        <div className="oa-b">
          <Section title="What is happening" items={report.whatIsHappening} />
          <Section title="What is driving it" items={report.whatIsDrivingIt} />
          {report.whyItMatters && (
            <section>
              <h4>Why it matters</h4>
              <p>{withBold(report.whyItMatters)}</p>
            </section>
          )}
          {(report.whatToDo.length > 0 || report.askManagement) && (
            <section className="oa-do">
              <h4>What to do</h4>
              <ul>
                {report.whatToDo.map((x, i) => (
                  <li key={i}>{withBold(x)}</li>
                ))}
                {report.askManagement && (
                  <li>
                    <span className="oa-ask">Ask management</span>
                    {plain(report.askManagement)}
                  </li>
                )}
              </ul>
            </section>
          )}
        </div>
        <div className="oa-f">
          <span className="note">
            Generated by OryonAI from {sources.length ? listText(sources) : 'your connected'} data through {report.periodLabel}. Change the filters and run it
            again for a different cut.
          </span>
        </div>
      </>
    )
  }

  return (
    <>
      <button type="button" className="oa-btn" data-tip="Analysis" aria-label="Analysis" onClick={start}>
        <OryonMark width={21} height={15} />
        <span>Analyze</span>
      </button>
      {open &&
        createPortal(
          <div className="oryon-an">
            <div className="oa-scrim" onClick={close} />
            <div className="oa-card" role="dialog" aria-modal="true" aria-labelledby="oa-t">
              {card}
            </div>
          </div>,
          document.body
        )}
    </>
  )
}

export default MetricAnalyzeButton
