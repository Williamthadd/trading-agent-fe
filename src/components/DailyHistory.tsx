import type { TradingRun } from '../api/types'
import type { HistoryState } from '../hooks/useHistory'
import { formatLocalDate, toLocalDateKey } from '../utils/date'
import { displayStatus, normalizeStatus } from '../utils/run'

export interface DailyHistoryProps {
  history: HistoryState
  selectedRun: TradingRun | null
  active: boolean
  selecting?: boolean
  onSelect: (runId: string) => void | Promise<void>
}

function runTime(run: TradingRun): string {
  const source = run.completed_at ?? run.updated_at ?? run.created_at
  if (!source) return '--:--'
  const date = new Date(source)
  if (Number.isNaN(date.valueOf())) return '--:--'
  return new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date)
}

export function DailyHistory({
  history,
  selectedRun,
  active,
  selecting = false,
  onSelect,
}: DailyHistoryProps) {
  const today = toLocalDateKey()
  return (
    <div className="daily-history">
      <div className="history-toolbar" aria-label="History date navigation">
        <button type="button" onClick={() => history.moveDay(-1)} aria-label="Previous day">‹</button>
        <input
          type="date"
          value={history.date}
          max={today}
          onChange={(event) => history.setDate(event.target.value)}
          aria-label="History date"
        />
        <button
          type="button"
          onClick={() => history.moveDay(1)}
          disabled={history.date >= today}
          aria-label="Next day"
        >›</button>
        <button type="button" onClick={history.today} disabled={history.date === today}>TODAY</button>
        <button
          type="button"
          onClick={history.refresh}
          disabled={history.loading}
          aria-label="Refresh daily history"
        >↻</button>
      </div>
      <div className="history-summary">
        <strong>{history.count.toString().padStart(2, '0')} RUNS</strong>
        <span>
          {formatLocalDate(history.date).toUpperCase()} · {history.source === 'server' ? 'FIREBASE LIVE' : history.source.toUpperCase()}
        </span>
      </div>
      {history.error && <div className="history-error" role="alert">{history.error}</div>}
      {history.loading ? (
        <div className="history-empty" aria-live="polite">
          <span className="terminal-spinner" aria-hidden="true" />
          <p>QUERYING ARCHIVE…</p>
        </div>
      ) : history.runs.length ? (
        <ol className="history-list">
          {history.runs.map((run) => {
            const selected = selectedRun?.run_id === run.run_id
            const conflict = active && !selected
            const summary = run.llm_provider
              ? `${run.llm_provider}${run.quick_model ? ` / ${run.quick_model}` : ''}`
              : run.current_phase ?? run.current_agent ?? 'Persisted analysis'
            return (
              <li key={run.run_id}>
                <button
                  type="button"
                  className={`history-card history-card--${normalizeStatus(run.status)}`}
                  onClick={() => void onSelect(run.run_id)}
                  disabled={conflict || selecting}
                  aria-current={selected ? 'true' : undefined}
                  title={conflict ? 'Another run is currently active' : `Open ${run.ticker} run`}
                >
                  <span className="history-card__topline">
                    <strong>${run.ticker}</strong>
                    <span><i className="status-dot" aria-hidden="true" /> {displayStatus(run.status)}</span>
                  </span>
                  <span className="history-card__meta">
                    <time dateTime={run.created_at ?? run.analysis_date}>{runTime(run)}</time>
                    <code>{run.run_id.slice(0, 8).toUpperCase()}</code>
                  </span>
                  <span className="history-card__summary">{summary}</span>
                </button>
              </li>
            )
          })}
        </ol>
      ) : (
        <div className="history-empty">
          <span aria-hidden="true">□</span>
          <p>NO RUNS ARCHIVED FOR THIS DATE</p>
        </div>
      )}
      {active && (
        <p className="history-lock-note">ARCHIVE LOCKED WHILE RUN {selectedRun?.run_id.slice(0, 8).toUpperCase()} IS ACTIVE</p>
      )}
    </div>
  )
}
