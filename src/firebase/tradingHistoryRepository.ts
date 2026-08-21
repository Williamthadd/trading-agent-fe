import {
  Timestamp,
  collection,
  doc,
  getDocs,
  limit,
  onSnapshot,
  query,
  where,
  type DocumentData,
  type DocumentReference,
  type DocumentSnapshot,
  type Firestore,
  type Query,
  type QueryConstraint,
  type QueryDocumentSnapshot,
  type QuerySnapshot,
} from 'firebase/firestore'

import type { RunEvent, TradingRun } from '../api/types'
import { parseLocalDate } from '../utils/date'
import { firestoreDb } from './client'

export const RUNS_COLLECTION = 'trading_runs'
export const EVENTS_SUBCOLLECTION = 'events'

const RUN_ID_PATTERN = /^[0-9a-f]{32}$/u
const ISO_DATE_TIME_PATTERN =
  /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2}))?$/u

export interface FirestoreTradingRun {
  run_id?: string
  ticker?: string
  analysis_date?: string
  output_language?: string
  analysts?: string[]
  research_depth?: 1 | 3 | 5 | number
  llm_provider?: string
  quick_model?: string
  deep_model?: string
  backend_url?: string | null
  thinking_level?: string | null
  reasoning_effort?: string | null
  anthropic_effort?: string | null
  asset_type?: string
  status?: string
  progress?: unknown
  current_phase?: string | null
  current_agent?: string | null
  agent_status?: Record<string, unknown>
  reports?: Record<string, unknown>
  decision?: unknown
  error?: unknown
  created_at?: unknown
  updated_at?: unknown
  started_at?: unknown
  completed_at?: unknown
  duration_seconds?: number
  date_key?: string
  [key: string]: unknown
}

export interface FirestoreRunEvent {
  event_id?: string
  id?: string
  run_id?: string
  created_at?: unknown
  timestamp?: unknown
  sequence?: unknown
  agent?: string
  type?: string
  status?: string
  message?: unknown
  report_key?: string
  content?: unknown
  data?: unknown
  [key: string]: unknown
}

export type Unsubscribe = () => void

export type HistoryErrorCode =
  | 'permission-denied'
  | 'unauthenticated'
  | 'unavailable'
  | 'deadline-exceeded'
  | 'resource-exhausted'
  | 'failed-precondition'
  | 'not-found'
  | 'invalid-argument'
  | 'configuration'
  | 'unknown'

export type HistoryOperation = 'verify-access' | 'subscribe-day' | 'subscribe-run' | 'subscribe-events'

export interface HistoryError {
  readonly code: HistoryErrorCode
  readonly operation: HistoryOperation
  readonly message: string
  readonly retryable: boolean
}

export interface HistorySnapshotInfo {
  /** True until every relevant snapshot in this emission is server-backed. */
  readonly fromCache: boolean
  readonly runFromCache?: boolean
  readonly eventsFromCache?: boolean
  readonly complete?: boolean
}

export interface TradingHistoryRepository {
  verifyReadAccess(userUid: string): Promise<void>
  subscribeDay(
    dateKey: string,
    onData: (runs: TradingRun[], info: HistorySnapshotInfo) => void,
    onError: (error: HistoryError) => void,
  ): Unsubscribe
  subscribeRun(
    runId: string,
    onData: (run: TradingRun | null, info: HistorySnapshotInfo) => void,
    onError: (error: HistoryError) => void,
  ): Unsubscribe
}

export interface ReadDocumentSnapshot {
  readonly id: string
  readonly fromCache: boolean
  exists(): boolean
  data(): unknown
}

export interface ReadQuerySnapshot {
  readonly docs: readonly ReadDocumentSnapshot[]
  readonly fromCache: boolean
}

/**
 * Narrow read-only facade used to unit-test path/query behavior without
 * replacing the production repository with an API-backed fake.
 */
export interface FirestoreReadAdapter {
  collection(...segments: string[]): unknown
  document(...segments: string[]): unknown
  equal(field: string, value: unknown): unknown
  take(count: number): unknown
  buildQuery(base: unknown, constraints: readonly unknown[]): unknown
  getDocuments(target: unknown): Promise<{ readonly fromCache: boolean }>
  listenQuery(
    target: unknown,
    onData: (snapshot: ReadQuerySnapshot) => void,
    onError: (error: unknown) => void,
  ): Unsubscribe
  listenDocument(
    target: unknown,
    onData: (snapshot: ReadDocumentSnapshot) => void,
    onError: (error: unknown) => void,
  ): Unsubscribe
}

class TradingHistoryRepositoryError extends Error implements HistoryError {
  readonly code: HistoryErrorCode
  readonly operation: HistoryOperation
  readonly retryable: boolean

  constructor(code: HistoryErrorCode, operation: HistoryOperation, message: string, retryable = false) {
    super(message)
    this.name = 'TradingHistoryRepositoryError'
    this.code = code
    this.operation = operation
    this.retryable = retryable
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function safeRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {}
}

function normalizedFirebaseCode(error: unknown): string {
  if (!isRecord(error) || typeof error.code !== 'string') return ''
  return error.code.toLowerCase().replace(/^firestore\//u, '')
}

export function normalizeHistoryError(
  error: unknown,
  operation: HistoryOperation,
): HistoryError {
  if (error instanceof TradingHistoryRepositoryError) return error

  const code = normalizedFirebaseCode(error)
  switch (code) {
    case 'permission-denied':
      return new TradingHistoryRepositoryError(
        'permission-denied',
        operation,
        'Firestore access was denied. Verify that the email-only Rules are deployed to the frontend Firebase project.',
      )
    case 'unauthenticated':
      return new TradingHistoryRepositoryError(
        'unauthenticated',
        operation,
        'Firebase authentication is no longer available. Check the current sign-in session.',
        true,
      )
    case 'unavailable':
      return new TradingHistoryRepositoryError(
        'unavailable',
        operation,
        'Firestore is temporarily unavailable. Check the data connection and retry.',
        true,
      )
    case 'deadline-exceeded':
      return new TradingHistoryRepositoryError(
        'deadline-exceeded',
        operation,
        'The Firestore request timed out. Retry when the data connection is stable.',
        true,
      )
    case 'resource-exhausted':
      return new TradingHistoryRepositoryError(
        'resource-exhausted',
        operation,
        'Firestore quota is currently exhausted. Wait before retrying.',
      )
    case 'failed-precondition':
      return new TradingHistoryRepositoryError(
        'failed-precondition',
        operation,
        'Firestore is not configured for this query. Verify the deployed rules and default database.',
      )
    case 'not-found':
      return new TradingHistoryRepositoryError(
        'not-found',
        operation,
        'The selected Firestore run no longer exists.',
      )
    case 'invalid-argument':
      return new TradingHistoryRepositoryError(
        'invalid-argument',
        operation,
        'The Firestore request contains an invalid identifier or date.',
      )
    default:
      return new TradingHistoryRepositoryError(
        'unknown',
        operation,
        'Firestore history could not be loaded. Retry the data connection.',
        true,
      )
  }
}

function invalidArgument(operation: HistoryOperation, message: string): TradingHistoryRepositoryError {
  return new TradingHistoryRepositoryError('invalid-argument', operation, message)
}

function configurationError(operation: HistoryOperation): TradingHistoryRepositoryError {
  return new TradingHistoryRepositoryError(
    'configuration',
    operation,
    'Firestore is not initialized. Complete the public Firebase frontend configuration first.',
  )
}

export function isValidRunId(runId: string): boolean {
  return RUN_ID_PATTERN.test(runId)
}

export function isValidDateKey(dateKey: string): boolean {
  return parseLocalDate(dateKey) !== null
}

function isoFromDate(date: Date): string | null {
  if (!Number.isFinite(date.valueOf())) return null
  try {
    return date.toISOString()
  } catch {
    return null
  }
}

export function normalizeFirestoreTimestamp(value: unknown): string | null {
  if (value instanceof Timestamp) {
    return isoFromDate(value.toDate())
  }
  if (value instanceof Date) {
    return isoFromDate(value)
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null
    const milliseconds = Math.abs(value) < 100_000_000_000 ? value * 1_000 : value
    return isoFromDate(new Date(milliseconds))
  }
  if (typeof value === 'string') {
    if (!ISO_DATE_TIME_PATTERN.test(value) || parseLocalDate(value.slice(0, 10)) === null) return null
    const milliseconds = Date.parse(value)
    return Number.isFinite(milliseconds) ? isoFromDate(new Date(milliseconds)) : null
  }
  return null
}

function isTimestampField(key: string): boolean {
  return key === 'timestamp' || key.endsWith('_at')
}

function normalizeFirestoreValue(
  value: unknown,
  key: string | null,
  ancestors: ReadonlySet<object>,
  depth: number,
): unknown {
  if (key !== null && isTimestampField(key)) {
    return normalizeFirestoreTimestamp(value)
  }
  if (value instanceof Timestamp || value instanceof Date) {
    return normalizeFirestoreTimestamp(value)
  }
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean'
  ) {
    return value
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null
  }
  if (value === undefined || typeof value === 'function' || typeof value === 'symbol') {
    return null
  }
  if (depth >= 32 || (typeof value === 'object' && ancestors.has(value))) {
    return null
  }

  const nextAncestors = new Set(ancestors)
  if (typeof value === 'object' && value !== null) nextAncestors.add(value)

  if (Array.isArray(value)) {
    return value.map((item) => normalizeFirestoreValue(item, null, nextAncestors, depth + 1))
  }
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([entryKey, entryValue]) => [
        entryKey,
        normalizeFirestoreValue(entryValue, entryKey, nextAncestors, depth + 1),
      ]),
    )
  }
  return null
}

export function normalizeFirestoreData(value: unknown): Record<string, unknown> {
  const normalized = normalizeFirestoreValue(safeRecord(value), null, new Set<object>(), 0)
  return isRecord(normalized) ? normalized : {}
}

export function normalizeText(value: unknown): string {
  if (typeof value === 'string') return value
  if (value === null || value === undefined) return ''
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value)
  }
  try {
    return JSON.stringify(value, null, 2) ?? ''
  } catch {
    return '[Unserializable data]'
  }
}

function normalizedString(value: unknown, fallback = ''): string {
  return typeof value === 'string' && value.trim().length > 0 ? value : fallback
}

function optionalString(value: unknown, maximum = 4_096): string | undefined {
  return typeof value === 'string' ? value.slice(0, maximum) : undefined
}

function nullableString(value: unknown, maximum = 4_096): string | null {
  return value === null ? null : optionalString(value, maximum) ?? null
}

function optionalStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  return value
    .filter((item): item is string => typeof item === 'string')
    .slice(0, 128)
    .map((item) => item.slice(0, 256))
}

function normalizeProgress(value: unknown): TradingRun['progress'] | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (!isRecord(value)) return undefined
  const progress: { percent?: number; fraction?: number; value?: number } = {}
  if (typeof value.percent === 'number' && Number.isFinite(value.percent)) progress.percent = value.percent
  if (typeof value.fraction === 'number' && Number.isFinite(value.fraction)) progress.fraction = value.fraction
  if (typeof value.value === 'number' && Number.isFinite(value.value)) progress.value = value.value
  return Object.keys(progress).length > 0 ? progress : undefined
}

function normalizeAgentStatus(
  value: unknown,
): Record<string, string | { status?: string; state?: string }> | undefined {
  if (!isRecord(value)) return undefined
  const entries: Array<[string, string | { status?: string; state?: string }]> = []
  for (const [agent, rawStatus] of Object.entries(value)) {
    if (typeof rawStatus === 'string') {
      entries.push([agent, rawStatus])
      continue
    }
    if (isRecord(rawStatus)) {
      const status = typeof rawStatus.status === 'string' ? rawStatus.status : undefined
      const state = typeof rawStatus.state === 'string' ? rawStatus.state : undefined
      if (status !== undefined || state !== undefined) {
        const normalized: { status?: string; state?: string } = {}
        if (status !== undefined) normalized.status = status
        if (state !== undefined) normalized.state = state
        entries.push([agent, normalized])
        continue
      }
    }
    entries.push([agent, 'unknown'])
  }
  return Object.fromEntries(entries)
}

/** Converts an untrusted run document to the canonical UI shape. */
export function normalizeRunDocument(documentId: string, value: unknown): TradingRun {
  if (!isValidRunId(documentId)) {
    throw invalidArgument('subscribe-run', 'Run IDs must contain exactly 32 lowercase hexadecimal characters.')
  }

  const source = safeRecord(value) as FirestoreTradingRun
  const result = normalizeFirestoreData(source)
  result.run_id = documentId
  result.ticker = normalizedString(source.ticker, 'UNKNOWN').slice(0, 32)
  result.analysis_date = isValidDateKey(normalizedString(source.analysis_date))
    ? source.analysis_date
    : isValidDateKey(normalizedString(source.date_key))
      ? source.date_key
      : ''
  result.status = normalizedString(source.status, 'unknown')

  for (const field of [
    'output_language',
    'llm_provider',
    'quick_model',
    'deep_model',
    'asset_type',
  ] as const) {
    const normalized = optionalString(source[field])
    if (normalized === undefined) delete result[field]
    else result[field] = normalized
  }

  for (const field of [
    'backend_url',
    'thinking_level',
    'reasoning_effort',
    'anthropic_effort',
    'current_phase',
    'current_agent',
  ] as const) {
    result[field] = nullableString(source[field])
  }

  const analysts = optionalStringArray(source.analysts)
  if (analysts === undefined) delete result.analysts
  else result.analysts = analysts

  const progress = normalizeProgress(source.progress)
  if (progress === undefined) delete result.progress
  else result.progress = progress

  const agentStatus = normalizeAgentStatus(source.agent_status)
  if (agentStatus === undefined) delete result.agent_status
  else result.agent_status = agentStatus

  if (typeof source.research_depth !== 'number' || !Number.isFinite(source.research_depth)) {
    delete result.research_depth
  } else result.research_depth = source.research_depth

  if (typeof source.duration_seconds !== 'number' || !Number.isFinite(source.duration_seconds)) {
    delete result.duration_seconds
  } else result.duration_seconds = source.duration_seconds

  if (typeof source.date_key === 'string' && isValidDateKey(source.date_key)) {
    result.date_key = source.date_key
  } else delete result.date_key
  result.reports = { ...safeRecord(result.reports) }
  delete result.events

  // The domain type predates nullable Firestore timestamps. At runtime invalid
  // timestamp fields intentionally remain null, as required by the repository contract.
  return result as unknown as TradingRun
}

function eventId(event: RunEvent): string {
  return typeof event.event_id === 'string' ? event.event_id : typeof event.id === 'string' ? event.id : ''
}

function eventTime(event: RunEvent): number | null {
  const raw = event.created_at ?? event.timestamp
  if (typeof raw !== 'string') return null
  const milliseconds = Date.parse(raw)
  return Number.isFinite(milliseconds) ? milliseconds : null
}

function finiteSequence(event: RunEvent): number | null {
  return typeof event.sequence === 'number' && Number.isFinite(event.sequence) ? event.sequence : null
}

export function compareRunEvents(left: RunEvent, right: RunEvent): number {
  const leftSequence = finiteSequence(left)
  const rightSequence = finiteSequence(right)
  if (leftSequence !== null || rightSequence !== null) {
    if (leftSequence === null) return 1
    if (rightSequence === null) return -1
    if (leftSequence !== rightSequence) return leftSequence - rightSequence
  }

  const leftTime = eventTime(left)
  const rightTime = eventTime(right)
  if (leftTime !== null || rightTime !== null) {
    if (leftTime === null) return 1
    if (rightTime === null) return -1
    if (leftTime !== rightTime) return leftTime - rightTime
  }

  const leftId = eventId(left)
  const rightId = eventId(right)
  return leftId < rightId ? -1 : leftId > rightId ? 1 : 0
}

export function normalizeEventDocument(documentId: string, runId: string, value: unknown): RunEvent {
  const source = safeRecord(value) as FirestoreRunEvent
  const result = normalizeFirestoreData(source)
  result.event_id = documentId
  result.id = documentId
  result.run_id = runId

  const createdAt = normalizeFirestoreTimestamp(source.created_at)
  const timestamp = normalizeFirestoreTimestamp(source.timestamp)
  result.created_at = createdAt ?? timestamp
  result.timestamp = timestamp
  if (typeof source.sequence !== 'number' || !Number.isFinite(source.sequence)) {
    delete result.sequence
  } else {
    result.sequence = source.sequence
  }
  return result as unknown as RunEvent
}

export function normalizeEventDocuments(
  runId: string,
  documents: readonly Pick<ReadDocumentSnapshot, 'id' | 'data'>[],
): RunEvent[] {
  const byDocumentId = new Map<string, RunEvent>()
  for (const documentSnapshot of documents) {
    if (!documentSnapshot.id) continue
    byDocumentId.set(
      documentSnapshot.id,
      normalizeEventDocument(documentSnapshot.id, runId, documentSnapshot.data()),
    )
  }
  return [...byDocumentId.values()].sort(compareRunEvents)
}

/** Rebuilds report bodies stored in the event subcollection. */
export function reconstructCanonicalRun(run: TradingRun, sortedEvents: readonly RunEvent[]): TradingRun {
  const reportEntries = new Map<string, unknown>(Object.entries(safeRecord(run.reports)))
  for (const event of sortedEvents) {
    if (
      event.type === 'report' &&
      typeof event.report_key === 'string' &&
      event.report_key.trim().length > 0
    ) {
      reportEntries.set(event.report_key, normalizeText(event.content))
    }
  }

  return {
    ...run,
    run_id: run.run_id,
    events: [...sortedEvents],
    reports: Object.fromEntries(reportEntries),
  }
}

export function compareHistoryRuns(left: TradingRun, right: TradingRun): number {
  const leftTime = typeof left.created_at === 'string' ? Date.parse(left.created_at) : Number.NaN
  const rightTime = typeof right.created_at === 'string' ? Date.parse(right.created_at) : Number.NaN
  const leftValid = Number.isFinite(leftTime)
  const rightValid = Number.isFinite(rightTime)
  if (leftValid || rightValid) {
    if (!leftValid) return 1
    if (!rightValid) return -1
    if (leftTime !== rightTime) return rightTime - leftTime
  }
  return left.run_id < right.run_id ? 1 : left.run_id > right.run_id ? -1 : 0
}

function wrapDocumentSnapshot(
  snapshot: DocumentSnapshot<DocumentData> | QueryDocumentSnapshot<DocumentData>,
): ReadDocumentSnapshot {
  return {
    id: snapshot.id,
    fromCache: snapshot.metadata.fromCache,
    exists: () => snapshot.exists(),
    data: () => snapshot.data(),
  }
}

function wrapQuerySnapshot(snapshot: QuerySnapshot<DocumentData>): ReadQuerySnapshot {
  return {
    docs: snapshot.docs.map(wrapDocumentSnapshot),
    fromCache: snapshot.metadata.fromCache,
  }
}

function createFirestoreReadAdapter(database: Firestore): FirestoreReadAdapter {
  return {
    collection: (...segments) => collection(database, segments[0] ?? '', ...segments.slice(1)),
    document: (...segments) => doc(database, segments[0] ?? '', ...segments.slice(1)),
    equal: (field, value) => where(field, '==', value),
    take: (count) => limit(count),
    buildQuery: (base, constraints) =>
      query(base as Query<DocumentData>, ...(constraints as QueryConstraint[])),
    getDocuments: async (target) => {
      const snapshot = await getDocs(target as Query<DocumentData>)
      return { fromCache: snapshot.metadata.fromCache }
    },
    listenQuery: (target, onData, onError) =>
      onSnapshot(
        target as Query<DocumentData>,
        { includeMetadataChanges: true },
        (snapshot) => onData(wrapQuerySnapshot(snapshot)),
        onError,
      ),
    listenDocument: (target, onData, onError) =>
      onSnapshot(
        target as DocumentReference<DocumentData>,
        { includeMetadataChanges: true },
        (snapshot) => onData(wrapDocumentSnapshot(snapshot)),
        onError,
      ),
  }
}

function safeErrorCallback(onError: (error: HistoryError) => void, error: HistoryError): void {
  try {
    onError(error)
  } catch {
    // A consumer callback must not escape a Firestore listener invocation.
  }
}

function validateUid(userUid: string): void {
  const containsControlCharacter = [...userUid].some((character) => character.charCodeAt(0) < 32)
  if (userUid.length === 0 || userUid.length > 128 || containsControlCharacter) {
    throw invalidArgument('verify-access', 'The current Firebase user has an invalid UID.')
  }
}

export function createTradingHistoryRepository(
  database: Firestore | null,
  injectedAdapter?: FirestoreReadAdapter,
): TradingHistoryRepository {
  const reads = injectedAdapter ?? (database === null ? null : createFirestoreReadAdapter(database))

  const requireReads = (operation: HistoryOperation): FirestoreReadAdapter => {
    if (database === null || reads === null) throw configurationError(operation)
    return reads
  }

  return {
    async verifyReadAccess(userUid) {
      validateUid(userUid)
      const adapter = requireReads('verify-access')
      const runs = adapter.collection(RUNS_COLLECTION)
      const accessQuery = adapter.buildQuery(runs, [adapter.take(1)])
      try {
        const snapshot = await adapter.getDocuments(accessQuery)
        if (snapshot.fromCache) {
          throw new TradingHistoryRepositoryError(
            'unavailable',
            'verify-access',
            'Firestore access could not be verified by the server. Retry the data connection.',
            true,
          )
        }
      } catch (error) {
        throw normalizeHistoryError(error, 'verify-access')
      }
    },

    subscribeDay(dateKey, onData, onError) {
      if (!isValidDateKey(dateKey)) {
        throw invalidArgument('subscribe-day', 'History dates must be real calendar dates in YYYY-MM-DD format.')
      }
      const adapter = requireReads('subscribe-day')
      const runs = adapter.collection(RUNS_COLLECTION)
      // Intentionally no orderBy: the equality-only query needs no composite index.
      const dayQuery = adapter.buildQuery(runs, [adapter.equal('date_key', dateKey)])
      let active = true
      let unsubscribe: Unsubscribe = () => undefined
      try {
        unsubscribe = adapter.listenQuery(
          dayQuery,
          (snapshot) => {
            if (!active) return
            try {
              const normalized = snapshot.docs
                .filter((documentSnapshot) => isValidRunId(documentSnapshot.id))
                .map((documentSnapshot) =>
                  normalizeRunDocument(documentSnapshot.id, documentSnapshot.data()),
                )
                .sort(compareHistoryRuns)
              onData(normalized, { fromCache: snapshot.fromCache })
            } catch (error) {
              safeErrorCallback(onError, normalizeHistoryError(error, 'subscribe-day'))
            }
          },
          (error) => {
            if (active) safeErrorCallback(onError, normalizeHistoryError(error, 'subscribe-day'))
          },
        )
      } catch (error) {
        safeErrorCallback(onError, normalizeHistoryError(error, 'subscribe-day'))
      }
      return () => {
        if (!active) return
        active = false
        unsubscribe()
      }
    },

    subscribeRun(runId, onData, onError) {
      if (!isValidRunId(runId)) {
        throw invalidArgument('subscribe-run', 'Run IDs must contain exactly 32 lowercase hexadecimal characters.')
      }
      const adapter = requireReads('subscribe-run')
      const runReference = adapter.document(RUNS_COLLECTION, runId)
      const eventsReference = adapter.collection(RUNS_COLLECTION, runId, EVENTS_SUBCOLLECTION)
      let active = true
      let runSnapshotSeen = false
      let eventsSnapshotSeen = false
      let runFromCache = true
      let eventsFromCache = true
      let currentRun: TradingRun | null | undefined
      let currentEvents: RunEvent[] = []
      let unsubscribeRun: Unsubscribe = () => undefined
      let unsubscribeEvents: Unsubscribe = () => undefined

      const failListener = (error: unknown, operation: HistoryOperation): void => {
        if (!active) return
        active = false
        unsubscribeRun()
        unsubscribeEvents()
        safeErrorCallback(onError, normalizeHistoryError(error, operation))
      }

      const snapshotInfo = (): HistorySnapshotInfo => ({
        fromCache: runFromCache || !eventsSnapshotSeen || eventsFromCache,
        runFromCache,
        eventsFromCache,
        complete: runSnapshotSeen && eventsSnapshotSeen,
      })

      const emit = (): void => {
        if (!active || !runSnapshotSeen || currentRun === undefined) return
        try {
          onData(
            currentRun === null ? null : reconstructCanonicalRun(currentRun, currentEvents),
            snapshotInfo(),
          )
        } catch (error) {
          safeErrorCallback(onError, normalizeHistoryError(error, 'subscribe-run'))
        }
      }

      try {
        unsubscribeRun = adapter.listenDocument(
          runReference,
          (snapshot) => {
            if (!active) return
            runSnapshotSeen = true
            runFromCache = snapshot.fromCache
            try {
              currentRun = snapshot.exists() ? normalizeRunDocument(runId, snapshot.data()) : null
              emit()
            } catch (error) {
              safeErrorCallback(onError, normalizeHistoryError(error, 'subscribe-run'))
            }
          },
          (error) => failListener(error, 'subscribe-run'),
        )

        unsubscribeEvents = adapter.listenQuery(
          eventsReference,
          (snapshot) => {
            if (!active) return
            eventsSnapshotSeen = true
            eventsFromCache = snapshot.fromCache
            try {
              currentEvents = normalizeEventDocuments(runId, snapshot.docs)
              emit()
            } catch (error) {
              safeErrorCallback(onError, normalizeHistoryError(error, 'subscribe-events'))
            }
          },
          (error) => failListener(error, 'subscribe-events'),
        )
      } catch (error) {
        failListener(error, 'subscribe-run')
      }

      return () => {
        if (!active) return
        active = false
        unsubscribeRun()
        unsubscribeEvents()
      }
    },
  }
}

export const tradingHistoryRepository = createTradingHistoryRepository(firestoreDb)
