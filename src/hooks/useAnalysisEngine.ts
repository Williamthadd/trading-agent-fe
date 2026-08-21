import { useCallback, useEffect, useRef, useState } from 'react'
import { apiClient as defaultApiClient, apiUrl, type ApiClient } from '../api/client'
import { ApiError, readableError } from '../api/errors'
import type { HealthResponse, OptionsResponse } from '../api/types'
import { parseHealthResponse, parseOptionsResponse } from '../api/validation'

export type AnalysisEngineState =
  | 'checking'
  | 'ready'
  | 'offline'
  | 'forbidden'
  | 'storage-local'
  | 'misconfigured'

export interface AnalysisEngineController {
  state: AnalysisEngineState
  options: OptionsResponse | null
  health: HealthResponse | null
  error: string | null
  fresh: boolean
  canLaunch: boolean
  storageDisconnected: boolean
  retry: () => void
  handleRequestFailure: (error: unknown) => void
}

interface UseAnalysisEngineOptions {
  enabled: boolean
  active: boolean
  getIdToken: (forceRefresh?: boolean) => Promise<string | null>
  client?: ApiClient | null
  requestTimeoutMs?: number
  activeHealthIntervalMs?: number
}

const DEFAULT_TIMEOUT_MS = 4_500
const DEFAULT_ACTIVE_HEALTH_MS = 30_000
const FOCUS_THROTTLE_MS = 30_000
const OFFLINE_BACKOFF_MS = 60_000
export const OPTIONS_CACHE_KEY = 'tradingagents.web.options.v1'

function readCachedOptions(): OptionsResponse | null {
  try {
    const raw = localStorage.getItem(OPTIONS_CACHE_KEY)
    return raw ? parseOptionsResponse(JSON.parse(raw) as unknown) : null
  } catch {
    return null
  }
}

function cacheOptions(options: OptionsResponse): void {
  try {
    localStorage.setItem(OPTIONS_CACHE_KEY, JSON.stringify(options))
  } catch {
    // Display continuity is optional; private browsing and quotas may deny it.
  }
}

function localStorageMode(mode: string | undefined): boolean {
  const normalized = mode?.trim().toLowerCase()
  return normalized === 'local' || normalized === 'local-json' || normalized === 'local_json'
}

function timeoutController(timeoutMs: number): {
  controller: AbortController
  clear: () => void
} {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort('request-timeout'), timeoutMs)
  return { controller, clear: () => clearTimeout(timer) }
}

function engineError(error: unknown): {
  state: Exclude<AnalysisEngineState, 'checking' | 'ready' | 'storage-local'>
  message: string
} {
  if (error instanceof ApiError && error.status === 403) {
    return { state: 'forbidden', message: 'ANALYSIS ACCESS DENIED' }
  }
  if (error instanceof ApiError && error.status === 401) {
    return {
      state: 'misconfigured',
      message: 'ANALYSIS SESSION COULD NOT BE VERIFIED · FIRESTORE HISTORY REMAINS AVAILABLE',
    }
  }
  if (
    error instanceof ApiError &&
    error.status !== null &&
    error.status >= 400 &&
    error.status < 500
  ) {
    return { state: 'misconfigured', message: readableError(error, 'The analysis engine is misconfigured.') }
  }
  return {
    state: 'offline',
    message: 'ANALYSIS ENGINE OFFLINE · LOGIN AND FIRESTORE HISTORY REMAIN AVAILABLE',
  }
}

export function useAnalysisEngine({
  enabled,
  active,
  getIdToken,
  client = defaultApiClient,
  requestTimeoutMs = DEFAULT_TIMEOUT_MS,
  activeHealthIntervalMs = DEFAULT_ACTIVE_HEALTH_MS,
}: UseAnalysisEngineOptions): AnalysisEngineController {
  const [state, setState] = useState<AnalysisEngineState>('checking')
  const [options, setOptions] = useState<OptionsResponse | null>(readCachedOptions)
  const [health, setHealth] = useState<HealthResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [fresh, setFresh] = useState(false)
  const [storageDisconnected, setStorageDisconnected] = useState(false)
  const [generation, setGeneration] = useState(0)
  const mounted = useRef(false)
  const requestGeneration = useRef(0)
  const activeRef = useRef(active)
  const lastProbeAt = useRef(0)

  useEffect(() => {
    activeRef.current = active
  }, [active])

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      requestGeneration.current += 1
    }
  }, [])

  const applyFailure = useCallback((cause: unknown, currentGeneration: number): void => {
    if (!mounted.current || currentGeneration !== requestGeneration.current) return
    const next = engineError(cause)
    setState(next.state)
    setFresh(false)
    setError(next.message)
  }, [])

  const handleRequestFailure = useCallback((cause: unknown): void => {
    if (cause instanceof ApiError && cause.status === 429) return
    const next = engineError(cause)
    setState(next.state)
    setFresh(false)
    setError(next.message)
  }, [])

  const probeHealthOnly = useCallback(async (): Promise<void> => {
    if (!enabled || !client) return
    const currentGeneration = ++requestGeneration.current
    lastProbeAt.current = Date.now()
    const timeout = timeoutController(requestTimeoutMs)
    try {
      const rawHealth: unknown = await client.getHealth(timeout.controller.signal)
      const nextHealth = parseHealthResponse(rawHealth)
      if (!nextHealth) throw new ApiError('The analysis engine returned an invalid health response.', { status: 502 })
      if (!mounted.current || currentGeneration !== requestGeneration.current) return
      setHealth(nextHealth)
      if (localStorageMode(nextHealth.storage.mode)) {
        setStorageDisconnected(true)
        setState('storage-local')
        setFresh(false)
        setError('RUN STORAGE DISCONNECTED · THE BACKEND FELL BACK TO LOCAL JSON')
      }
    } catch (cause) {
      if (timeout.controller.signal.aborted && !mounted.current) return
      applyFailure(cause, currentGeneration)
    } finally {
      timeout.clear()
    }
  }, [applyFailure, client, enabled, requestTimeoutMs])

  useEffect(() => {
    if (!enabled) {
      setState('offline')
      setFresh(false)
      setError(null)
      return
    }
    if (!client) {
      setState('misconfigured')
      setFresh(false)
      setError(apiUrl.message)
      return
    }

    const currentGeneration = ++requestGeneration.current
    lastProbeAt.current = Date.now()
    const timeout = timeoutController(requestTimeoutMs)
    setState('checking')
    setFresh(false)
    setError(null)

    const probe = async (): Promise<void> => {
      try {
        const rawHealth: unknown = await client.getHealth(timeout.controller.signal)
        const nextHealth = parseHealthResponse(rawHealth)
        if (!nextHealth) throw new ApiError('The analysis engine returned an invalid health response.', { status: 502 })
        if (!mounted.current || currentGeneration !== requestGeneration.current) return
        setHealth(nextHealth)

        if (localStorageMode(nextHealth.storage.mode)) {
          setState('storage-local')
          setFresh(false)
          setError('BACKEND STORAGE IS LOCAL · NEW RUNS WOULD NOT APPEAR IN FIRESTORE HISTORY')
          return
        }

        let token = await getIdToken(false)
        if (!token) throw new ApiError('A Firebase session is required for analysis.', { status: 401 })

        let rawOptions: unknown
        try {
          rawOptions = await client.getOptions(timeout.controller.signal, token)
        } catch (cause) {
          if (!(cause instanceof ApiError) || cause.status !== 401) throw cause
          token = await getIdToken(true)
          if (!token) throw cause
          rawOptions = await client.getOptions(timeout.controller.signal, token)
        }

        const nextOptions = parseOptionsResponse(rawOptions)
        if (!nextOptions) {
          throw new ApiError('The analysis engine returned an invalid options schema.', { status: 502 })
        }
        if (!mounted.current || currentGeneration !== requestGeneration.current) return
        setOptions(nextOptions)
        cacheOptions(nextOptions)
        if (localStorageMode(nextOptions.storage.mode) || nextOptions.storage.mode !== 'firebase') {
          setState('storage-local')
          setFresh(false)
          setError('BACKEND STORAGE IS LOCAL · NEW RUNS WOULD NOT APPEAR IN FIRESTORE HISTORY')
          return
        }
        setState('ready')
        setFresh(true)
        setError(null)
        if (!activeRef.current) setStorageDisconnected(false)
      } catch (cause) {
        if (timeout.controller.signal.aborted && !mounted.current) return
        applyFailure(cause, currentGeneration)
      } finally {
        timeout.clear()
      }
    }

    void probe()
    return () => {
      timeout.controller.abort()
      timeout.clear()
    }
  }, [applyFailure, client, enabled, generation, getIdToken, requestTimeoutMs])

  useEffect(() => {
    if (!enabled || !client || !active) return
    const timer = setInterval(() => void probeHealthOnly(), activeHealthIntervalMs)
    return () => clearInterval(timer)
  }, [active, activeHealthIntervalMs, client, enabled, probeHealthOnly])

  useEffect(() => {
    if (!enabled || !client) return
    const onFocus = (): void => {
      if (Date.now() - lastProbeAt.current < FOCUS_THROTTLE_MS) return
      if (activeRef.current) void probeHealthOnly()
      else setGeneration((value) => value + 1)
    }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [client, enabled, probeHealthOnly])

  useEffect(() => {
    if (!enabled || state !== 'offline' || active) return
    const timer = setTimeout(() => setGeneration((value) => value + 1), OFFLINE_BACKOFF_MS)
    return () => clearTimeout(timer)
  }, [active, enabled, state])

  return {
    state,
    options,
    health,
    error,
    fresh,
    canLaunch: state === 'ready' && fresh && options?.storage.mode === 'firebase' && !storageDisconnected,
    storageDisconnected,
    retry: () => {
      if (activeRef.current) void probeHealthOnly()
      else setGeneration((value) => value + 1)
    },
    handleRequestFailure,
  }
}
