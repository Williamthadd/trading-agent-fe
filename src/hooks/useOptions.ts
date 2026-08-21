import { useEffect, useState } from 'react'
import { apiClient } from '../api/client'
import { readableError } from '../api/errors'
import type { OptionsResponse } from '../api/types'

export interface OptionsState {
  options: OptionsResponse | null
  loading: boolean
  error: string | null
  reload: () => void
}

export function useOptions(enabled: boolean): OptionsState {
  const [options, setOptions] = useState<OptionsResponse | null>(null)
  const [loading, setLoading] = useState(enabled)
  const [error, setError] = useState<string | null>(null)
  const [generation, setGeneration] = useState(0)

  useEffect(() => {
    if (!enabled || !apiClient) {
      setLoading(false)
      return
    }
    const controller = new AbortController()
    let current = true
    setLoading(true)
    setError(null)
    void apiClient
      .getOptions(controller.signal)
      .then((data) => {
        if (!current) return
        setOptions(data)
      })
      .catch((cause: unknown) => {
        if (!current || controller.signal.aborted) return
        setError(readableError(cause, 'Unable to load workstation options.'))
      })
      .finally(() => {
        if (current) setLoading(false)
      })
    return () => {
      current = false
      controller.abort()
    }
  }, [enabled, generation])

  return { options, loading, error, reload: () => setGeneration((value) => value + 1) }
}
