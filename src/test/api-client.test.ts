import { http, HttpResponse } from 'msw'
import { describe, expect, it, vi } from 'vitest'
import { ApiClient, normalizeApiUrl } from '../api/client'
import { ApiError } from '../api/errors'
import { server } from './server'

describe('ApiClient', () => {
  it('normalizes only safe absolute API origins', () => {
    expect(normalizeApiUrl('http://127.0.0.1:8000/')).toMatchObject({
      ok: true,
      value: 'http://127.0.0.1:8000',
    })
    for (const invalid of [undefined, '', '/api', 'ftp://example.com', 'https://user:pw@example.com', 'https://example.com?x=1', 'https://example.com/#x']) {
      expect(normalizeApiUrl(invalid).ok).toBe(false)
    }
  })

  it('asks for a token immediately before every protected request without persisting it', async () => {
    const tokens = ['token-one', 'token-two']
    const provider = vi.fn(async () => tokens.shift() ?? null)
    const headers: string[] = []
    server.use(
      http.get('http://api.test/api/options', ({ request }) => {
        headers.push(request.headers.get('Authorization') ?? '')
        expect(request.headers.get('Accept')).toBe('application/json')
        expect(request.headers.has('Content-Type')).toBe(false)
        return HttpResponse.json({})
      }),
    )
    const client = new ApiClient('http://api.test')
    client.setAuthTokenProvider(provider)
    await client.getOptions()
    await client.getOptions()
    expect(provider).toHaveBeenCalledTimes(2)
    expect(headers).toEqual(['Bearer token-one', 'Bearer token-two'])
    expect([...Array(localStorage.length)].map((_, index) => localStorage.key(index))).not.toContain('token-one')
  })

  it('sends JSON only for a body and never retries a POST', async () => {
    let requests = 0
    server.use(
      http.post('http://api.test/api/runs', async ({ request }) => {
        requests += 1
        expect(request.headers.get('Content-Type')).toBe('application/json')
        expect(await request.json()).toMatchObject({ ticker: 'NVDA' })
        return HttpResponse.json({ detail: 'queue full' }, { status: 429, headers: { 'Retry-After': '12' } })
      }),
    )
    const client = new ApiClient('http://api.test')
    const controller = new AbortController()
    await expect(client.createRun({
      ticker: 'NVDA', analysis_date: '2026-08-20', output_language: 'en', analysts: ['market'],
      research_depth: 1, llm_provider: 'google', quick_model: 'q', deep_model: 'd',
    }, controller.signal)).rejects.toMatchObject({
      status: 429,
      retryAfter: 12,
      message: 'The analysis queue is full. Please wait before trying again.',
    })
    expect(requests).toBe(1)
  })

  it('normalizes FastAPI validation arrays, non-JSON failures, and unauthorized callbacks', async () => {
    const unauthorized = vi.fn()
    const forbidden = vi.fn()
    server.use(
      http.get('http://api.test/api/options', () => HttpResponse.json({ detail: [{ loc: ['body', 'ticker'], msg: 'invalid symbol', type: 'value_error' }] }, { status: 422 })),
      http.get('http://api.test/api/history', () => new HttpResponse('gateway exploded', { status: 503 })),
      http.get('http://api.test/api/runs/expired', () => HttpResponse.json({ detail: 'expired' }, { status: 401 })),
      http.get('http://api.test/api/runs/forbidden', () => HttpResponse.json({ detail: 'denied' }, { status: 403 })),
    )
    const client = new ApiClient('http://api.test')
    client.setUnauthorizedHandler(unauthorized)
    client.setForbiddenHandler(forbidden)
    await expect(client.getOptions()).rejects.toMatchObject({ status: 422, message: 'ticker: invalid symbol' })
    await expect(client.getHistory('2026-08-20')).rejects.toBeInstanceOf(ApiError)
    await expect(client.getRun('expired')).rejects.toMatchObject({ status: 401 })
    expect(unauthorized).toHaveBeenCalledOnce()
    await expect(client.getRun('forbidden')).rejects.toMatchObject({ status: 403 })
    expect(forbidden).toHaveBeenCalledOnce()
  })
})
