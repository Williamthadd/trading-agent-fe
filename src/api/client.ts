import { ApiError, apiErrorFromResponse } from './errors'
import type {
  AuthConfigResponse,
  HealthResponse,
  HistoryResponse,
  OptionsResponse,
  RunRequest,
  SessionResponse,
  TradingRun,
} from './types'

export interface ApiUrlResult {
  ok: boolean
  value: string | null
  message: string | null
}

export type TokenProvider = () => Promise<string | null>

export function normalizeApiUrl(raw: string | undefined): ApiUrlResult {
  const candidate = raw?.trim()
  if (!candidate) {
    return {
      ok: false,
      value: null,
      message:
        'Set VITE_TRADINGAGENTS_API_URL to the absolute HTTP(S) origin of the TradingAgents API.',
    }
  }
  try {
    const url = new URL(candidate)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new Error('unsupported protocol')
    }
    if (url.username || url.password || url.search || url.hash) {
      throw new Error('credentials, query strings, and fragments are not allowed')
    }
    const pathname = url.pathname.replace(/\/+$/, '')
    if (pathname && pathname !== '/') {
      throw new Error('the URL must not include an API path')
    }
    return { ok: true, value: url.origin, message: null }
  } catch {
    return {
      ok: false,
      value: null,
      message:
        'VITE_TRADINGAGENTS_API_URL must be an absolute HTTP(S) origin without credentials, a path, query string, or fragment.',
    }
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST' | undefined
  protected?: boolean | undefined
  body?: unknown
  signal?: AbortSignal | undefined
  noStore?: boolean | undefined
  token?: string | null | undefined
}

export class ApiClient {
  private tokenProvider: TokenProvider = async () => null
  private unauthorizedHandler: (() => void | Promise<void>) | null = null
  private forbiddenHandler: (() => void | Promise<void>) | null = null

  constructor(readonly baseUrl: string) {}

  setTokenProvider(provider: TokenProvider): void {
    this.tokenProvider = provider
  }

  setAuthTokenProvider(provider: TokenProvider | null): void {
    this.tokenProvider = provider ?? (async () => null)
  }

  setUnauthorizedHandler(handler: (() => void | Promise<void>) | null): void {
    this.unauthorizedHandler = handler
  }

  setForbiddenHandler(handler: (() => void | Promise<void>) | null): void {
    this.forbiddenHandler = handler
  }

  async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const headers = new Headers({ Accept: 'application/json' })
    if (options.body !== undefined) headers.set('Content-Type', 'application/json')

    if (options.protected) {
      const token = options.token !== undefined ? options.token : await this.tokenProvider()
      if (token) headers.set('Authorization', `Bearer ${token}`)
    }

    let response: Response
    try {
      const init: RequestInit = {
        method: options.method ?? 'GET',
        headers,
        cache: options.noStore ? 'no-store' : 'default',
      }
      if (options.body !== undefined) init.body = JSON.stringify(options.body)
      if (options.signal) init.signal = options.signal
      response = await fetch(`${this.baseUrl}${path}`, init)
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') throw error
      throw new ApiError('Unable to reach the TradingAgents API. Check that the backend is running.', {
        cause: error,
      })
    }

    const text = await response.text()
    let data: unknown = undefined
    if (text) {
      try {
        data = JSON.parse(text)
      } catch {
        data = text
      }
    }

    if (!response.ok) {
      if (response.status === 401 && this.unauthorizedHandler) {
        await this.unauthorizedHandler()
      }
      if (response.status === 403 && this.forbiddenHandler) {
        await this.forbiddenHandler()
      }
      throw apiErrorFromResponse(response, data)
    }
    return data as T
  }

  getAuthConfig(signal?: AbortSignal): Promise<AuthConfigResponse> {
    return this.request('/api/auth/config', { signal, noStore: true })
  }

  getSession(
    options: {
      signal?: AbortSignal | undefined
      token?: string | null | undefined
      protected?: boolean | undefined
    } = {},
  ): Promise<SessionResponse> {
    return this.request('/api/auth/session', {
      protected: options.protected ?? options.token !== null,
      token: options.token,
      signal: options.signal,
      noStore: true,
    })
  }

  getHealth(signal?: AbortSignal): Promise<HealthResponse> {
    return this.request('/api/health', { signal, noStore: true })
  }

  getOptions(signal?: AbortSignal): Promise<OptionsResponse> {
    return this.request('/api/options', { protected: true, signal })
  }

  createRun(body: RunRequest, signal?: AbortSignal): Promise<TradingRun> {
    return this.request('/api/runs', {
      method: 'POST',
      protected: true,
      body,
      signal,
      noStore: true,
    })
  }

  getRun(runId: string, signal?: AbortSignal): Promise<TradingRun> {
    return this.request(`/api/runs/${encodeURIComponent(runId)}`, {
      protected: true,
      signal,
      noStore: true,
    })
  }

  getHistory(date: string, signal?: AbortSignal): Promise<HistoryResponse> {
    const params = new URLSearchParams({ date })
    return this.request(`/api/history?${params}`, { protected: true, signal })
  }

  getHistoryRun(runId: string, signal?: AbortSignal): Promise<TradingRun> {
    return this.request(`/api/history/${encodeURIComponent(runId)}`, {
      protected: true,
      signal,
      noStore: true,
    })
  }
}

export const apiUrl = normalizeApiUrl(import.meta.env.VITE_TRADINGAGENTS_API_URL)
export const apiClient = apiUrl.ok && apiUrl.value ? new ApiClient(apiUrl.value) : null
