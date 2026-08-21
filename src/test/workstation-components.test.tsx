import { act, fireEvent, render, renderHook, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { DailyHistory } from '../components/DailyHistory'
import { FinalDecision } from '../components/FinalDecision'
import { IntelligenceDesk } from '../components/IntelligenceDesk'
import { Reports } from '../components/Reports'
import { TEXT_SCALE_STORAGE_KEY, useTextScale } from '../hooks/useTextScale'
import type { HistoryState } from '../hooks/useHistory'
import { activeRunFixture, completedRunFixture } from './fixtures'

describe('workstation interaction components', () => {
  it('supports F1/F2/F3 and roving Arrow/Home/End tab keyboard behavior', async () => {
    render(<IntelligenceDesk run={completedRunFixture} onCopy={vi.fn()} />)
    const live = screen.getByRole('tab', { name: /Live Wire/ })
    const reports = screen.getByRole('tab', { name: /Reports/ })
    const decision = screen.getByRole('tab', { name: /Decision/ })
    expect(live).toHaveAttribute('aria-selected', 'true')
    fireEvent.keyDown(window, { key: 'F2' })
    expect(reports).toHaveAttribute('aria-selected', 'true')
    reports.focus()
    fireEvent.keyDown(reports.parentElement!, { key: 'ArrowRight' })
    expect(decision).toHaveAttribute('aria-selected', 'true')
    expect(decision).toHaveFocus()
    fireEvent.keyDown(decision.parentElement!, { key: 'Home' })
    expect(live).toHaveAttribute('aria-selected', 'true')
    fireEvent.keyDown(live.parentElement!, { key: 'End' })
    expect(decision).toHaveAttribute('aria-selected', 'true')
  })

  it('copies all report source in the exact raw ledger structure', async () => {
    const user = userEvent.setup()
    const onCopy = vi.fn()
    render(<Reports run={completedRunFixture} onCopy={onCopy} />)
    await user.click(screen.getByRole('button', { name: 'COPY ALL' }))
    const copied = onCopy.mock.calls[0]?.[0] as string
    expect(copied).toContain('MARKET_REPORT\n# Market Report')
    expect(copied).toContain('\n\n------------------------------------------------------------\n\nNEWS_REPORT\n')
    expect(copied).not.toContain('<h1>')
  })

  it('copies the original decision source and preserves unchanged report details DOM state', async () => {
    const user = userEvent.setup()
    const onCopy = vi.fn()
    const { rerender } = render(<Reports run={completedRunFixture} onCopy={onCopy} />)
    const details = document.querySelectorAll('details')
    const first = details[0]
    expect(first).toBeDefined()
    if (!first) return
    first.open = true
    rerender(<Reports run={{ ...completedRunFixture, updated_at: '2026-08-20T10:00:00Z' }} onCopy={onCopy} />)
    expect(first).toBe(document.querySelectorAll('details')[0])
    expect(first.open).toBe(true)

    rerender(<FinalDecision run={completedRunFixture} onCopy={onCopy} />)
    await user.click(screen.getByRole('button', { name: 'COPY' }))
    expect(onCopy).toHaveBeenLastCalledWith(
      '# Portfolio Decision\n\nAccumulate with measured risk.',
      'Decision',
    )
  })

  it('locks conflicting archive cards while a run is active', () => {
    const history: HistoryState = {
      date: '2026-08-20',
      runs: [activeRunFixture, { ...completedRunFixture, run_id: 'abcdefabcdefabcdefabcdefabcdefab', ticker: 'AMD' }],
      count: 2,
      loading: false,
      error: null,
      setDate: vi.fn(),
      moveDay: vi.fn(),
      today: vi.fn(),
      refresh: vi.fn(),
    }
    render(
      <DailyHistory
        history={history}
        selectedRun={activeRunFixture}
        active
        onSelect={vi.fn()}
      />,
    )
    const selected = screen.getByRole('button', { name: /NVDA/ })
    const conflicting = screen.getByRole('button', { name: /AMD/ })
    expect(selected).toHaveAttribute('aria-current', 'true')
    expect(selected).toBeEnabled()
    expect(conflicting).toBeDisabled()
  })

  it('clamps, steps, applies, and persists text scale from 85 to 160', () => {
    const { result, unmount } = renderHook(() => useTextScale())
    expect(result.current.value).toBe(110)
    expect(result.current.output).toBe('110% / 14.3px')
    act(() => result.current.setValue(163))
    expect(result.current.value).toBe(160)
    expect(document.documentElement.style.getPropertyValue('--text-scale')).toBe('1.6')
    expect(localStorage.getItem(TEXT_SCALE_STORAGE_KEY)).toBe('160')
    unmount()
    const second = renderHook(() => useTextScale())
    expect(second.result.current.value).toBe(160)
    act(() => second.result.current.setValue(82))
    expect(second.result.current.value).toBe(85)
  })
})
