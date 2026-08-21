import { useCallback, useEffect, useRef, useState } from 'react'
import { apiClient } from '../api/client'
import { readableError } from '../api/errors'
import type { TradingRun } from '../api/types'
import { addLocalDays, toLocalDateKey } from '../utils/date'

export interface HistoryState {
  date: string
  runs: TradingRun[]
  count: number
  loading: boolean
  error: string | null
  setDate: (date: string) => void
  moveDay: (amount: number) => void
  today: () => void
  refresh: () => void
}

export function useHistory(enabled: boolean): HistoryState {
  const [date, setDateState] = useState(toLocalDateKey)
  const [runs, setRuns] = useState<TradingRun[]>([])
  const [count, setCount] = useState(0)
  const [loading, setLoading] = useState(enabled)
  const [error, setError] = useState<string | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)
  const generation = useRef(0)

  useEffect(() => {
    if (!enabled || !apiClient) {
      setLoading(false)
      return
    }
    const requestGeneration = ++generation.current
    const controller = new AbortController()
    setLoading(true)
    setError(null)
    void apiClient
      .getHistory(date, controller.signal)
      .then((response) => {
        if (controller.signal.aborted || requestGeneration !== generation.current) return
        setRuns(response.runs)
        setCount(response.count)
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted || requestGeneration !== generation.current) return
        setError(readableError(cause, 'Unable to load run history.'))
        setRuns([])
        setCount(0)
      })
      .finally(() => {
        if (!controller.signal.aborted && requestGeneration === generation.current) setLoading(false)
      })
    return () => controller.abort()
  }, [date, enabled, refreshKey])

  const setDate = useCallback((next: string) => {
    const today = toLocalDateKey()
    setDateState(next > today ? today : next)
  }, [])

  return {
    date,
    runs,
    count,
    loading,
    error,
    setDate,
    moveDay: (amount) => setDate(addLocalDays(date, amount)),
    today: () => setDate(toLocalDateKey()),
    refresh: () => setRefreshKey((value) => value + 1),
  }
}
