import { useCallback, useEffect, useState } from 'react'
import type { OptionsResponse } from '../api/types'
import { AuthBoundary, useAuth } from '../auth'
import { AnalysisControl } from '../components/AnalysisControl'
import { DailyHistory } from '../components/DailyHistory'
import { IntelligenceDesk } from '../components/IntelligenceDesk'
import { ResizablePanelGrid } from '../components/ResizablePanelGrid'
import { TerminalFooter } from '../components/TerminalFooter'
import { TerminalHeader, type TerminalSessionStatus } from '../components/TerminalHeader'
import { TickerRibbon } from '../components/TickerRibbon'
import { ToastProvider, useToast, type ToastTone } from '../components/ToastProvider'
import { useAnalysisEngine, type AnalysisEngineState } from '../hooks/useAnalysisEngine'
import { useHistory, type HistorySource } from '../hooks/useHistory'
import { useRunController, type RunSnapshotSource } from '../hooks/useRunController'
import { toLocalDateKey } from '../utils/date'

const HISTORY_ONLY_OPTIONS: OptionsResponse = {
  analysts: [
    { id: 'market', label: 'Market' },
    { id: 'social', label: 'Social' },
    { id: 'news', label: 'News' },
    { id: 'fundamentals', label: 'Fundamentals' },
  ],
  research_depths: [
    { id: 1, label: 'Quick', description: 'Runtime unavailable' },
    { id: 3, label: 'Standard', description: 'Runtime unavailable' },
    { id: 5, label: 'Deep', description: 'Runtime unavailable' },
  ],
  providers: [{
    id: 'unavailable',
    label: 'Runtime options unavailable',
    quick_models: [{ id: 'unavailable', label: 'Unavailable' }],
    deep_models: [{ id: 'unavailable', label: 'Unavailable' }],
    default_quick_model: 'unavailable',
    default_deep_model: 'unavailable',
    supports_backend_url: false,
    requires_backend_url: false,
  }],
  output_languages: [{ id: 'en', label: 'English' }],
  languages: [],
  defaults: {
    ticker: 'NVDA',
    analysis_date: toLocalDateKey(),
    output_language: 'en',
    analysts: ['market', 'news', 'fundamentals'],
    research_depth: 3,
    llm_provider: 'unavailable',
    quick_model: 'unavailable',
    deep_model: 'unavailable',
    backend_url: null,
  },
  storage: {
    mode: 'unavailable',
    backend: 'FastAPI offline',
    configured: false,
    message: 'Display-only HISTORY ONLY controls.',
  },
}

function engineNotice(
  state: AnalysisEngineState,
  error: string | null,
  storageDisconnected: boolean,
): { title: string; message: string; tone: 'warning' | 'error' } | null {
  if (storageDisconnected) {
    return {
      title: 'RUN STORAGE DISCONNECTED',
      message: 'THE BACKEND FELL BACK TO LOCAL JSON',
      tone: 'error',
    }
  }
  switch (state) {
    case 'checking':
    case 'ready':
      return null
    case 'offline':
      return {
        title: 'ANALYSIS ENGINE OFFLINE',
        message: 'LOGIN AND FIRESTORE HISTORY REMAIN AVAILABLE',
        tone: 'warning',
      }
    case 'forbidden':
      return {
        title: 'ANALYSIS ACCESS DENIED',
        message: 'THIS ACCOUNT CAN STILL USE FIRESTORE HISTORY',
        tone: 'error',
      }
    case 'storage-local':
      return {
        title: 'BACKEND STORAGE IS LOCAL',
        message: 'NEW RUNS WOULD NOT APPEAR IN FIRESTORE HISTORY',
        tone: 'warning',
      }
    case 'misconfigured':
      return {
        title: 'ANALYSIS ENGINE UNAVAILABLE',
        message: error ?? 'CHECK THE PUBLIC API ORIGIN AND FIREBASE SESSION',
        tone: 'error',
      }
  }
}

export function firestoreStorage(
  source: HistorySource,
  selectedSource: RunSnapshotSource,
  storageDisconnected = false,
) {
  if (storageDisconnected) {
    return {
      mode: 'disconnected',
      backend: 'Cloud Firestore',
      configured: false,
      message: 'Backend writes disconnected; retaining the last confirmed Firestore snapshot.',
    }
  }
  const effective = selectedSource !== 'none' ? selectedSource : source
  if (effective === 'server') {
    return {
      mode: 'firebase',
      backend: 'Cloud Firestore',
      configured: true,
      message: 'Server-backed snapshot confirmed.',
    }
  }
  if (effective === 'cache') {
    return {
      mode: 'cache',
      backend: 'Cloud Firestore',
      configured: true,
      message: 'Memory-cache snapshot; waiting for the server.',
    }
  }
  if (effective === 'checking') {
    return {
      mode: 'checking',
      backend: 'Cloud Firestore',
      configured: true,
      message: 'Waiting for the selected history query.',
    }
  }
  return {
    mode: 'unavailable',
    backend: 'Cloud Firestore',
    configured: false,
    message: 'The current Firestore listener is unavailable.',
  }
}

function Workstation() {
  const auth = useAuth()
  const { showToast, clearToasts } = useToast()
  const history = useHistory(true, undefined, auth.revalidateFirestoreAccess)
  const [monitorActiveRun, setMonitorActiveRun] = useState(false)
  const engine = useAnalysisEngine({
    enabled: true,
    active: monitorActiveRun,
    getIdToken: auth.getIdToken,
  })

  const notify = useCallback(
    (message: string, tone: ToastTone = 'info') => {
      showToast(message, { tone })
    },
    [showToast],
  )

  const runs = useRunController({
    onToast: notify,
    onTerminal: () => undefined,
    getIdToken: auth.getIdToken,
    canLaunch: engine.canLaunch,
    onBackendFailure: engine.handleRequestFailure,
    onFirestoreAccessFailure: auth.revalidateFirestoreAccess,
  })

  useEffect(() => {
    setMonitorActiveRun(runs.active)
  }, [runs.active])

  const registerProtectedCleanup = auth.registerProtectedCleanup
  const clearRuns = runs.clear
  const clearHistory = history.clear
  useEffect(
    () => registerProtectedCleanup(() => {
      clearRuns()
      clearHistory()
      clearToasts()
    }),
    [clearHistory, clearRuns, clearToasts, registerProtectedCleanup],
  )

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
    history.clear()
    clearToasts()
    await auth.logout()
  }

  const notice = engineNotice(engine.state, engine.error, engine.storageDisconnected)
  const storage = firestoreStorage(history.source, runs.snapshotSource, engine.storageDisconnected)
  const sessionStatus: TerminalSessionStatus =
    engine.state === 'checking'
      ? 'INITIALIZING'
      : engine.state === 'ready'
        ? runs.active ? 'RUNNING' : 'READY'
        : 'HISTORY ONLY'

  return (
    <div className="terminal-app">
      <TerminalHeader
        sessionStatus={sessionStatus}
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
            {notice && (
              <div className={`engine-notice engine-notice--${notice.tone}`} role={notice.tone === 'error' ? 'alert' : 'status'}>
                <strong>{notice.title}</strong>
                <span>{notice.message}</span>
                <button type="button" onClick={engine.retry}>RETRY ENGINE</button>
              </div>
            )}
            {engine.state === 'checking' && !engine.options && (
              <div className="panel-state" aria-live="polite">
                <span className="terminal-spinner" aria-hidden="true" />
                <strong>CHECKING ANALYSIS ENGINE</strong>
                <p>Firestore history is independent and remains available during this check.</p>
              </div>
            )}
            <AnalysisControl
              key={engine.options ? 'runtime-options' : 'history-only-options'}
              options={engine.options ?? HISTORY_ONLY_OPTIONS}
              disabled={
                !engine.options ||
                !engine.canLaunch ||
                runs.selecting ||
                runs.requiresLaunchConfirmation
              }
              submitting={runs.submitting}
              active={runs.active}
              persistPreferences={Boolean(engine.options)}
              apiError={runs.formError}
              onClearApiError={runs.clearFormError}
              onSubmit={runs.start}
            />
          </div>
        </section>

        <section id="intelligence-panel" className="terminal-panel terminal-grid__desk" aria-labelledby="desk-panel-heading">
          <header className="terminal-panel__header">
            <span className="terminal-panel__code">02 // INTELLIGENCE DESK</span>
            <h2 id="desk-panel-heading" className="terminal-panel__title">Live Analysis</h2>
          </header>
          <div className="terminal-panel__body terminal-panel__body--flush">
            {(engine.storageDisconnected || runs.detailWarning || runs.requiresLaunchConfirmation) && (
              <div className="run-detail-warning" role="alert">
                <span>
                  {engine.storageDisconnected
                    ? 'RUN STORAGE DISCONNECTED · THE BACKEND FELL BACK TO LOCAL JSON'
                    : runs.detailWarning ?? 'PREVIOUS LAUNCH WAS NOT CONFIRMED IN FIRESTORE'}
                </span>
                {runs.requiresLaunchConfirmation && (
                  <button type="button" onClick={runs.confirmLaunchAfterStorageWarning}>
                    ACKNOWLEDGE BEFORE NEW LAUNCH
                  </button>
                )}
              </div>
            )}
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
