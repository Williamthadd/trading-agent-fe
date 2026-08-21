import { renderHook, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it, vi } from 'vitest'
import { ApiClient } from '../api/client'
import { OPTIONS_CACHE_KEY, useAnalysisEngine } from '../hooks/useAnalysisEngine'
import { optionsFixture } from './fixtures'
import { server } from './server'

function health(mode = 'firebase') {
  return {
    status: 'ok',
    service: 'tradingagents-api',
    version: '1.0.0',
    storage: {
      mode,
      backend: mode === 'firebase' ? 'firestore' : 'json',
      configured: true,
      message: mode,
    },
    active_runs: 0,
  }
}

function renderEngine(
  getIdToken = vi.fn(async () => 'token'),
  active = false,
) {
  const client = new ApiClient('http://engine.test')
  return {
    getIdToken,
    ...renderHook(
      ({ isActive }) => useAnalysisEngine({
        enabled: true,
        active: isActive,
        getIdToken,
        client,
        requestTimeoutMs: 250,
        activeHealthIntervalMs: 20,
      }),
      { initialProps: { isActive: active } },
    ),
  }
}

describe('analysis engine state', () => {
  it('requires a fresh, schema-validated Firebase-storage options response before launch', async () => {
    let authorization = ''
    server.use(
      http.get('http://engine.test/api/health', () => HttpResponse.json(health())),
      http.get('http://engine.test/api/options', ({ request }) => {
        authorization = request.headers.get('Authorization') ?? ''
        return HttpResponse.json(optionsFixture)
      }),
    )
    const { result, getIdToken } = renderEngine()
    await waitFor(() => expect(result.current.state).toBe('ready'))
    expect(result.current.canLaunch).toBe(true)
    expect(result.current.fresh).toBe(true)
    expect(authorization).toBe('Bearer token')
    expect(getIdToken).toHaveBeenCalledWith(false)
  })

  it('force-refreshes once after an options 401 without signing out Firestore history', async () => {
    let requests = 0
    const getIdToken = vi.fn(async (force?: boolean) => force ? 'refreshed-token' : 'stale-token')
    server.use(
      http.get('http://engine.test/api/health', () => HttpResponse.json(health())),
      http.get('http://engine.test/api/options', ({ request }) => {
        requests += 1
        if (requests === 1) return HttpResponse.json({ detail: 'expired' }, { status: 401 })
        expect(request.headers.get('Authorization')).toBe('Bearer refreshed-token')
        return HttpResponse.json(optionsFixture)
      }),
    )
    const { result } = renderEngine(getIdToken)
    await waitFor(() => expect(result.current.state).toBe('ready'))
    expect(requests).toBe(2)
    expect(getIdToken.mock.calls.map(([force]) => force)).toEqual([false, true])
  })

  it.each([
    ['offline', () => HttpResponse.error(), 'offline'],
    ['forbidden', () => HttpResponse.json({ detail: 'denied' }, { status: 403 }), 'forbidden'],
  ] as const)('keeps engine %s independent from Firebase history', async (_label, optionsResponse, expected) => {
    server.use(
      http.get('http://engine.test/api/health', () => HttpResponse.json(health())),
      http.get('http://engine.test/api/options', optionsResponse),
    )
    const { result } = renderEngine()
    await waitFor(() => expect(result.current.state).toBe(expected))
    expect(result.current.canLaunch).toBe(false)
  })

  it('disables launch when backend storage is local and detects a mid-run storage fallback', async () => {
    let healthRequests = 0
    server.use(
      http.get('http://engine.test/api/health', () => {
        healthRequests += 1
        return HttpResponse.json(healthRequests === 1 ? health() : health('local-json'))
      }),
      http.get('http://engine.test/api/options', () => HttpResponse.json(optionsFixture)),
    )
    const { result, rerender } = renderEngine(undefined, false)
    await waitFor(() => expect(result.current.state).toBe('ready'))
    rerender({ isActive: true })
    await waitFor(() => expect(result.current.storageDisconnected).toBe(true))
    expect(result.current.state).toBe('storage-local')
    expect(result.current.error).toContain('RUN STORAGE DISCONNECTED')
    expect(result.current.canLaunch).toBe(false)
  })

  it('uses only validated cached options for display and never enables launch from cache', async () => {
    localStorage.setItem(OPTIONS_CACHE_KEY, JSON.stringify(optionsFixture))
    server.use(http.get('http://engine.test/api/health', () => HttpResponse.error()))
    const { result } = renderEngine()
    await waitFor(() => expect(result.current.state).toBe('offline'))
    expect(result.current.options).toMatchObject({ defaults: optionsFixture.defaults })
    expect(result.current.fresh).toBe(false)
    expect(result.current.canLaunch).toBe(false)
  })
})
