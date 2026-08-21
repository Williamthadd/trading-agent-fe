import { useEffect, useMemo, useRef } from 'react'
import type { TradingRun } from '../api/types'
import { isTerminalStatus, normalizeEvents, safeText } from '../utils/run'

export interface LiveWireProps {
  run: TradingRun | null
}

function eventTime(value: string | null): string {
  if (!value) return '--:--:--'
  const date = new Date(value)
  if (Number.isNaN(date.valueOf())) return value.slice(0, 8)
  return new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(date)
}

export function LiveWire({ run }: LiveWireProps) {
  const events = useMemo(() => normalizeEvents(run), [run])
  const scroller = useRef<HTMLDivElement>(null)
  const following = useRef(true)
  const previousRun = useRef<string | null>(null)
  const active = Boolean(run && !isTerminalStatus(run.status))
  const latest = events.at(-1)

  useEffect(() => {
    if (run?.run_id !== previousRun.current) {
      previousRun.current = run?.run_id ?? null
      following.current = true
    }
  }, [run?.run_id])

  useEffect(() => {
    const node = scroller.current
    if (!node || !following.current) return
    node.scrollTop = node.scrollHeight
  }, [events.length, latest?.id])

  const emptyCopy = !run
    ? 'STANDBY // Launch a cycle or open an archived run.'
    : active
      ? 'INITIALIZING // Waiting for the first agent transmission.'
      : 'ARCHIVED RUN // No persisted wire events were recorded.'

  return (
    <section className="response-wire" aria-labelledby="response-wire-heading">
      <div className="subpanel-heading">
        <span className="subpanel-heading__code">STREAM // 500 MAX</span>
        <h3 id="response-wire-heading">Response Wire</h3>
        <span className="wire-state">{active ? 'LIVE' : run ? 'ARCHIVE' : 'IDLE'}</span>
      </div>
      {run?.error !== undefined && run.error !== null && safeText(run.error).trim() && (
        <div className="run-error-banner" role="alert">
          <strong>RUN ERROR</strong>
          <span>{safeText(run.error, 5_000)}</span>
        </div>
      )}
      <div
        className="wire-scroll"
        ref={scroller}
        tabIndex={0}
        aria-label="Agent response event stream"
        onScroll={(event) => {
          const node = event.currentTarget
          following.current = node.scrollHeight - node.scrollTop - node.clientHeight <= 80
        }}
      >
        {events.length ? (
          <ol className="wire-events">
            {events.map((event) => (
              <li key={event.id} className="wire-event">
                <time dateTime={event.time ?? undefined}>{eventTime(event.time)}</time>
                <strong>{event.agent.toUpperCase()}</strong>
                <p>{event.message}</p>
                {event.status && <span>{event.status.toUpperCase()}</span>}
              </li>
            ))}
          </ol>
        ) : (
          <div className="wire-empty">
            <span className="wire-empty__reticle" aria-hidden="true">＋</span>
            <p>{emptyCopy}</p>
          </div>
        )}
      </div>
      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {latest ? `Latest update from ${latest.agent}: ${latest.message.slice(0, 240)}` : ''}
      </div>
    </section>
  )
}
