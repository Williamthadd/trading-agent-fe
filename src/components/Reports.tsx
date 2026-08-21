import { useEffect, useMemo, useRef } from 'react'
import type { TradingRun } from '../api/types'
import { extractReports, humanizeLabel, rawRunSignature } from '../utils/run'
import { SafeMarkdown } from './SafeMarkdown'

export interface ReportsProps {
  run: TradingRun | null
  onCopy: (text: string, label: string) => void
}

function wordCount(value: string): number {
  return value.trim() ? value.trim().split(/\s+/u).length : 0
}

export function Reports({ run, onCopy }: ReportsProps) {
  const signature = rawRunSignature(run, 'reports')
  // Signature-only memoization intentionally preserves details state across polling objects.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const reports = useMemo(() => extractReports(run), [signature])
  const listRef = useRef<HTMLDivElement>(null)
  const previousSignature = useRef('')

  useEffect(() => {
    if (previousSignature.current && previousSignature.current !== signature) {
      const details = listRef.current?.querySelectorAll('details')
      details?.forEach((item, index) => {
        item.open = index === details.length - 1
      })
    }
    previousSignature.current = signature
  }, [signature])

  const copyAll = (): void => {
    const raw = reports
      .map((report) => `${report.label.toUpperCase()}\n${report.content}`)
      .join('\n\n------------------------------------------------------------\n\n')
    onCopy(raw, 'All reports')
  }

  return (
    <section className="reports-view" aria-labelledby="reports-heading">
      <div className="report-toolbar">
        <div>
          <span>RESEARCH LEDGER</span>
          <h3 id="reports-heading">Analysis Reports</h3>
        </div>
        <button type="button" onClick={copyAll} disabled={!reports.length}>COPY ALL</button>
      </div>
      {reports.length ? (
        <div className="report-list" ref={listRef}>
          {reports.map((report, index) => (
            <details
              className="report-card"
              key={`${report.label}\0${report.content}`}
              open={index === reports.length - 1}
            >
              <summary>
                <span className="report-card__index">{String(index + 1).padStart(2, '0')}</span>
                <strong>{humanizeLabel(report.label)}</strong>
                <span>{wordCount(report.content).toLocaleString()} WORDS</span>
              </summary>
              <SafeMarkdown content={report.content} ariaLabel={`${humanizeLabel(report.label)} report`} />
            </details>
          ))}
        </div>
      ) : (
        <div className="desk-empty">
          <span>F2 // REPORTS</span>
          <h3>No research reports yet</h3>
          <p>Completed analyst memos will be indexed here as the cycle progresses.</p>
        </div>
      )}
    </section>
  )
}
