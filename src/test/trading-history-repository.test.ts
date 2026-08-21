import { Timestamp, type Firestore } from 'firebase/firestore'
import { describe, expect, it, vi } from 'vitest'

import { extractDecision, isTerminalStatus, normalizeEvents, rawRunSignature } from '../utils/run'
import {
  EVENTS_SUBCOLLECTION,
  RUNS_COLLECTION,
  compareRunEvents,
  createTradingHistoryRepository,
  isValidDateKey,
  isValidRunId,
  normalizeEventDocuments,
  normalizeFirestoreData,
  normalizeFirestoreTimestamp,
  normalizeHistoryError,
  normalizeRunDocument,
  reconstructCanonicalRun,
  type FirestoreReadAdapter,
  type ReadDocumentSnapshot,
  type ReadQuerySnapshot,
} from '../firebase/tradingHistoryRepository'

interface FakeListener<TSnapshot> {
  readonly target: unknown
  readonly onData: (snapshot: TSnapshot) => void
  readonly onError: (error: unknown) => void
  readonly unsubscribe: ReturnType<typeof vi.fn>
}

class FakeReadAdapter implements FirestoreReadAdapter {
  readonly collectionCalls: string[][] = []
  readonly documentCalls: string[][] = []
  readonly buildCalls: Array<{ base: unknown; constraints: readonly unknown[] }> = []
  readonly queryListeners: Array<FakeListener<ReadQuerySnapshot>> = []
  readonly documentListeners: Array<FakeListener<ReadDocumentSnapshot>> = []
  getDocumentsError: unknown = null
  getDocumentsFromCache = false
  listenQueryError: unknown = null
  getDocumentsCalls = 0

  collection(...segments: string[]): unknown {
    this.collectionCalls.push(segments)
    return { kind: 'collection', segments }
  }

  document(...segments: string[]): unknown {
    this.documentCalls.push(segments)
    return { kind: 'document', segments }
  }

  equal(field: string, value: unknown): unknown {
    return { kind: 'equal', field, value }
  }

  take(count: number): unknown {
    return { kind: 'limit', count }
  }

  buildQuery(base: unknown, constraints: readonly unknown[]): unknown {
    this.buildCalls.push({ base, constraints })
    return { kind: 'query', base, constraints }
  }

  async getDocuments(target: unknown): Promise<{ fromCache: boolean }> {
    void target
    this.getDocumentsCalls += 1
    if (this.getDocumentsError !== null) throw this.getDocumentsError
    return { fromCache: this.getDocumentsFromCache }
  }

  listenQuery(
    target: unknown,
    onData: (snapshot: ReadQuerySnapshot) => void,
    onError: (error: unknown) => void,
  ): () => void {
    if (this.listenQueryError !== null) throw this.listenQueryError
    const unsubscribe = vi.fn()
    this.queryListeners.push({ target, onData, onError, unsubscribe })
    return unsubscribe
  }

  listenDocument(
    target: unknown,
    onData: (snapshot: ReadDocumentSnapshot) => void,
    onError: (error: unknown) => void,
  ): () => void {
    const unsubscribe = vi.fn()
    this.documentListeners.push({ target, onData, onError, unsubscribe })
    return unsubscribe
  }
}

function fakeDocument(
  id: string,
  data: unknown,
  options: { exists?: boolean; fromCache?: boolean } = {},
): ReadDocumentSnapshot {
  return {
    id,
    fromCache: options.fromCache ?? false,
    exists: () => options.exists ?? true,
    data: () => data,
  }
}

function repositoryWith(adapter: FakeReadAdapter) {
  return createTradingHistoryRepository({} as Firestore, adapter)
}

const RUN_ID = '1234567890abcdef1234567890abcdef'

describe('tradingHistoryRepository', () => {
  it('exports the fixed schema constants', () => {
    expect(RUNS_COLLECTION).toBe('trading_runs')
    expect(EVENTS_SUBCOLLECTION).toBe('events')
  })

  it('verifies server-authorized history access with one runs query and returns safe errors', async () => {
    const adapter = new FakeReadAdapter()
    const repository = repositoryWith(adapter)

    await repository.verifyReadAccess('firebase-user-1')

    expect(adapter.collectionCalls).toEqual([[RUNS_COLLECTION]])
    expect(adapter.buildCalls[0]?.constraints).toEqual([{ kind: 'limit', count: 1 }])
    expect(adapter.getDocumentsCalls).toBe(1)

    adapter.getDocumentsFromCache = true
    await expect(repository.verifyReadAccess('firebase-user-1')).rejects.toMatchObject({
      code: 'unavailable',
      operation: 'verify-access',
      retryable: true,
    })
    adapter.getDocumentsFromCache = false

    adapter.getDocumentsError = {
      code: 'firestore/permission-denied',
      message: 'secret backend document content',
    }
    await expect(repository.verifyReadAccess('firebase-user-1')).rejects.toMatchObject({
      code: 'permission-denied',
      operation: 'verify-access',
      retryable: false,
    })
    await expect(repository.verifyReadAccess('firebase-user-1')).rejects.not.toThrow(
      /secret backend document content/u,
    )
  })

  it('uses only date_key equality, performs no event reads, and sorts daily cards client-side', () => {
    const adapter = new FakeReadAdapter()
    const repository = repositoryWith(adapter)
    const onData = vi.fn()

    const unsubscribe = repository.subscribeDay('2026-08-21', onData, vi.fn())

    expect(adapter.collectionCalls).toEqual([[RUNS_COLLECTION]])
    expect(adapter.documentCalls).toEqual([])
    expect(adapter.buildCalls[0]?.constraints).toEqual([
      { kind: 'equal', field: 'date_key', value: '2026-08-21' },
    ])
    expect(adapter.queryListeners).toHaveLength(1)

    adapter.queryListeners[0]?.onData({
      fromCache: false,
      docs: [
        fakeDocument('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', {
          run_id: 'ffffffffffffffffffffffffffffffff',
          ticker: 'LATE-ID',
          analysis_date: '2026-08-21',
          date_key: '2026-08-21',
          status: 'completed',
          created_at: '2026-08-21T09:00:00Z',
        }),
        fakeDocument('bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', {
          ticker: 'NEWEST',
          analysis_date: '2026-08-21',
          status: 'completed',
          created_at: Timestamp.fromDate(new Date('2026-08-21T10:00:00Z')),
        }),
        fakeDocument('cccccccccccccccccccccccccccccccc', {
          ticker: 'SAME-TIME-HIGH-ID',
          analysis_date: '2026-08-21',
          status: 'completed',
          created_at: '2026-08-21T09:00:00Z',
        }),
        fakeDocument('not-a-run-id', { ticker: 'MALFORMED' }),
      ],
    })

    const runs = onData.mock.calls[0]?.[0]
    expect(runs.map((run: { ticker: string }) => run.ticker)).toEqual([
      'NEWEST',
      'SAME-TIME-HIGH-ID',
      'LATE-ID',
    ])
    expect(runs[2].run_id).toBe('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')
    expect(onData.mock.calls[0]?.[1]).toEqual({ fromCache: false })

    unsubscribe()
    expect(adapter.queryListeners[0]?.unsubscribe).toHaveBeenCalledOnce()
  })

  it('rejects impossible dates, unsafe run IDs, and missing Firestore configuration locally', () => {
    const adapter = new FakeReadAdapter()
    const repository = repositoryWith(adapter)
    const unconfigured = createTradingHistoryRepository(null)

    expect(isValidDateKey('2024-02-29')).toBe(true)
    expect(isValidDateKey('2026-02-29')).toBe(false)
    expect(isValidRunId(RUN_ID)).toBe(true)
    expect(isValidRunId(RUN_ID.toUpperCase())).toBe(false)
    expect(() => repository.subscribeDay('2026-02-29', vi.fn(), vi.fn())).toThrow(/real calendar dates/u)
    expect(() => repository.subscribeRun('../events', vi.fn(), vi.fn())).toThrow(/32 lowercase/u)
    expect(() => unconfigured.subscribeDay('2026-08-21', vi.fn(), vi.fn())).toThrow(
      /Firestore is not initialized/u,
    )
    expect(adapter.collectionCalls).toEqual([])
    expect(adapter.documentCalls).toEqual([])
  })

  it('normalizes Timestamp, Date, epoch, and ISO fields recursively without mutating inputs', () => {
    const originalDate = new Date('2026-08-21T07:08:09Z')
    const originalMilliseconds = originalDate.valueOf()
    const normalized = normalizeFirestoreData({
      created_at: Timestamp.fromDate(originalDate),
      nested: {
        updated_at: originalDate,
        started_at: 1_700_000_000,
        completed_at: '2026-08-21T08:09:10+00:00',
        invalid_at: '2026-02-30T00:00:00Z',
        dates: [originalDate],
      },
    })

    expect(normalized.created_at).toBe('2026-08-21T07:08:09.000Z')
    expect(normalized).toMatchObject({
      nested: {
        updated_at: '2026-08-21T07:08:09.000Z',
        started_at: '2023-11-14T22:13:20.000Z',
        completed_at: '2026-08-21T08:09:10.000Z',
        invalid_at: null,
        dates: ['2026-08-21T07:08:09.000Z'],
      },
    })
    expect(originalDate.valueOf()).toBe(originalMilliseconds)
    expect(normalizeFirestoreTimestamp(Number.POSITIVE_INFINITY)).toBeNull()
    expect(normalizeFirestoreTimestamp('August 21, 2026')).toBeNull()
  })

  it('normalizes malformed known run fields into a render-safe canonical shape', () => {
    const run = normalizeRunDocument(RUN_ID, {
      ticker: 42,
      analysis_date: '2026-08-21',
      date_key: 'not-a-date',
      status: { unexpected: true },
      current_phase: { unexpected: true },
      current_agent: 7,
      llm_provider: { unexpected: true },
      analysts: ['market', 7, 'news'],
      research_depth: 2,
      duration_seconds: 12.5,
      created_at: 'not-an-iso-date',
    })

    expect(run).toMatchObject({
      run_id: RUN_ID,
      ticker: 'UNKNOWN',
      analysis_date: '2026-08-21',
      status: 'unknown',
      current_phase: null,
      current_agent: null,
      analysts: ['market', 'news'],
      research_depth: 2,
      duration_seconds: 12.5,
      created_at: null,
    })
    expect(run).not.toHaveProperty('date_key')
    expect(run).not.toHaveProperty('llm_provider')
  })

  it('attaches exactly one run listener and one event listener, preserving each valid half', () => {
    const adapter = new FakeReadAdapter()
    const repository = repositoryWith(adapter)
    const onData = vi.fn()
    const onError = vi.fn()

    const unsubscribe = repository.subscribeRun(RUN_ID, onData, onError)

    expect(adapter.documentCalls).toEqual([[RUNS_COLLECTION, RUN_ID]])
    expect(adapter.collectionCalls).toEqual([[RUNS_COLLECTION, RUN_ID, EVENTS_SUBCOLLECTION]])
    expect(adapter.documentListeners).toHaveLength(1)
    expect(adapter.queryListeners).toHaveLength(1)

    adapter.documentListeners[0]?.onData(
      fakeDocument(
        RUN_ID,
        {
          run_id: 'ffffffffffffffffffffffffffffffff',
          ticker: 'NVDA',
          analysis_date: '2026-08-21',
          status: 'running',
          decision: { action: 'BUY', confidence: 0.78 },
        },
        { fromCache: false },
      ),
    )
    expect(onData.mock.calls[0]?.[0]).toMatchObject({ run_id: RUN_ID, ticker: 'NVDA', events: [] })
    expect(onData.mock.calls[0]?.[1]).toMatchObject({ fromCache: true, complete: false })

    adapter.queryListeners[0]?.onData({
      fromCache: false,
      docs: [
        fakeDocument('market-new', {
          event_id: 'conflicting-event-id',
          run_id: 'ffffffffffffffffffffffffffffffff',
          sequence: 2,
          created_at: 1_776_944_400,
          type: 'report',
          report_key: 'market_report',
          content: 'New market report',
        }),
        fakeDocument('market-old', {
          sequence: 1,
          timestamp: new Date('2026-04-23T10:00:00Z'),
          type: 'report',
          report_key: 'market_report',
          content: 'Old market report',
        }),
        fakeDocument('final', {
          sequence: 3,
          created_at: '2026-04-23T12:00:00Z',
          type: 'report',
          report_key: 'final_trade_decision',
          content: '# Final Decision\n\nAccumulate with measured risk.',
        }),
      ],
    })

    const withEvents = onData.mock.calls.at(-1)?.[0]
    expect(withEvents.events.map((event: { event_id: string }) => event.event_id)).toEqual([
      'market-old',
      'market-new',
      'final',
    ])
    expect(withEvents.events[1]).toMatchObject({ event_id: 'market-new', id: 'market-new', run_id: RUN_ID })
    expect(withEvents.reports).toMatchObject({
      market_report: 'New market report',
      final_trade_decision: '# Final Decision\n\nAccumulate with measured risk.',
    })
    expect(extractDecision(withEvents)).toMatchObject({
      signal: 'BUY',
      narrative: '# Final Decision\n\nAccumulate with measured risk.',
    })
    expect(onData.mock.calls.at(-1)?.[1]).toMatchObject({ fromCache: false, complete: true })

    adapter.documentListeners[0]?.onData(
      fakeDocument(RUN_ID, {
        ticker: 'NVDA',
        analysis_date: '2026-08-21',
        status: 'completed',
        decision: { action: 'BUY' },
      }),
    )
    expect(onData.mock.calls.at(-1)?.[0].events).toHaveLength(3)
    expect(onData.mock.calls.at(-1)?.[0].reports.final_trade_decision).toContain('Accumulate')
    expect(onError).not.toHaveBeenCalled()

    unsubscribe()
    unsubscribe()
    expect(adapter.documentListeners[0]?.unsubscribe).toHaveBeenCalledOnce()
    expect(adapter.queryListeners[0]?.unsubscribe).toHaveBeenCalledOnce()

    const callsAfterUnsubscribe = onData.mock.calls.length
    adapter.documentListeners[0]?.onData(fakeDocument(RUN_ID, { ticker: 'STALE' }))
    adapter.queryListeners[0]?.onData({ fromCache: false, docs: [] })
    expect(onData).toHaveBeenCalledTimes(callsAfterUnsubscribe)
  })

  it('preserves events that arrive before the run document snapshot', () => {
    const adapter = new FakeReadAdapter()
    const repository = repositoryWith(adapter)
    const onData = vi.fn()

    repository.subscribeRun(RUN_ID, onData, vi.fn())
    adapter.queryListeners[0]?.onData({
      fromCache: false,
      docs: [
        fakeDocument('report-first', {
          sequence: 1,
          type: 'report',
          report_key: 'market_report',
          content: 'Events arrived first',
        }),
      ],
    })
    expect(onData).not.toHaveBeenCalled()

    adapter.documentListeners[0]?.onData(fakeDocument(RUN_ID, {
      ticker: 'NVDA',
      analysis_date: '2026-08-21',
      status: 'completed',
    }))
    expect(onData).toHaveBeenCalledWith(
      expect.objectContaining({
        reports: { market_report: 'Events arrived first' },
        events: [expect.objectContaining({ event_id: 'report-first' })],
      }),
      expect.objectContaining({ complete: true, fromCache: false }),
    )
  })

  it('deactivates and cleans the first listener if the second listener setup throws', () => {
    const adapter = new FakeReadAdapter()
    adapter.listenQueryError = { code: 'firestore/unavailable' }
    const repository = repositoryWith(adapter)
    const onData = vi.fn()
    const onError = vi.fn()

    const unsubscribe = repository.subscribeRun(RUN_ID, onData, onError)

    expect(adapter.documentListeners[0]?.unsubscribe).toHaveBeenCalledOnce()
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ code: 'unavailable' }))
    adapter.documentListeners[0]?.onData(fakeDocument(RUN_ID, {
      ticker: 'STALE',
      analysis_date: '2026-08-21',
      status: 'running',
    }))
    expect(onData).not.toHaveBeenCalled()
    unsubscribe()
    expect(adapter.documentListeners[0]?.unsubscribe).toHaveBeenCalledOnce()
  })

  it('reports a missing run distinctly and safely normalizes listener failures', () => {
    const adapter = new FakeReadAdapter()
    const repository = repositoryWith(adapter)
    const onData = vi.fn()
    const onError = vi.fn()

    repository.subscribeRun(RUN_ID, onData, onError)
    adapter.documentListeners[0]?.onData(
      fakeDocument(RUN_ID, undefined, { exists: false, fromCache: true }),
    )
    expect(onData).toHaveBeenCalledWith(
      null,
      expect.objectContaining({ fromCache: true, runFromCache: true }),
    )

    adapter.queryListeners[0]?.onError({ code: 'firestore/resource-exhausted', detail: 'private' })
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'resource-exhausted',
        operation: 'subscribe-events',
        retryable: false,
      }),
    )
    expect(onError.mock.calls.at(-1)?.[0].message).not.toContain('private')
    expect(adapter.documentListeners[0]?.unsubscribe).toHaveBeenCalledOnce()
    expect(adapter.queryListeners[0]?.unsubscribe).toHaveBeenCalledOnce()

    const callsAfterFailure = onData.mock.calls.length
    adapter.documentListeners[0]?.onData(fakeDocument(RUN_ID, {
      ticker: 'STALE',
      analysis_date: '2026-08-21',
      status: 'running',
    }))
    expect(onData).toHaveBeenCalledTimes(callsAfterFailure)
  })

  it('stops the event listener when the run-document listener fails terminally', () => {
    const adapter = new FakeReadAdapter()
    const repository = repositoryWith(adapter)
    const onData = vi.fn()
    const onError = vi.fn()

    repository.subscribeRun(RUN_ID, onData, onError)
    adapter.documentListeners[0]?.onError({ code: 'firestore/unavailable' })

    expect(onError).toHaveBeenCalledWith(expect.objectContaining({
      code: 'unavailable',
      operation: 'subscribe-run',
    }))
    expect(adapter.documentListeners[0]?.unsubscribe).toHaveBeenCalledOnce()
    expect(adapter.queryListeners[0]?.unsubscribe).toHaveBeenCalledOnce()
    adapter.queryListeners[0]?.onData({
      fromCache: false,
      docs: [fakeDocument('stale-event', { sequence: 1, message: 'stale' })],
    })
    expect(onData).not.toHaveBeenCalled()
  })

  it('deduplicates event document IDs and sorts finite sequence, then time, then ID', () => {
    const documents = [
      fakeDocument('z', { sequence: 1, created_at: '2026-08-21T10:00:00Z', message: 'replaced' }),
      fakeDocument('a', { sequence: 1, created_at: '2026-08-21T10:00:00Z' }),
      fakeDocument('z', { sequence: 1, created_at: '2026-08-21T10:00:00Z', message: 'latest' }),
      fakeDocument('early', { sequence: 0 }),
      fakeDocument('missing-new', { created_at: '2026-08-21T11:00:00Z' }),
      fakeDocument('missing-old', { created_at: '2026-08-21T09:00:00Z' }),
      fakeDocument('missing-time', { sequence: Number.NaN }),
    ]
    const events = normalizeEventDocuments(RUN_ID, documents)

    expect(events.map((event) => event.event_id)).toEqual([
      'early',
      'a',
      'z',
      'missing-old',
      'missing-new',
      'missing-time',
    ])
    expect(events.find((event) => event.event_id === 'z')?.message).toBe('latest')
    expect([...events].sort(compareRunEvents)).toEqual(events)
  })

  it('keeps missing-sequence events after finite sequences and recognizes terminal aliases', () => {
    const normalized = normalizeEvents({
      run_id: RUN_ID,
      ticker: 'NVDA',
      analysis_date: '2026-08-21',
      status: 'done',
      events: [
        { event_id: 'finite', sequence: 100, message: 'finite' },
        { event_id: 'missing', message: 'missing' },
      ],
    })

    expect(normalized.map((event) => event.id)).toEqual(['finite', 'missing'])
    expect(isTerminalStatus('complete')).toBe(true)
    expect(isTerminalStatus('succeeded')).toBe(true)
    expect(isTerminalStatus('errored')).toBe(true)
  })

  it('lets the latest sorted report event win without mutating the run or events', () => {
    const run = {
      run_id: RUN_ID,
      ticker: 'NVDA',
      analysis_date: '2026-08-21',
      status: 'completed',
      reports: { market_report: 'Run document summary' },
      decision: { action: 'HOLD' },
    }
    const events = normalizeEventDocuments(RUN_ID, [
      fakeDocument('one', { sequence: 1, type: 'report', report_key: 'market_report', content: 'First' }),
      fakeDocument('two', { sequence: 2, type: 'report', report_key: 'market_report', content: 'Second' }),
      fakeDocument('ignored', { sequence: 3, type: 'status', report_key: 'market_report', content: 'Ignored' }),
      fakeDocument('blank', { sequence: 4, type: 'report', report_key: '   ', content: 'Ignored' }),
    ])

    const canonical = reconstructCanonicalRun(run, events)

    expect(canonical.reports).toEqual({ market_report: 'Second' })
    expect(run.reports).toEqual({ market_report: 'Run document summary' })
    expect(canonical.events).not.toBe(events)
  })

  it('invalidates report memoization when a later large report changes beyond the old aggregate cap', () => {
    const first = 'a'.repeat(150_000)
    const second = 'b'.repeat(150_000)
    const baseRun = {
      run_id: RUN_ID,
      ticker: 'NVDA',
      analysis_date: '2026-08-21',
      status: 'completed',
      reports: { first, second },
    }
    const changedSecond = `${second.slice(0, 120_000)}x${second.slice(120_001)}`

    expect(rawRunSignature(baseRun, 'reports')).not.toBe(
      rawRunSignature({ ...baseRun, reports: { first, second: changedSecond } }, 'reports'),
    )
  })

  it('maps connection/configuration error families without exposing raw objects', () => {
    expect(normalizeHistoryError({ code: 'unavailable' }, 'subscribe-day')).toMatchObject({
      code: 'unavailable',
      retryable: true,
    })
    expect(normalizeHistoryError({ code: 'firestore/deadline-exceeded' }, 'subscribe-run')).toMatchObject({
      code: 'deadline-exceeded',
      retryable: true,
    })
    expect(normalizeHistoryError({ code: 'firestore/failed-precondition' }, 'subscribe-day')).toMatchObject({
      code: 'failed-precondition',
      retryable: false,
    })
  })
})
