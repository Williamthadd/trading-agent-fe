import { useEffect, useId, useState } from 'react'
import type { TradingRun } from '../api/types'
import { displayStatus, isTerminalStatus, normalizeStatus, runProgress } from '../utils/run'
import { AgentMatrix } from './AgentMatrix'
import { FinalDecision } from './FinalDecision'
import { LiveWire } from './LiveWire'
import { Reports } from './Reports'

type TabId = 'live' | 'reports' | 'decision'

const TABS: Array<{ id: TabId; key: string; label: string }> = [
  { id: 'live', key: 'F1', label: 'Live Wire' },
  { id: 'reports', key: 'F2', label: 'Reports' },
  { id: 'decision', key: 'F3', label: 'Decision' },
]

export interface IntelligenceDeskProps {
  run: TradingRun | null
  onCopy: (text: string, label: string) => void
}

export function IntelligenceDesk({ run, onCopy }: IntelligenceDeskProps) {
  const [tab, setTab] = useState<TabId>('live')
  const prefix = useId()
  const progress = runProgress(run)
  const statusTone = normalizeStatus(run?.status)

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (!['F1', 'F2', 'F3'].includes(event.key)) return
      event.preventDefault()
      setTab(TABS[Number(event.key.slice(1)) - 1]?.id ?? 'live')
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  const keyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    const index = TABS.findIndex((item) => item.id === tab)
    let next: number
    if (event.key === 'ArrowRight') next = (index + 1) % TABS.length
    else if (event.key === 'ArrowLeft') next = (index - 1 + TABS.length) % TABS.length
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = TABS.length - 1
    else return
    event.preventDefault()
    const nextTab = TABS[next]
    if (!nextTab) return
    setTab(nextTab.id)
    document.getElementById(`${prefix}-tab-${nextTab.id}`)?.focus()
  }

  return (
    <div className="intelligence-desk">
      <header className="desk-header">
        <div className="desk-instrument">
          <span>{run ? `$${run.ticker}` : 'NO ACTIVE SYMBOL'}</span>
          <strong>{run?.analysis_date ?? 'SELECT ANALYSIS PARAMETERS'}</strong>
        </div>
        <div className={`desk-status desk-status--${statusTone}`}>
          <span className="status-dot" aria-hidden="true" />
          <span>{displayStatus(run?.status)}</span>
        </div>
        <div className="desk-run-meta">
          <span>RUN {run?.run_id.slice(0, 8).toUpperCase() ?? '--------'}</span>
          <span>PHASE {(run?.current_phase ?? run?.current_agent ?? (run && isTerminalStatus(run.status) ? 'CLOSED' : 'STANDBY')).toUpperCase()}</span>
        </div>
        <div className="desk-progress" aria-label={`Run progress ${progress}%`}>
          <span style={{ width: `${progress}%` }} />
        </div>
        <output className="desk-progress-value">{progress}%</output>
      </header>
      <div className="terminal-tabs" role="tablist" aria-label="Intelligence views" onKeyDown={keyDown}>
        {TABS.map((item) => (
          <button
            key={item.id}
            id={`${prefix}-tab-${item.id}`}
            type="button"
            role="tab"
            aria-selected={tab === item.id}
            aria-controls={`${prefix}-panel-${item.id}`}
            tabIndex={tab === item.id ? 0 : -1}
            onClick={() => setTab(item.id)}
          >
            <kbd>{item.key}</kbd><span>{item.label}</span>
          </button>
        ))}
      </div>
      <div
        id={`${prefix}-panel-live`}
        role="tabpanel"
        aria-labelledby={`${prefix}-tab-live`}
        hidden={tab !== 'live'}
        className="desk-tabpanel"
      >
        <div className="live-layout"><AgentMatrix run={run} /><LiveWire run={run} /></div>
      </div>
      <div
        id={`${prefix}-panel-reports`}
        role="tabpanel"
        aria-labelledby={`${prefix}-tab-reports`}
        hidden={tab !== 'reports'}
        className="desk-tabpanel desk-tabpanel--scroll"
      >
        <Reports run={run} onCopy={onCopy} />
      </div>
      <div
        id={`${prefix}-panel-decision`}
        role="tabpanel"
        aria-labelledby={`${prefix}-tab-decision`}
        hidden={tab !== 'decision'}
        className="desk-tabpanel desk-tabpanel--scroll"
      >
        <FinalDecision run={run} onCopy={onCopy} />
      </div>
    </div>
  )
}
