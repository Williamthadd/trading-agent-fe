import { StrictMode, type ReactNode } from 'react'
import { act, renderHook, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it, vi } from 'vitest'
import { ApiClient } from '../api/client'
import type { RunRequest, TradingRun } from '../api/types'
import type {
  HistoryError,
  HistorySnapshotInfo,
  TradingHistoryRepository,
} from '../firebase/tradingHistoryRepository'
import { useRunController } from '../hooks/useRunController'
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

interface RunListener {
  runId: string
  onData: (run: TradingRun | null, info: HistorySnapshotInfo) => void
  onError: (error: HistoryError) => void
  unsubscribed: boolean
}

class FakeHistoryRepository implements TradingHistoryRepository {
  readonly runListeners: RunListener[] = []

  async verifyReadAccess(): Promise<void> {}
  subscribeDay(): () => void { return () => undefined }
  subscribeRun(
    runId: string,
    onData: RunListener['onData'],
    onError: RunListener['onError'],
  ): () => void {
    const listener = { runId, onData, onError, unsubscribed: false }
    this.runListeners.push(listener)
    return () => {
      listener.unsubscribed = true
    }
  }
}

function renderController(
  repository: FakeHistoryRepository,
  overrides: Partial<Parameters<typeof useRunController>[0]> = {},
) {
  const client = new ApiClient('http://api.test')
  const wrapper = ({ children }: { children: ReactNode }) => <StrictMode>{children}</StrictMode>
  return renderHook(
    () => useRunController({
      onToast: vi.fn(),
      onTerminal: vi.fn(),
      getIdToken: vi.fn(async () => 'fresh-token'),
      canLaunch: true,
      repository,
      client,
      ...overrides,
    }),
    { wrapper },
  )
}

describe('useRunController', () => {
  it('posts exactly once under rapid submit, sends a fresh token, and selects the Firestore run', async () => {
    let posts = 0
    server.use(
      http.post('http://api.test/api/runs', ({ request: httpRequest }) => {
        posts += 1
        expect(httpRequest.headers.get('Authorization')).toBe('Bearer fresh-token')
        return HttpResponse.json({ run_id: activeRunFixture.run_id, ticker: 'NVDA' }, { status: 202 })
      }),
    )
    const repository = new FakeHistoryRepository()
    const { result, unmount } = renderController(repository)
    await act(async () => {
      await Promise.all([result.current.start(request), result.current.start(request)])
    })
    expect(posts).toBe(1)
    expect(result.current.selectedRunId).toBe(activeRunFixture.run_id)
    expect(result.current.propagationPending).toBe(true)

    const listener = repository.runListeners.at(-1)
    act(() => listener?.onData(activeRunFixture, { fromCache: false, complete: true }))
    expect(result.current.run?.run_id).toBe(activeRunFixture.run_id)
    expect(result.current.snapshotSource).toBe('server')
    expect(result.current.propagationPending).toBe(false)
    expect(result.current.active).toBe(true)
    unmount()
    expect(listener?.unsubscribed).toBe(true)
  })

  it('rejects a second launch while the accepted run is still tracked', async () => {
    let posts = 0
    server.use(
      http.post('http://api.test/api/runs', () => {
        posts += 1
        return HttpResponse.json({ run_id: activeRunFixture.run_id, ticker: 'NVDA' }, { status: 202 })
      }),
    )
    const repository = new FakeHistoryRepository()
    const { result } = renderController(repository)

    await act(async () => result.current.start(request))
    await act(async () => result.current.start(request))

    expect(posts).toBe(1)
    expect(result.current.formError).toContain('Finish the active run')
  })

  it('rejects archive navigation from a stale handler after a run becomes tracked', async () => {
    server.use(
      http.post('http://api.test/api/runs', () =>
        HttpResponse.json({ run_id: activeRunFixture.run_id, ticker: 'NVDA' }, { status: 202 })),
    )
    const repository = new FakeHistoryRepository()
    const onToast = vi.fn()
    const { result } = renderController(repository, { onToast })
    const staleSelectArchived = result.current.selectArchived
    const otherRunId = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'

    await act(async () => {
      await result.current.start(request)
      await staleSelectArchived(otherRunId)
    })

    expect(result.current.selectedRunId).toBe(activeRunFixture.run_id)
    expect(onToast).toHaveBeenCalledWith(
      'Finish the active run before opening another archive.',
      'warning',
    )
  })

  it('uses listener transitions for terminal state and never requests a run-detail GET', async () => {
    let detailGets = 0
    server.use(
      http.post('http://api.test/api/runs', () =>
        HttpResponse.json({ run_id: activeRunFixture.run_id, ticker: 'NVDA' }, { status: 202 })),
      http.get('http://api.test/api/runs/:runId', () => {
        detailGets += 1
        return HttpResponse.json(completedRunFixture)
      }),
    )
    const repository = new FakeHistoryRepository()
    const onTerminal = vi.fn()
    const { result } = renderController(repository, { onTerminal })
    await act(async () => result.current.start(request))
    const listener = repository.runListeners.at(-1)
    act(() => listener?.onData(activeRunFixture, { fromCache: false, complete: true }))
    act(() => listener?.onData(completedRunFixture, { fromCache: false, complete: true }))
    expect(result.current.run?.status).toBe('completed')
    expect(onTerminal).toHaveBeenCalledOnce()
    expect(detailGets).toBe(0)
  })

  it('shows a precise propagation warning when an accepted run never appears', async () => {
    server.use(
      http.post('http://api.test/api/runs', () =>
        HttpResponse.json({ run_id: activeRunFixture.run_id, ticker: 'NVDA' }, { status: 202 })),
    )
    const repository = new FakeHistoryRepository()
    const onToast = vi.fn()
    const { result } = renderController(repository, { onToast, propagationGraceMs: 20 })
    await act(async () => result.current.start(request))
    const listener = repository.runListeners.at(-1)
    act(() => listener?.onData(null, { fromCache: false, complete: true }))
    await act(async () => new Promise((resolve) => setTimeout(resolve, 35)))
    expect(result.current.detailWarning).toContain('BACKEND MAY HAVE FALLEN BACK TO LOCAL JSON')
    expect(result.current.run).toBeNull()
    expect(result.current.requiresLaunchConfirmation).toBe(true)
    expect(onToast).toHaveBeenCalledWith(expect.stringContaining('RUN NOT FOUND IN FIRESTORE'), 'warning')
    act(() => listener?.onData(null, { fromCache: false, complete: true }))
    expect(result.current.detailWarning).toContain('BACKEND MAY HAVE FALLEN BACK TO LOCAL JSON')
    expect(onToast).not.toHaveBeenCalledWith(
      'This archived Firestore run no longer exists.',
      'warning',
    )
    act(() => result.current.confirmLaunchAfterStorageWarning())
    expect(result.current.requiresLaunchConfirmation).toBe(false)
  })

  it('resumes a late Firestore run after the propagation warning without leaving a stale form error', async () => {
    server.use(
      http.post('http://api.test/api/runs', () =>
        HttpResponse.json({ run_id: activeRunFixture.run_id, ticker: 'NVDA' }, { status: 202 })),
    )
    const repository = new FakeHistoryRepository()
    const { result } = renderController(repository, { propagationGraceMs: 20 })
    await act(async () => result.current.start(request))
    const listener = repository.runListeners.at(-1)
    act(() => listener?.onData(null, { fromCache: false, complete: true }))
    await act(async () => new Promise((resolve) => setTimeout(resolve, 35)))
    expect(result.current.requiresLaunchConfirmation).toBe(true)

    act(() => listener?.onData(activeRunFixture, { fromCache: false, complete: true }))
    expect(result.current.run?.run_id).toBe(activeRunFixture.run_id)
    expect(result.current.formError).toBeNull()
    expect(result.current.requiresLaunchConfirmation).toBe(false)
    expect(result.current.active).toBe(true)
  })

  it('waits through a cache-only miss before resolving an archived run from the server', async () => {
    const repository = new FakeHistoryRepository()
    const onToast = vi.fn()
    const { result } = renderController(repository, { onToast })

    await act(async () => result.current.selectArchived(completedRunFixture.run_id))
    const listener = repository.runListeners.at(-1)
    act(() => listener?.onData(null, { fromCache: true, complete: false }))
    expect(result.current.selecting).toBe(true)
    expect(result.current.detailWarning).toBeNull()
    expect(onToast).not.toHaveBeenCalled()

    act(() => listener?.onData(completedRunFixture, { fromCache: false, complete: true }))
    expect(result.current.selecting).toBe(false)
    expect(result.current.run?.run_id).toBe(completedRunFixture.run_id)
    expect(result.current.detailWarning).toBeNull()
  })

  it('does not automatically retry a failed POST', async () => {
    let posts = 0
    server.use(
      http.post('http://api.test/api/runs', () => {
        posts += 1
        return HttpResponse.error()
      }),
    )
    const repository = new FakeHistoryRepository()
    const { result } = renderController(repository)
    await act(async () => result.current.start(request))
    await waitFor(() => expect(result.current.formError).toMatch(/Unable to reach/))
    expect(posts).toBe(1)
  })

  it('does not let an archived stale running status lock history navigation', async () => {
    const repository = new FakeHistoryRepository()
    const { result } = renderController(repository)
    const staleRunId = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
    const otherRunId = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'

    await act(async () => result.current.selectArchived(staleRunId))
    act(() => repository.runListeners.at(-1)?.onData(
      { ...activeRunFixture, run_id: staleRunId },
      { fromCache: false, complete: true },
    ))
    expect(result.current.active).toBe(false)

    await act(async () => result.current.selectArchived(otherRunId))
    expect(result.current.selectedRunId).toBe(otherRunId)
    expect(repository.runListeners.at(-1)?.runId).toBe(otherRunId)
  })

  it('invalidates the old listener synchronously when selecting a different archive', async () => {
    const repository = new FakeHistoryRepository()
    const onFirestoreAccessFailure = vi.fn()
    const { result } = renderController(repository, { onFirestoreAccessFailure })
    const firstRunId = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
    const secondRunId = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'

    await act(async () => result.current.selectArchived(firstRunId))
    const firstListener = repository.runListeners.at(-1)
    act(() => firstListener?.onData(
      { ...completedRunFixture, run_id: firstRunId },
      { fromCache: false, complete: true },
    ))

    act(() => {
      void result.current.selectArchived(secondRunId)
      firstListener?.onData(
        { ...completedRunFixture, run_id: firstRunId, current_phase: 'stale-callback' },
        { fromCache: false, complete: true },
      )
      firstListener?.onError({
        code: 'permission-denied',
        operation: 'subscribe-run',
        message: 'stale denial',
        retryable: false,
      })
    })

    expect(firstListener?.unsubscribed).toBe(true)
    expect(result.current.selectedRunId).toBe(secondRunId)
    expect(result.current.run).toBeNull()
    expect(onFirestoreAccessFailure).not.toHaveBeenCalled()
    await waitFor(() => expect(repository.runListeners.at(-1)?.runId).toBe(secondRunId))
  })

  it('marks a failed tracked listener uncertain and resumes tracking after a same-run refresh', async () => {
    server.use(
      http.post('http://api.test/api/runs', () =>
        HttpResponse.json({ run_id: activeRunFixture.run_id, ticker: 'NVDA' }, { status: 202 })),
    )
    const repository = new FakeHistoryRepository()
    const { result } = renderController(repository)

    await act(async () => result.current.start(request))
    const firstListener = repository.runListeners.at(-1)
    act(() => firstListener?.onError({
      code: 'unavailable',
      operation: 'subscribe-run',
      message: 'Firestore listener unavailable.',
      retryable: true,
    }))

    expect(result.current.active).toBe(false)
    expect(result.current.propagationPending).toBe(false)
    expect(result.current.requiresLaunchConfirmation).toBe(true)
    act(() => result.current.confirmLaunchAfterStorageWarning())
    await act(async () => result.current.selectArchived(activeRunFixture.run_id))
    await waitFor(() => expect(repository.runListeners.length).toBeGreaterThanOrEqual(2))
    const refreshedListener = repository.runListeners.at(-1)
    act(() => refreshedListener?.onData(activeRunFixture, { fromCache: false, complete: true }))

    expect(result.current.run?.run_id).toBe(activeRunFixture.run_id)
    expect(result.current.requiresLaunchConfirmation).toBe(false)
    expect(result.current.active).toBe(true)
  })

  it('keeps an archived Firestore listener live after a failed launch', async () => {
    server.use(
      http.post('http://api.test/api/runs', () => HttpResponse.error()),
    )
    const repository = new FakeHistoryRepository()
    const { result } = renderController(repository)

    await act(async () => result.current.selectArchived(completedRunFixture.run_id))
    const listener = repository.runListeners.at(-1)
    act(() => listener?.onData(completedRunFixture, { fromCache: false, complete: true }))
    expect(result.current.run?.status).toBe('completed')

    await act(async () => result.current.start(request))
    await waitFor(() => expect(result.current.formError).toMatch(/Unable to reach/))

    const refreshed = { ...completedRunFixture, current_phase: 'retained-listener-update' }
    act(() => listener?.onData(refreshed, { fromCache: false, complete: true }))
    expect(result.current.run?.current_phase).toBe('retained-listener-update')
    expect(listener?.unsubscribed).toBe(false)
  })

  it('clears selected detail and revalidates authentication on listener permission loss', async () => {
    const repository = new FakeHistoryRepository()
    const onFirestoreAccessFailure = vi.fn()
    const { result } = renderController(repository, { onFirestoreAccessFailure })

    await act(async () => result.current.selectArchived(completedRunFixture.run_id))
    const listener = repository.runListeners.at(-1)
    act(() => listener?.onData(completedRunFixture, { fromCache: false, complete: true }))
    expect(result.current.run).not.toBeNull()

    const denial: HistoryError = {
      code: 'permission-denied',
      operation: 'subscribe-run',
      message: 'Access denied.',
      retryable: false,
    }
    act(() => listener?.onError(denial))

    expect(result.current.run).toBeNull()
    expect(onFirestoreAccessFailure).toHaveBeenCalledWith(denial)
  })
})
