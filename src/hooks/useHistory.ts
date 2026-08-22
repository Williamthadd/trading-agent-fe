import { useCallback, useEffect, useRef, useState } from 'react'
import type { TradingRun } from '../api/types'
import {
  tradingHistoryRepository,
  type HistoryError,
  type HistorySnapshotInfo,
  type TradingHistoryRepository,
  type Unsubscribe,
} from '../firebase/tradingHistoryRepository'
import { addLocalDays, toLocalDateKey } from '../utils/date'

export type HistorySource = 'checking' | 'cache' | 'server' | 'unavailable'

export interface HistoryState {
  date: string
  runs: TradingRun[]
  count: number
  loading: boolean
  error: string | null
  source: HistorySource
  setDate: (date: string) => void
  moveDay: (amount: number) => void
  today: () => void
  refresh: () => void
  clear: () => void
}

function safeHistoryError(error: HistoryError): string {
  if (typeof error?.message === 'string' && error.message.trim()) return error.message
  return 'Unable to load Firestore run history.'
}

function snapshotSource(info: HistorySnapshotInfo): HistorySource {
  const metadata = info as unknown as { fromCache?: boolean }
  return metadata.fromCache ? 'cache' : 'server'
}

export function useHistory(
  enabled: boolean,
  repository: TradingHistoryRepository = tradingHistoryRepository,
  onAccessFailure?: (error: HistoryError) => void,
): HistoryState {
  const [date, setDateState] = useState(toLocalDateKey)
  const [runs, setRuns] = useState<TradingRun[]>([])
  const [loading, setLoading] = useState(enabled)
  const [error, setError] = useState<string | null>(null)
  const [source, setSource] = useState<HistorySource>(enabled ? 'checking' : 'unavailable')
  const [refreshKey, setRefreshKey] = useState(0)
  const [latestLookupKey, setLatestLookupKey] = useState(0)
  const [dateResolved, setDateResolved] = useState(!enabled)
  const generation = useRef(0)
  const latestDateGeneration = useRef(0)
  const unsubscribeRef = useRef<Unsubscribe | null>(null)

  useEffect(() => {
    const lookupGeneration = ++latestDateGeneration.current

    if (!enabled) {
      setDateResolved(false)
      return
    }

    const maximumDate = toLocalDateKey()
    setDateResolved(false)
    setRuns([])
    setLoading(true)
    setError(null)
    setSource('checking')

    void repository.getLatestHistoryDate(maximumDate)
      .then((latestDate) => {
        if (lookupGeneration !== latestDateGeneration.current) return
        setDateState(latestDate ?? maximumDate)
        setDateResolved(true)
      })
      .catch((cause: HistoryError) => {
        if (lookupGeneration !== latestDateGeneration.current) return
        setRuns([])
        setLoading(false)
        setError(safeHistoryError(cause))
        setSource('unavailable')
        if (cause.code === 'permission-denied' || cause.code === 'unauthenticated') {
          onAccessFailure?.(cause)
        }
      })

    return () => {
      if (lookupGeneration === latestDateGeneration.current) {
        latestDateGeneration.current += 1
      }
    }
  }, [enabled, latestLookupKey, onAccessFailure, repository])

  useEffect(() => {
    unsubscribeRef.current?.()
    unsubscribeRef.current = null
    const listenerGeneration = ++generation.current

    if (!enabled) {
      setRuns([])
      setLoading(false)
      setError(null)
      setSource('unavailable')
      return
    }

    if (!dateResolved) return

    setRuns([])
    setLoading(true)
    setError(null)
    setSource('checking')

    try {
      const unsubscribe = repository.subscribeDay(
        date,
        (nextRuns, info) => {
          if (listenerGeneration !== generation.current) return
          setRuns(nextRuns)
          setLoading(false)
          setError(null)
          setSource(snapshotSource(info))
        },
        (cause) => {
          if (listenerGeneration !== generation.current) return
          setRuns([])
          setLoading(false)
          setError(safeHistoryError(cause))
          setSource('unavailable')
          if (cause.code === 'permission-denied' || cause.code === 'unauthenticated') {
            onAccessFailure?.(cause)
          }
        },
      )
      if (listenerGeneration === generation.current) unsubscribeRef.current = unsubscribe
      else unsubscribe()
    } catch (cause) {
      if (listenerGeneration !== generation.current) return
      setRuns([])
      setLoading(false)
      setError(
        typeof cause === 'object' && cause !== null && 'message' in cause && typeof cause.message === 'string'
          ? cause.message
          : 'Unable to load Firestore run history.',
      )
      setSource('unavailable')
    }

    return () => {
      if (listenerGeneration === generation.current) generation.current += 1
      unsubscribeRef.current?.()
      unsubscribeRef.current = null
    }
  }, [date, dateResolved, enabled, onAccessFailure, refreshKey, repository])

  const setDate = useCallback((next: string) => {
    const today = toLocalDateKey()
    latestDateGeneration.current += 1
    setDateResolved(true)
    setDateState(next > today ? today : next)
  }, [])

  const clear = useCallback(() => {
    generation.current += 1
    latestDateGeneration.current += 1
    unsubscribeRef.current?.()
    unsubscribeRef.current = null
    setDateResolved(false)
    setRuns([])
    setLoading(false)
    setError(null)
    setSource('unavailable')
  }, [])

  const refresh = useCallback(() => {
    if (dateResolved) setRefreshKey((value) => value + 1)
    else setLatestLookupKey((value) => value + 1)
  }, [dateResolved])

  return {
    date,
    runs,
    count: runs.length,
    loading,
    error,
    source,
    setDate,
    moveDay: (amount) => setDate(addLocalDays(date, amount)),
    today: () => setDate(toLocalDateKey()),
    refresh,
    clear,
  }
}
