import { StrictMode, type ReactNode } from 'react'
import { act, renderHook } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RunRequest } from '../api/types'
import { useRunPolling } from '../hooks/useRunPolling'
import { activeRunFixture, completedRunFixture } from './fixtures'
import { server } from './server'

const request: RunRequest = {
  ticker: 'NVDA',
  analysis_date: '2026-08-20',
  output_language: 'en',
  analysts: ['market'],
  research_depth: 3,
  llm_provider: 'google',
  quick_model: 'gemini-quick',
  deep_model: 'gemini-deep',
}

afterEach(() => vi.useRealTimers())

describe('useRunPolling', () => {
  it('prevents duplicate POSTs under rapid submit and React StrictMode', async () => {
    let posts = 0
    server.use(
      http.post('http://127.0.0.1:8000/api/runs', () => {
        posts += 1
        return HttpResponse.json(activeRunFixture, { status: 202 })
      }),
    )
    const wrapper = ({ children }: { children: ReactNode }) => <StrictMode>{children}</StrictMode>
    const { result, unmount } = renderHook(
      () => useRunPolling({ onToast: vi.fn(), onTerminal: vi.fn() }),
      { wrapper },
    )
    await act(async () => {
      await Promise.all([result.current.start(request), result.current.start(request)])
    })
    expect(result.current.formError).toBeNull()
    expect(posts).toBe(1)
    expect(result.current.run?.run_id).toBe(activeRunFixture.run_id)
    unmount()
  })

  it('polls at 1600 ms, applies the terminal response, and stops', async () => {
    let polls = 0
    const onTerminal = vi.fn()
    server.use(
      http.post('http://127.0.0.1:8000/api/runs', () => HttpResponse.json(activeRunFixture, { status: 202 })),
      http.get(`http://127.0.0.1:8000/api/runs/${activeRunFixture.run_id}`, () => {
        polls += 1
        return HttpResponse.json(completedRunFixture)
      }),
    )
    const { result } = renderHook(() => useRunPolling({ onToast: vi.fn(), onTerminal }))
    await act(async () => result.current.start(request))
    expect(polls).toBe(0)
    await act(async () => new Promise((resolve) => setTimeout(resolve, 1_900)))
    expect(result.current.run?.status).toBe('completed')
    expect(onTerminal).toHaveBeenCalledOnce()
    const stoppedAt = polls
    await new Promise((resolve) => setTimeout(resolve, 1_800))
    expect(polls).toBe(stoppedAt)
  }, 6_000)

  it('backs off after network failure, announces it, then resets on success', async () => {
    let polls = 0
    const onToast = vi.fn()
    server.use(
      http.post('http://127.0.0.1:8000/api/runs', () => HttpResponse.json(activeRunFixture, { status: 202 })),
      http.get(`http://127.0.0.1:8000/api/runs/${activeRunFixture.run_id}`, () => {
        polls += 1
        return polls === 1 ? HttpResponse.error() : HttpResponse.json(completedRunFixture)
      }),
    )
    const { result } = renderHook(() => useRunPolling({ onToast, onTerminal: vi.fn() }))
    await act(async () => result.current.start(request))
    await act(async () => new Promise((resolve) => setTimeout(resolve, 1_900)))
    expect(polls).toBe(1)
    expect(onToast).toHaveBeenCalledWith(expect.stringContaining('Live update interrupted (1)'), 'warning')
    await act(async () => new Promise((resolve) => setTimeout(resolve, 3_800)))
    expect(result.current.run?.status).toBe('completed')
    expect(polls).toBe(2)
  }, 8_000)

  it('cancels pending poll work on unmount', async () => {
    vi.useFakeTimers()
    let polls = 0
    server.use(
      http.post('http://127.0.0.1:8000/api/runs', () => HttpResponse.json(activeRunFixture, { status: 202 })),
      http.get(`http://127.0.0.1:8000/api/runs/${activeRunFixture.run_id}`, () => {
        polls += 1
        return HttpResponse.json(activeRunFixture)
      }),
    )
    const { result, unmount } = renderHook(() => useRunPolling({ onToast: vi.fn(), onTerminal: vi.fn() }))
    await act(async () => result.current.start(request))
    unmount()
    await vi.advanceTimersByTimeAsync(5_000)
    expect(polls).toBe(0)
  })
})
