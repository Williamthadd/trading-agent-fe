import { useCallback } from 'react'
import { AuthBoundary, useAuth } from '../auth'
import { AnalysisControl } from '../components/AnalysisControl'
import { DailyHistory } from '../components/DailyHistory'
import { IntelligenceDesk } from '../components/IntelligenceDesk'
import { ResizablePanelGrid } from '../components/ResizablePanelGrid'
import { TerminalFooter } from '../components/TerminalFooter'
import { TerminalHeader } from '../components/TerminalHeader'
import { TickerRibbon } from '../components/TickerRibbon'
import { ToastProvider, useToast, type ToastTone } from '../components/ToastProvider'
import { useHealth } from '../hooks/useHealth'
import { useHistory } from '../hooks/useHistory'
import { useOptions } from '../hooks/useOptions'
import { useRunPolling } from '../hooks/useRunPolling'

function Workstation() {
  const auth = useAuth()
  const { showToast, clearToasts } = useToast()
  const optionsState = useOptions(true)
  const history = useHistory(true)
  const health = useHealth()

  const notify = useCallback(
    (message: string, tone: ToastTone = 'info') => {
      showToast(message, { tone })
    },
    [showToast],
  )

  const runs = useRunPolling({
    onToast: notify,
    onTerminal: () => history.refresh(),
  })

  const copy = useCallback(
    async (text: string, label: string) => {
      if (!text) return
      try {
        if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable')
        await navigator.clipboard.writeText(text)
        notify(`${label} copied to clipboard.`, 'success')
      } catch {
        notify(`Could not copy ${label.toLowerCase()}. Allow clipboard access and try again.`, 'error')
      }
    },
    [notify],
  )

  const logout = async (): Promise<void> => {
    runs.clear()
    clearToasts()
    await auth.logout()
  }

  const storage = optionsState.options?.storage ?? health?.storage ?? {
    mode: 'unavailable',
    backend: 'unknown',
    configured: false,
    message: optionsState.loading ? 'Storage status is loading.' : 'Storage status is unavailable.',
  }

  return (
    <div className="terminal-app">
      <TerminalHeader
        sessionStatus={
          optionsState.loading
            ? 'INITIALIZING'
            : runs.active
              ? 'RUNNING'
              : optionsState.error
                ? 'OFFLINE'
                : 'READY'
        }
        storage={storage}
        accountEmail={auth.user?.email ?? null}
        onLogout={logout}
        isLoggingOut={auth.activity === 'signing_out'}
        canLogout={auth.canLogout}
      />
      <TickerRibbon />
      <ResizablePanelGrid>
        <section id="input-panel" className="terminal-panel terminal-grid__input" aria-labelledby="input-panel-heading">
          <header className="terminal-panel__header">
            <span className="terminal-panel__code">01 // INPUT</span>
            <h2 id="input-panel-heading" className="terminal-panel__title">Analysis Control</h2>
          </header>
          <div className="terminal-panel__body">
            {optionsState.loading ? (
              <div className="panel-state" aria-live="polite">
                <span className="terminal-spinner" aria-hidden="true" />
                <strong>LOADING CONTROL MATRIX</strong>
                <p>Requesting live providers, models, analysts, and defaults.</p>
              </div>
            ) : optionsState.error || !optionsState.options ? (
              <div className="panel-state panel-state--error" role="alert">
                <span>CONFIG // ERR</span>
                <strong>OPTIONS UNAVAILABLE</strong>
                <p>{optionsState.error ?? 'The backend returned no option matrix.'}</p>
                <button type="button" onClick={optionsState.reload}>RETRY OPTIONS</button>
              </div>
            ) : (
              <>
                {storage.mode !== 'firebase' && storage.message && (
                  <div className={`storage-notice storage-notice--${storage.mode}`}>
                    <strong>{storage.mode === 'local' ? 'LOCAL STORAGE MODE' : 'STORAGE WARNING'}</strong>
                    <span>{storage.message}</span>
                  </div>
                )}
                <AnalysisControl
                  options={optionsState.options}
                  disabled={runs.selecting}
                  submitting={runs.submitting}
                  active={runs.active}
                  apiError={runs.formError}
                  onClearApiError={runs.clearFormError}
                  onSubmit={runs.start}
                />
              </>
            )}
          </div>
        </section>

        <section id="intelligence-panel" className="terminal-panel terminal-grid__desk" aria-labelledby="desk-panel-heading">
          <header className="terminal-panel__header">
            <span className="terminal-panel__code">02 // INTELLIGENCE DESK</span>
            <h2 id="desk-panel-heading" className="terminal-panel__title">Live Analysis</h2>
          </header>
          <div className="terminal-panel__body terminal-panel__body--flush">
            <IntelligenceDesk run={runs.run} onCopy={(text, label) => void copy(text, label)} />
          </div>
        </section>

        <section id="archive-panel" className="terminal-panel terminal-grid__history" aria-labelledby="history-panel-heading">
          <header className="terminal-panel__header">
            <span className="terminal-panel__code">03 // ARCHIVE</span>
            <h2 id="history-panel-heading" className="terminal-panel__title">Daily History</h2>
          </header>
          <div className="terminal-panel__body terminal-panel__body--flush">
            <DailyHistory
              history={history}
              selectedRun={runs.run}
              active={runs.active}
              selecting={runs.selecting}
              onSelect={runs.selectArchived}
            />
          </div>
        </section>
      </ResizablePanelGrid>
      <TerminalFooter />
    </div>
  )
}

export function App() {
  return (
    <AuthBoundary>
      <ToastProvider><Workstation /></ToastProvider>
    </AuthBoundary>
  )
}
