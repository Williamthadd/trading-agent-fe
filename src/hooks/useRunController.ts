import { useCallback, useEffect, useRef, useState } from 'react'
import { apiClient as defaultApiClient, type ApiClient } from '../api/client'
import { ApiError, readableError } from '../api/errors'
import type { RunRequest, TradingRun } from '../api/types'
import {
  tradingHistoryRepository,
  type HistoryError,
  type HistorySnapshotInfo,
  type TradingHistoryRepository,
  type Unsubscribe,
} from '../firebase/tradingHistoryRepository'
import { isTerminalStatus } from '../utils/run'

export interface RunControllerOptions {
  onToast: (message: string, tone?: 'success' | 'error' | 'info' | 'warning') => void
  onTerminal: (run: TradingRun) => void
  getIdToken: (forceRefresh?: boolean) => Promise<string | null>
  canLaunch: boolean
  onBackendFailure?: (error: unknown) => void
  onFirestoreAccessFailure?: (error: HistoryError) => void
  repository?: TradingHistoryRepository
  client?: ApiClient | null
  propagationGraceMs?: number
}

export type RunSnapshotSource = 'none' | 'cache' | 'server'

export interface RunController {
  run: TradingRun | null
  selectedRunId: string | null
  active: boolean
  submitting: boolean
  selecting: boolean
  propagationPending: boolean
  requiresLaunchConfirmation: boolean
  snapshotSource: RunSnapshotSource
  formError: string | null
  detailWarning: string | null
  start: (request: RunRequest) => Promise<void>
  selectArchived: (runId: string) => Promise<void>
  clear: () => void
  confirmLaunchAfterStorageWarning: () => void
  clearFormError: () => void
}

const DEFAULT_PROPAGATION_GRACE_MS = 8_000
const RUN_ID_PATTERN = /^[0-9a-f]{32}$/
const FIRESTORE_PROPAGATION_MESSAGE =
  'RUN NOT FOUND IN FIRESTORE · THE BACKEND MAY HAVE FALLEN BACK TO LOCAL JSON'

function safeHistoryError(error: HistoryError, fallback: string): string {
  return typeof error?.message === 'string' && error.message.trim() ? error.message : fallback
}

function sourceFromSnapshot(info: HistorySnapshotInfo): RunSnapshotSource {
  return (info as unknown as { fromCache?: boolean }).fromCache ? 'cache' : 'server'
}

export function useRunController({
  onToast,
  onTerminal,
  getIdToken,
  canLaunch,
  onBackendFailure,
  onFirestoreAccessFailure,
  repository = tradingHistoryRepository,
  client = defaultApiClient,
  propagationGraceMs = DEFAULT_PROPAGATION_GRACE_MS,
}: RunControllerOptions): RunController {
  const [run, setRun] = useState<TradingRun | null>(null)
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [selecting, setSelecting] = useState(false)
  const [propagationPending, setPropagationPending] = useState(false)
  const [trackedRunId, setTrackedRunId] = useState<string | null>(null)
  const [requiresLaunchConfirmation, setRequiresLaunchConfirmation] = useState(false)
  const [snapshotSource, setSnapshotSource] = useState<RunSnapshotSource>('none')
  const [formError, setFormError] = useState<string | null>(null)
  const [detailWarning, setDetailWarning] = useState<string | null>(null)
  const [listenerRefreshKey, setListenerRefreshKey] = useState(0)
  const submitLock = useRef(false)
  const mounted = useRef(false)
  const listenerGeneration = useRef(0)
  const requestGeneration = useRef(0)
  const startAbort = useRef<AbortController | null>(null)
  const unsubscribeRef = useRef<Unsubscribe | null>(null)
  const pendingCreatedRunId = useRef<string | null>(null)
  const confirmedRunId = useRef<string | null>(null)
  const missingNotifiedRunId = useRef<string | null>(null)
  const terminalNotified = useRef(new Set<string>())
  const observedStatuses = useRef(new Map<string, string>())
  const toastRef = useRef(onToast)
  const terminalRef = useRef(onTerminal)
  const trackedRunIdRef = useRef<string | null>(null)
  const uncertainRunIdRef = useRef<string | null>(null)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  useEffect(() => {
    toastRef.current = onToast
    terminalRef.current = onTerminal
  }, [onTerminal, onToast])

  const detachCurrentListener = useCallback((): void => {
    listenerGeneration.current += 1
    const unsubscribe = unsubscribeRef.current
    unsubscribeRef.current = null
    unsubscribe?.()
  }, [])

  const markTrackedRunUncertain = useCallback((runId: string, message: string): boolean => {
    if (
      trackedRunIdRef.current !== runId &&
      pendingCreatedRunId.current !== runId
    ) return false

    pendingCreatedRunId.current = null
    confirmedRunId.current = null
    trackedRunIdRef.current = null
    uncertainRunIdRef.current = runId
    setPropagationPending(false)
    setTrackedRunId(null)
    setRequiresLaunchConfirmation(true)
    setDetailWarning(message)
    setFormError(message)
    return true
  }, [])

  const active = trackedRunId !== null && (
    propagationPending ||
    run?.run_id !== trackedRunId ||
    !isTerminalStatus(run.status)
  )

  useEffect(() => {
    unsubscribeRef.current?.()
    unsubscribeRef.current = null
    const currentListenerGeneration = ++listenerGeneration.current
    missingNotifiedRunId.current = null
    let ownedUnsubscribe: Unsubscribe | null = null

    if (!selectedRunId) return
    const runId = selectedRunId
    setSelecting(true)
    setDetailWarning(null)

    try {
      const unsubscribe = repository.subscribeRun(
        runId,
        (nextRun, info) => {
          if (!mounted.current || currentListenerGeneration !== listenerGeneration.current) return
          setSnapshotSource(sourceFromSnapshot(info))
          if (!nextRun) {
            if (
              pendingCreatedRunId.current === runId ||
              info.fromCache ||
              info.complete === false
            ) return
            setRun(null)
            setSelecting(false)
            if (uncertainRunIdRef.current === runId) {
              setDetailWarning(FIRESTORE_PROPAGATION_MESSAGE)
              return
            }
            if (markTrackedRunUncertain(runId, FIRESTORE_PROPAGATION_MESSAGE)) return
            if (missingNotifiedRunId.current !== runId) {
              missingNotifiedRunId.current = runId
              const message = 'This archived Firestore run no longer exists.'
              setDetailWarning(message)
              toastRef.current(message, 'warning')
            }
            return
          }

          const previousStatus = observedStatuses.current.get(runId)
          const wasPendingCreation = pendingCreatedRunId.current === runId
          const wasUncertain = uncertainRunIdRef.current === runId
          confirmedRunId.current = runId
          if (wasPendingCreation) {
            pendingCreatedRunId.current = null
            setPropagationPending(false)
          }
          if (wasUncertain) {
            uncertainRunIdRef.current = null
            setRequiresLaunchConfirmation(false)
            setFormError(null)
            if (!isTerminalStatus(nextRun.status)) {
              trackedRunIdRef.current = runId
              setTrackedRunId(runId)
            }
          }
          observedStatuses.current.set(runId, nextRun.status)
          setRun(nextRun)
          setSelecting(false)
          setDetailWarning(null)

          if (trackedRunIdRef.current === runId && isTerminalStatus(nextRun.status)) {
            trackedRunIdRef.current = null
            setTrackedRunId(null)
          }

          if (
            isTerminalStatus(nextRun.status) &&
            (
              wasPendingCreation ||
              wasUncertain ||
              (previousStatus !== undefined && !isTerminalStatus(previousStatus))
            ) &&
            !terminalNotified.current.has(runId)
          ) {
            terminalNotified.current.add(runId)
            terminalRef.current(nextRun)
            const completed = nextRun.status.toLowerCase() === 'completed'
            toastRef.current(
              completed
                ? `${nextRun.ticker} intelligence cycle completed.`
                : `${nextRun.ticker} run ended with status ${nextRun.status}.`,
              completed ? 'success' : 'error',
            )
          }
        },
        (cause) => {
          if (!mounted.current || currentListenerGeneration !== listenerGeneration.current) return
          setSelecting(false)
          setSnapshotSource('none')
          const message = safeHistoryError(cause, 'Unable to open the Firestore run.')
          if (cause.code === 'permission-denied' || cause.code === 'unauthenticated') {
            setRun(null)
            onFirestoreAccessFailure?.(cause)
          }
          markTrackedRunUncertain(runId, message)
          setDetailWarning(message)
          toastRef.current(message, 'error')
        },
      )
      ownedUnsubscribe = unsubscribe
      if (currentListenerGeneration === listenerGeneration.current) unsubscribeRef.current = unsubscribe
      else unsubscribe()
    } catch (cause) {
      if (currentListenerGeneration !== listenerGeneration.current) return
      setSelecting(false)
      const message =
        cause instanceof Error && cause.message.trim()
          ? cause.message
          : 'Unable to open the Firestore run.'
      markTrackedRunUncertain(runId, message)
      setDetailWarning(message)
      toastRef.current(message, 'error')
    }

    return () => {
      if (currentListenerGeneration === listenerGeneration.current) listenerGeneration.current += 1
      if (unsubscribeRef.current === ownedUnsubscribe) {
        ownedUnsubscribe?.()
        unsubscribeRef.current = null
      }
    }
  }, [listenerRefreshKey, markTrackedRunUncertain, onFirestoreAccessFailure, repository, selectedRunId])

  useEffect(() => {
    if (!propagationPending || !selectedRunId || pendingCreatedRunId.current !== selectedRunId) return
    const runId = selectedRunId
    const timer = setTimeout(() => {
      if (
        !mounted.current ||
        pendingCreatedRunId.current !== runId ||
        confirmedRunId.current === runId
      ) return
      pendingCreatedRunId.current = null
      trackedRunIdRef.current = null
      uncertainRunIdRef.current = runId
      setPropagationPending(false)
      setSelecting(false)
      setTrackedRunId(null)
      setRequiresLaunchConfirmation(true)
      setDetailWarning(FIRESTORE_PROPAGATION_MESSAGE)
      setFormError(FIRESTORE_PROPAGATION_MESSAGE)
      toastRef.current(FIRESTORE_PROPAGATION_MESSAGE, 'warning')
    }, propagationGraceMs)
    return () => clearTimeout(timer)
  }, [propagationGraceMs, propagationPending, selectedRunId])

  const start = useCallback(async (request: RunRequest): Promise<void> => {
    if (submitLock.current) return
    if (trackedRunIdRef.current !== null || pendingCreatedRunId.current !== null) {
      setFormError('Finish the active run before starting another analysis.')
      return
    }
    if (requiresLaunchConfirmation) {
      setFormError('Acknowledge the Firestore storage warning before starting another analysis.')
      return
    }
    if (!client || !canLaunch) {
      setFormError('The analysis engine is not ready. Firestore history remains available.')
      return
    }

    submitLock.current = true
    setSubmitting(true)
    setFormError(null)
    startAbort.current?.abort()
    const controller = new AbortController()
    startAbort.current = controller
    const currentRequestGeneration = ++requestGeneration.current

    try {
      const token = await getIdToken(false)
      if (!token) throw new ApiError('A Firebase session is required for analysis.', { status: 401 })
      const created = await client.createRun(request, controller.signal, token)
      if (
        controller.signal.aborted ||
        !mounted.current ||
        currentRequestGeneration !== requestGeneration.current
      ) return
      if (!RUN_ID_PATTERN.test(created.run_id)) {
        throw new ApiError('The analysis engine returned an invalid run identifier.', { status: 502 })
      }

      detachCurrentListener()
      confirmedRunId.current = null
      pendingCreatedRunId.current = created.run_id
      trackedRunIdRef.current = created.run_id
      uncertainRunIdRef.current = null
      terminalNotified.current.delete(created.run_id)
      observedStatuses.current.delete(created.run_id)
      setRun(null)
      setSelectedRunId(created.run_id)
      setSnapshotSource('none')
      setPropagationPending(true)
      setTrackedRunId(created.run_id)
      setRequiresLaunchConfirmation(false)
      setSelecting(true)
      setDetailWarning(null)
      toastRef.current(`${created.ticker ?? request.ticker} intelligence cycle accepted.`, 'success')
    } catch (cause) {
      if (
        controller.signal.aborted ||
        !mounted.current ||
        currentRequestGeneration !== requestGeneration.current
      ) return
      onBackendFailure?.(cause)
      let message = readableError(cause, 'Unable to launch the intelligence cycle.')
      if (cause instanceof ApiError && cause.status === 429 && cause.retryAfter) {
        message = `${message} Retry after ${cause.retryAfter} seconds.`
      }
      setFormError(message)
      toastRef.current(message, 'error')
    } finally {
      if (mounted.current && currentRequestGeneration === requestGeneration.current) setSubmitting(false)
      if (startAbort.current === controller) {
        startAbort.current = null
        submitLock.current = false
      }
    }
  }, [canLaunch, client, detachCurrentListener, getIdToken, onBackendFailure, requiresLaunchConfirmation])

  const selectArchived = useCallback(async (runId: string): Promise<void> => {
    if (!RUN_ID_PATTERN.test(runId)) {
      toastRef.current('The selected archive has an invalid run identifier.', 'error')
      return
    }
    const trackedId = trackedRunIdRef.current ?? pendingCreatedRunId.current
    if (trackedId !== null && trackedId !== runId) {
      toastRef.current('Finish the active run before opening another archive.', 'warning')
      return
    }
    detachCurrentListener()
    const refreshingTrackedRun = trackedId === runId
    if (!refreshingTrackedRun) {
      pendingCreatedRunId.current = null
      confirmedRunId.current = null
      setPropagationPending(false)
    }
    setFormError(null)
    setDetailWarning(null)
    setRun(null)
    setSnapshotSource('none')
    setSelecting(true)
    if (selectedRunId === runId) {
      setListenerRefreshKey((value) => value + 1)
    } else {
      setSelectedRunId(runId)
    }
  }, [detachCurrentListener, selectedRunId])

  const clear = useCallback(() => {
    listenerGeneration.current += 1
    requestGeneration.current += 1
    startAbort.current?.abort()
    startAbort.current = null
    unsubscribeRef.current?.()
    unsubscribeRef.current = null
    pendingCreatedRunId.current = null
    confirmedRunId.current = null
    trackedRunIdRef.current = null
    uncertainRunIdRef.current = null
    missingNotifiedRunId.current = null
    terminalNotified.current.clear()
    observedStatuses.current.clear()
    submitLock.current = false
    setRun(null)
    setSelectedRunId(null)
    setSubmitting(false)
    setSelecting(false)
    setPropagationPending(false)
    setTrackedRunId(null)
    setRequiresLaunchConfirmation(false)
    setSnapshotSource('none')
    setFormError(null)
    setDetailWarning(null)
  }, [])

  useEffect(
    () => () => {
      listenerGeneration.current += 1
      requestGeneration.current += 1
      startAbort.current?.abort()
      unsubscribeRef.current?.()
      startAbort.current = null
      unsubscribeRef.current = null
      pendingCreatedRunId.current = null
      confirmedRunId.current = null
      trackedRunIdRef.current = null
      uncertainRunIdRef.current = null
      submitLock.current = false
    },
    [],
  )

  return {
    run,
    selectedRunId,
    active,
    submitting,
    selecting,
    propagationPending,
    requiresLaunchConfirmation,
    snapshotSource,
    formError,
    detailWarning,
    start,
    selectArchived,
    clear,
    confirmLaunchAfterStorageWarning: () => {
      setRequiresLaunchConfirmation(false)
      setFormError(null)
      setDetailWarning((current) => current === FIRESTORE_PROPAGATION_MESSAGE ? null : current)
    },
    clearFormError: () => setFormError(null),
  }
}
