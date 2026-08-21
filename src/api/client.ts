import { ApiError, apiErrorFromResponse } from './errors'
import type {
  HealthResponse,
  OptionsResponse,
  RunRequest,
  RunCreateResponse,
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

  constructor(readonly baseUrl: string) {}

  setTokenProvider(provider: TokenProvider): void {
    this.tokenProvider = provider
  }

  setAuthTokenProvider(provider: TokenProvider | null): void {
    this.tokenProvider = provider ?? (async () => null)
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
      throw apiErrorFromResponse(response, data)
    }
    return data as T
  }

  getHealth(signal?: AbortSignal): Promise<HealthResponse> {
    return this.request('/api/health', { signal, noStore: true })
  }

  getOptions(signal?: AbortSignal, token?: string | null): Promise<OptionsResponse> {
    return this.request('/api/options', { protected: true, signal, token, noStore: true })
  }

  createRun(body: RunRequest, signal?: AbortSignal, token?: string | null): Promise<RunCreateResponse> {
    return this.request('/api/runs', {
      method: 'POST',
      protected: true,
      body,
      signal,
      token,
      noStore: true,
    })
  }
}

export const apiUrl = normalizeApiUrl(import.meta.env.VITE_TRADINGAGENTS_API_URL)
export const apiClient = apiUrl.ok && apiUrl.value ? new ApiClient(apiUrl.value) : null
