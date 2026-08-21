import { act, render, renderHook, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { delay, http, HttpResponse } from 'msw'
import { describe, expect, it, vi } from 'vitest'
import { DailyHistory } from '../components/DailyHistory'
import { useHistory, type HistoryState } from '../hooks/useHistory'
import { addLocalDays, toLocalDateKey } from '../utils/date'
import { completedRunFixture } from './fixtures'
import { server } from './server'

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
      setDate: vi.fn(),
      moveDay: vi.fn(),
      today: vi.fn(),
      refresh: vi.fn(),
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

  it('uses abort/generation guards so an older date response cannot overwrite a newer one', async () => {
    const today = toLocalDateKey()
    const yesterday = addLocalDays(today, -1)
    server.use(
      http.get('http://127.0.0.1:8000/api/history', async ({ request }) => {
        const date = new URL(request.url).searchParams.get('date')
        if (date === today) {
          await delay(150)
          return HttpResponse.json({
            date,
            count: 1,
            runs: [{ ...completedRunFixture, ticker: 'STALE' }],
          })
        }
        return HttpResponse.json({
          date,
          count: 1,
          runs: [{ ...completedRunFixture, ticker: 'FRESH' }],
        })
      }),
    )
    const { result } = renderHook(() => useHistory(true))
    act(() => result.current.setDate(yesterday))
    await waitFor(() => expect(result.current.runs[0]?.ticker).toBe('FRESH'))
    await new Promise((resolve) => setTimeout(resolve, 200))
    expect(result.current.runs[0]?.ticker).toBe('FRESH')
  })
})
