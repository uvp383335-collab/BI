import React, { useCallback, useState } from 'react'
import ReactMarkdown, { Components } from 'react-markdown'
import { Loader2, RefreshCw, Sparkles } from 'lucide-react'
import { Modal } from '../../../shared/components/Modal'
import { AnalysisChartKey } from '../api/aiAnalysisApi'
import { useChartAnalysis } from '../hooks/useChartAnalysis'

interface AnalyzeButtonProps {
  chartKey: AnalysisChartKey
  /** Modal heading — usually the chart's own title. */
  chartTitle: string
}

const MARKDOWN_COMPONENTS: Components = {
  h1: ({ children }) => <h3 className="mt-5 mb-2 text-base font-semibold text-ink first:mt-0">{children}</h3>,
  h2: ({ children }) => <h3 className="mt-5 mb-2 text-base font-semibold text-ink first:mt-0">{children}</h3>,
  h3: ({ children }) => <h4 className="mt-4 mb-1.5 text-sm font-semibold text-ink">{children}</h4>,
  p: ({ children }) => <p className="mb-3 text-sm leading-relaxed text-ink-2">{children}</p>,
  ul: ({ children }) => <ul className="mb-3 list-disc space-y-1 pl-5 text-sm text-ink-2">{children}</ul>,
  ol: ({ children }) => <ol className="mb-3 list-decimal space-y-1 pl-5 text-sm text-ink-2">{children}</ol>,
  strong: ({ children }) => <strong className="font-semibold text-ink">{children}</strong>
}

function errorMessage(error: unknown): string {
  return (error as any)?.response?.data?.error?.message || 'Could not generate the analysis. Please try again.'
}

/**
 * "Analyze" action for a dashboard chart: opens a modal with an AI-written
 * report. The report always covers all products — the server loads the
 * chart's data itself with every dashboard filter off — so it can differ
 * from a filtered view the user is looking at, which the modal states.
 */
export const AnalyzeButton: React.FC<AnalyzeButtonProps> = ({ chartKey, chartTitle }) => {
  const [isOpen, setIsOpen] = useState(false)
  const analysis = useChartAnalysis(chartKey)

  const open = () => {
    setIsOpen(true)
    if (!analysis.data && !analysis.isPending) analysis.mutate(false)
  }
  const close = useCallback(() => setIsOpen(false), [])

  return (
    <>
      <button
        type="button"
        onClick={open}
        className="flex shrink-0 items-center gap-1.5 rounded-md border border-line-strong px-2.5 py-1.5 text-xs font-medium text-ink-2 transition-colors hover:bg-surface-3 hover:text-brand"
        title="Generate an AI analysis of this chart across all products"
      >
        <Sparkles className="h-3.5 w-3.5" />
        Analyze
      </button>

      {isOpen && (
        <Modal title={`AI analysis — ${chartTitle}`} onClose={close} size="xl">
          <p className="mb-4 rounded-md border border-line-strong bg-surface-3 px-3 py-2 text-xs text-ink-2">
            This analysis covers all products. Product or other filters selected on the chart are not applied.
          </p>

          {analysis.isPending ? (
            <div className="flex items-center gap-2 py-10 text-sm text-ink-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              Analyzing… this can take up to a minute.
            </div>
          ) : analysis.isError ? (
            <div className="py-6">
              <p className="text-sm text-danger">{errorMessage(analysis.error)}</p>
              <button type="button" onClick={() => analysis.mutate(false)} className="mt-3 text-sm font-medium text-brand hover:underline">
                Try again
              </button>
            </div>
          ) : analysis.data ? (
            <>
              <ReactMarkdown components={MARKDOWN_COMPONENTS}>{analysis.data.report}</ReactMarkdown>
              <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-line-strong pt-4 text-xs text-ink-3">
                <span>
                  Covers {analysis.data.window.from} to {analysis.data.window.to} · Generated {new Date(analysis.data.generatedAt).toLocaleString()}
                </span>
                <button
                  type="button"
                  onClick={() => analysis.mutate(true)}
                  className="flex items-center gap-1.5 rounded-md border border-line-strong px-2.5 py-1.5 font-medium text-ink-2 transition-colors hover:bg-surface-3 hover:text-brand"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  Regenerate
                </button>
              </div>
            </>
          ) : null}
        </Modal>
      )}
    </>
  )
}
