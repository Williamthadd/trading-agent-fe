import type { RunEvent, TradingRun } from '../../src/api/types'

export const RUNS_COLLECTION = 'trading_runs'
export const EVENTS_SUBCOLLECTION = 'events'

export type Unsubscribe = () => void
export interface HistoryError { code: string; operation: string; message: string; retryable: boolean }
export interface HistorySnapshotInfo { fromCache: boolean; complete?: boolean }
export interface TradingHistoryRepository {
  verifyReadAccess(uid: string): Promise<void>
  getLatestHistoryDate(maxDateKey: string): Promise<string | null>
  subscribeDay(
    date: string,
    onData: (runs: TradingRun[], info: HistorySnapshotInfo) => void,
    onError: (error: HistoryError) => void,
  ): Unsubscribe
  subscribeRun(
    runId: string,
    onData: (run: TradingRun | null, info: HistorySnapshotInfo) => void,
    onError: (error: HistoryError) => void,
  ): Unsubscribe
}

declare global {
  interface Window {
    __E2E_FIRESTORE_RUNS__?: TradingRun[]
    __E2E_FIRESTORE_LISTENERS__?: number
  }
}

function data(): TradingRun[] {
  return window.__E2E_FIRESTORE_RUNS__ ?? []
}

function canonical(run: TradingRun): TradingRun {
  const reports = { ...((run.reports && !Array.isArray(run.reports) ? run.reports : {}) as Record<string, unknown>) }
  const events = Array.isArray(run.events) ? [...run.events] : []
  events.sort((left, right) => {
    const leftSequence = typeof left.sequence === 'number' ? left.sequence : Number.POSITIVE_INFINITY
    const rightSequence = typeof right.sequence === 'number' ? right.sequence : Number.POSITIVE_INFINITY
    return leftSequence - rightSequence || String(left.event_id ?? left.id ?? '').localeCompare(String(right.event_id ?? right.id ?? ''))
  })
  for (const event of events as RunEvent[]) {
    if (event.type === 'report' && typeof event.report_key === 'string') {
      reports[event.report_key] = typeof event.content === 'string' ? event.content : JSON.stringify(event.content)
    }
  }
  return { ...run, reports, events }
}

function trackListener(): { active: () => boolean; unsubscribe: Unsubscribe } {
  window.__E2E_FIRESTORE_LISTENERS__ = (window.__E2E_FIRESTORE_LISTENERS__ ?? 0) + 1
  let active = true
  return {
    active: () => active,
    unsubscribe: () => {
      if (!active) return
      active = false
      window.__E2E_FIRESTORE_LISTENERS__ = Math.max(0, (window.__E2E_FIRESTORE_LISTENERS__ ?? 1) - 1)
    },
  }
}

export const tradingHistoryRepository: TradingHistoryRepository = {
  async verifyReadAccess() {},
  async getLatestHistoryDate(maxDateKey) {
    return data()
      .map((run) => run.date_key ?? run.analysis_date)
      .filter((dateKey): dateKey is string =>
        typeof dateKey === 'string' && dateKey <= maxDateKey,
      )
      .sort((left, right) => right.localeCompare(left))[0] ?? null
  },
  subscribeDay(date, onData) {
    const listener = trackListener()
    queueMicrotask(() => {
      if (!listener.active()) return
      const summaries = data()
        .filter((run) => run.date_key === date || run.analysis_date === date)
        .map((run) => {
          const summary = { ...run }
          delete summary.events
          return summary as TradingRun
        })
      onData(summaries, { fromCache: false, complete: true })
    })
    return listener.unsubscribe
  },
  subscribeRun(runId, onData) {
    const listener = trackListener()
    queueMicrotask(() => {
      if (!listener.active()) return
      const run = data().find((candidate) => candidate.run_id === runId)
      onData(run ? canonical(run) : null, { fromCache: false, complete: true })
    })
    return listener.unsubscribe
  },
}
