import { memo, useMemo } from 'react'
import type { TradingRun } from '../api/types'
import { extractDecision, rawRunSignature } from '../utils/run'
import { SafeMarkdown } from './SafeMarkdown'

export interface FinalDecisionProps {
  run: TradingRun | null
  onCopy: (text: string, label: string) => void
}

function signalTone(signal: string): 'positive' | 'negative' | 'neutral' | 'unknown' {
  const normalized = signal.toUpperCase()
  if (/\b(STRONG BUY|BUY|OVERWEIGHT|BULLISH|UPSIDE)\b/.test(normalized)) return 'positive'
  if (/\b(STRONG SELL|SELL|UNDERWEIGHT|BEARISH|DOWNSIDE)\b/.test(normalized)) return 'negative'
  if (/\b(HOLD|NEUTRAL)\b/.test(normalized)) return 'neutral'
  return 'unknown'
}

export const FinalDecision = memo(function FinalDecision({ run, onCopy }: FinalDecisionProps) {
  const signature = rawRunSignature(run, 'decision')
  // Signature-only memoization keeps unchanged decision DOM stable during polling.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const decision = useMemo(() => extractDecision(run), [signature])
  if (!decision) {
    return (
      <section className="decision-view">
        <div className="report-toolbar">
          <div><span>PORTFOLIO DESK</span><h3>Final Trading Decision</h3></div>
          <button type="button" disabled>COPY</button>
        </div>
        <div className="desk-empty">
          <span>F3 // DECISION</span>
          <h3>Verdict pending</h3>
          <p>The Portfolio Manager verdict appears after debate and risk review.</p>
        </div>
      </section>
    )
  }
  const tone = signalTone(decision.signal)
  return (
    <section className="decision-view" aria-labelledby="decision-heading">
      <div className="report-toolbar">
        <div><span>PORTFOLIO DESK</span><h3 id="decision-heading">Final Trading Decision</h3></div>
        <button type="button" onClick={() => onCopy(decision.raw, 'Decision')}>COPY</button>
      </div>
      <div className="decision-scroll" tabIndex={0} aria-label="Scrollable final decision analysis">
        <div className={`decision-hero decision-hero--${tone}`}>
          <span>PORTFOLIO MANAGER VERDICT</span>
          <div>
            <h4>{decision.signal}</h4>
            <strong>FINAL</strong>
          </div>
        </div>
        {decision.fields.length > 0 && (
          <dl className="decision-fields">
            {decision.fields.map(([label, value]) => (
              <div key={`${label}:${value}`}><dt>{label}</dt><dd>{value}</dd></div>
            ))}
          </dl>
        )}
        <SafeMarkdown
          content={decision.narrative}
          className="decision-narrative"
          ariaLabel="Portfolio manager decision narrative"
        />
      </div>
    </section>
  )
})
