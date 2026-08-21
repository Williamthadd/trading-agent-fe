import { useCallback, useEffect, useRef, useState } from 'react'
import { apiClient } from '../api/client'
import { ApiError, readableError } from '../api/errors'
import type { RunRequest, TradingRun } from '../api/types'
import { isTerminalStatus } from '../utils/run'

export interface RunControllerOptions {
  onToast: (message: string, tone?: 'success' | 'error' | 'info' | 'warning') => void
  onTerminal: (run: TradingRun) => void
}

export interface RunController {
  run: TradingRun | null
  active: boolean
  submitting: boolean
  selecting: boolean
  formError: string | null
  start: (request: RunRequest) => Promise<void>
  selectArchived: (runId: string) => Promise<void>
  clear: () => void
  clearFormError: () => void
}

const POLL_INTERVAL = 1_600

export function useRunPolling({ onToast, onTerminal }: RunControllerOptions): RunController {
  const [run, setRun] = useState<TradingRun | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [selecting, setSelecting] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const submitLock = useRef(false)
  const generation = useRef(0)
  const startAbort = useRef<AbortController | null>(null)
  const selectionAbort = useRef<AbortController | null>(null)
  const toastRef = useRef(onToast)
  const terminalRef = useRef(onTerminal)

  useEffect(() => {
    toastRef.current = onToast
    terminalRef.current = onTerminal
  }, [onTerminal, onToast])

  const active = Boolean(run && !isTerminalStatus(run.status))
  const selectedRunId = run?.run_id
  const selectedRunStatus = run?.status

  const start = useCallback(async (request: RunRequest) => {
    if (!apiClient || submitLock.current) return
    submitLock.current = true
    setSubmitting(true)
    setFormError(null)
    selectionAbort.current?.abort()
    startAbort.current?.abort()
    const controller = new AbortController()
    startAbort.current = controller
    const requestGeneration = ++generation.current
    try {
      const created = await apiClient.createRun(request, controller.signal)
      if (requestGeneration !== generation.current) return
      setRun(created)
      toastRef.current(`${created.ticker} intelligence cycle accepted.`, 'success')
      if (isTerminalStatus(created.status)) terminalRef.current(created)
    } catch (cause) {
      if (controller.signal.aborted || requestGeneration !== generation.current) return
      let message = readableError(cause, 'Unable to launch the intelligence cycle.')
      if (cause instanceof ApiError && cause.status === 429 && cause.retryAfter) {
        message = `${message} Retry after ${cause.retryAfter} seconds.`
      }
      setFormError(message)
      toastRef.current(message, 'error')
    } finally {
      if (requestGeneration === generation.current) setSubmitting(false)
      if (startAbort.current === controller) startAbort.current = null
      submitLock.current = false
    }
  }, [])

  const selectArchived = useCallback(
    async (runId: string) => {
      if (!apiClient || (active && run?.run_id !== runId)) {
        if (active) toastRef.current('Finish the active run before opening another archive.', 'warning')
        return
      }
      selectionAbort.current?.abort()
      const controller = new AbortController()
      selectionAbort.current = controller
      const requestGeneration = ++generation.current
      setSelecting(true)
      try {
        const selected = await apiClient.getHistoryRun(runId, controller.signal)
        if (controller.signal.aborted || requestGeneration !== generation.current) return
        setRun(selected)
        if (!isTerminalStatus(selected.status)) {
          toastRef.current('Resumed monitoring the archived active run.', 'info')
        }
      } catch (cause) {
        if (controller.signal.aborted || requestGeneration !== generation.current) return
        toastRef.current(readableError(cause, 'Unable to open the archived run.'), 'error')
      } finally {
        if (!controller.signal.aborted && requestGeneration === generation.current) setSelecting(false)
      }
    },
    [active, run?.run_id],
  )

  const clear = useCallback(() => {
    ++generation.current
    startAbort.current?.abort()
    selectionAbort.current?.abort()
    setRun(null)
    setSubmitting(false)
    setSelecting(false)
    setFormError(null)
    submitLock.current = false
  }, [])

  useEffect(() => {
    if (!apiClient || !selectedRunId || isTerminalStatus(selectedRunStatus)) return
    const client = apiClient
    const runId = selectedRunId
    const pollingGeneration = generation.current
    let controller: AbortController | null = null
    let timer: ReturnType<typeof setTimeout> | null = null
    let disposed = false
    let failureCount = 0

    const schedule = (delay: number): void => {
      if (!disposed) timer = setTimeout(() => void poll(), delay)
    }
    const poll = async (): Promise<void> => {
      controller = new AbortController()
      try {
        const next = await client.getRun(runId, controller.signal)
        if (disposed || pollingGeneration !== generation.current || next.run_id !== runId) return
        failureCount = 0
        setRun(next)
        if (isTerminalStatus(next.status)) {
          terminalRef.current(next)
          toastRef.current(
            next.status.toLowerCase() === 'completed'
              ? `${next.ticker} intelligence cycle completed.`
              : `${next.ticker} run ended with status ${next.status}.`,
            next.status.toLowerCase() === 'completed' ? 'success' : 'error',
          )
          return
        }
        schedule(POLL_INTERVAL)
      } catch (cause) {
        if (disposed || controller.signal.aborted || pollingGeneration !== generation.current) return
        failureCount += 1
        if (failureCount === 1 || failureCount % 5 === 0) {
          toastRef.current(
            `Live update interrupted (${failureCount}). Retrying automatically. ${readableError(cause)}`,
            'warning',
          )
        }
        schedule(Math.min(10_000, 2_500 + failureCount * 1_000))
      }
    }

    schedule(POLL_INTERVAL)
    return () => {
      disposed = true
      if (timer) clearTimeout(timer)
      controller?.abort()
    }
  }, [selectedRunId, selectedRunStatus])

  useEffect(
    () => () => {
      ++generation.current
      startAbort.current?.abort()
      selectionAbort.current?.abort()
    },
    [],
  )

  return {
    run,
    active,
    submitting,
    selecting,
    formError,
    start,
    selectArchived,
    clear,
    clearFormError: () => setFormError(null),
  }
}
