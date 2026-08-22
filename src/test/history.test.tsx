import { act, render, renderHook, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { TradingRun } from '../api/types'
import { DailyHistory } from '../components/DailyHistory'
import type {
  HistoryError,
  HistorySnapshotInfo,
  TradingHistoryRepository,
} from '../firebase/tradingHistoryRepository'
import { useHistory, type HistoryState } from '../hooks/useHistory'
import { addLocalDays, toLocalDateKey } from '../utils/date'
import { completedRunFixture } from './fixtures'

interface DayListener {
  date: string
  onData: (runs: TradingRun[], info: HistorySnapshotInfo) => void
  onError: (error: HistoryError) => void
  unsubscribed: boolean
}

class FakeHistoryRepository implements TradingHistoryRepository {
  readonly dayListeners: DayListener[] = []
  readonly latestDateRequests: string[] = []
  latestDate: string | null = toLocalDateKey()

  async verifyReadAccess(): Promise<void> {}

  async getLatestHistoryDate(maxDateKey: string): Promise<string | null> {
    this.latestDateRequests.push(maxDateKey)
    return this.latestDate
  }

  subscribeDay(
    date: string,
    onData: DayListener['onData'],
    onError: DayListener['onError'],
  ): () => void {
    const listener = { date, onData, onError, unsubscribed: false }
    this.dayListeners.push(listener)
    return () => {
      listener.unsubscribed = true
    }
  }

  subscribeRun(): () => void {
    return () => undefined
  }
}

describe('daily history', () => {
  it('navigates local calendar days, blocks future dates, returns today, and refreshes', async () => {
    const user = userEvent.setup()
    const today = toLocalDateKey()
    const history: HistoryState = {
      date: today,
      runs: [],
      count: 0,
      loading: false,
      error: null,
      source: 'server',
      setDate: vi.fn(),
      moveDay: vi.fn(),
      today: vi.fn(),
      refresh: vi.fn(),
      clear: vi.fn(),
    }
    const { rerender } = render(
      <DailyHistory history={history} selectedRun={null} active={false} onSelect={vi.fn()} />,
    )
    expect(screen.getByRole('button', { name: 'Next day' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Previous day' }))
    expect(history.moveDay).toHaveBeenCalledWith(-1)
    await user.click(screen.getByRole('button', { name: 'Refresh daily history' }))
    expect(history.refresh).toHaveBeenCalledOnce()

    const yesterdayHistory = { ...history, date: addLocalDays(today, -1) }
    rerender(<DailyHistory history={yesterdayHistory} selectedRun={null} active={false} onSelect={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: 'TODAY' }))
    expect(history.today).toHaveBeenCalledOnce()
  })

  it('opens the latest stored history day instead of defaulting to an empty today', async () => {
    const repository = new FakeHistoryRepository()
    const today = toLocalDateKey()
    const latestStoredDate = addLocalDays(today, -4)
    repository.latestDate = latestStoredDate

    const { result } = renderHook(() => useHistory(true, repository))

    await waitFor(() => expect(repository.dayListeners).toHaveLength(1))
    expect(repository.latestDateRequests).toEqual([today])
    expect(repository.dayListeners[0]?.date).toBe(latestStoredDate)
    expect(result.current.date).toBe(latestStoredDate)
  })

  it('guards stale listener callbacks and unsubscribes on date changes, clear, and unmount', async () => {
    const repository = new FakeHistoryRepository()
    const today = toLocalDateKey()
    const yesterday = addLocalDays(today, -1)
    const { result, unmount } = renderHook(() => useHistory(true, repository))
    await waitFor(() => expect(repository.dayListeners).toHaveLength(1))
    const first = repository.dayListeners[0]
    expect(first?.date).toBe(today)

    act(() => result.current.setDate(yesterday))
    const second = repository.dayListeners[1]
    expect(first?.unsubscribed).toBe(true)
    expect(second?.date).toBe(yesterday)

    act(() => {
      second?.onData([{ ...completedRunFixture, ticker: 'FRESH' }], { fromCache: false })
      first?.onData([{ ...completedRunFixture, ticker: 'STALE' }], { fromCache: false })
    })
    expect(result.current.runs[0]?.ticker).toBe('FRESH')
    expect(result.current.source).toBe('server')

    act(() => result.current.clear())
    expect(second?.unsubscribed).toBe(true)
    expect(result.current.runs).toEqual([])
    unmount()
  })

  it('clears cards and revalidates authentication on listener permission loss', async () => {
    const repository = new FakeHistoryRepository()
    const onAccessFailure = vi.fn()
    const { result } = renderHook(() => useHistory(true, repository, onAccessFailure))
    await waitFor(() => expect(repository.dayListeners).toHaveLength(1))
    const listener = repository.dayListeners[0]

    act(() => listener?.onData([completedRunFixture], { fromCache: false }))
    expect(result.current.runs).toHaveLength(1)

    const denial: HistoryError = {
      code: 'permission-denied',
      operation: 'subscribe-day',
      message: 'Access denied.',
      retryable: false,
    }
    act(() => listener?.onError(denial))

    expect(result.current.runs).toEqual([])
    expect(result.current.source).toBe('unavailable')
    expect(onAccessFailure).toHaveBeenCalledWith(denial)
  })
})
