import { useEffect, useState } from 'react'
import { apiClient } from '../api/client'
import type { HealthResponse } from '../api/types'

export function useHealth(): HealthResponse | null {
  const [health, setHealth] = useState<HealthResponse | null>(null)
  useEffect(() => {
    if (!apiClient) return
    const controller = new AbortController()
    void apiClient.getHealth(controller.signal).then(setHealth).catch(() => undefined)
    return () => controller.abort()
  }, [])
  return health
}
