import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { AnalysisControl } from '../components/AnalysisControl'
import { hydrateSettings, SETTINGS_KEY } from '../hooks/usePersistedSettings'
import { optionsFixture } from './fixtures'

describe('AnalysisControl', () => {
  it('hydrates only valid saved option IDs and falls back stale settings to backend defaults', () => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({
      ticker: 'AMD',
      llm_provider: 'removed-provider',
      quick_model: 'removed-model',
      analysts: ['market', 'retired-analyst'],
      research_depth: 5,
    }))
    expect(hydrateSettings(optionsFixture)).toMatchObject({
      ticker: 'AMD',
      llm_provider: 'google',
      quick_model: 'gemini-quick',
      analysts: ['market'],
      research_depth: 5,
    })
  })

  it('submits exact dynamic custom values and never the custom sentinel', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    render(<AnalysisControl options={optionsFixture} onSubmit={onSubmit} />)

    await user.selectOptions(screen.getByLabelText('Output Language'), 'custom')
    await user.type(screen.getByLabelText('Custom Output Language'), 'Bahasa Indonesia')
    await user.selectOptions(screen.getByLabelText('Quick Model'), 'custom')
    await user.type(screen.getByLabelText('Custom Quick Model'), 'quick-private-name')
    await user.selectOptions(screen.getByLabelText('Deep Model'), 'custom')
    await user.type(screen.getByLabelText('Custom Deep Model'), 'deep-private-name')
    await user.selectOptions(screen.getByLabelText('Thinking Level'), 'minimal')
    await user.click(screen.getByRole('button', { name: /Run Intelligence Cycle/i }))

    await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce())
    expect(onSubmit).toHaveBeenCalledWith({
      ticker: 'NVDA',
      analysis_date: '2026-08-20',
      output_language: 'Bahasa Indonesia',
      analysts: ['market', 'news', 'fundamentals'],
      research_depth: 3,
      llm_provider: 'google',
      quick_model: 'quick-private-name',
      deep_model: 'deep-private-name',
      thinking_level: 'minimal',
    })
    expect(JSON.stringify(onSubmit.mock.calls[0]?.[0])).not.toContain('"custom"')
  })

  it('unchecks Fundamentals for crypto and restores its previous equity selection', async () => {
    const user = userEvent.setup()
    render(<AnalysisControl options={optionsFixture} onSubmit={vi.fn()} />)
    const ticker = screen.getByLabelText('Symbol / Ticker')
    const fundamentals = screen.getByRole('checkbox', { name: 'Fundamentals' })
    expect(fundamentals).toBeChecked()
    await user.clear(ticker)
    await user.type(ticker, 'btc-usdt')
    await waitFor(() => {
      expect(fundamentals).toBeDisabled()
      expect(fundamentals).not.toBeChecked()
    })
    await user.clear(ticker)
    await user.type(ticker, 'msft')
    await waitFor(() => {
      expect(fundamentals).toBeEnabled()
      expect(fundamentals).toBeChecked()
    })
  })

  it('validates ticker/date/analysts and Ctrl+Enter submits only a valid form once', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    render(<AnalysisControl options={optionsFixture} onSubmit={onSubmit} />)
    const ticker = screen.getByLabelText('Symbol / Ticker')
    await user.clear(ticker)
    expect(screen.getByRole('button', { name: /Run Intelligence Cycle/i })).toBeDisabled()
    await user.type(ticker, 'aapl')
    await user.keyboard('{Control>}{Enter}{/Control}')
    await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce())
  })

  it('switches provider controls atomically and validates the advertised backend URL', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    render(<AnalysisControl options={optionsFixture} onSubmit={onSubmit} />)
    await user.selectOptions(screen.getByLabelText('Provider'), 'ollama')
    const backend = screen.getByLabelText(/Backend URL/)
    expect(backend).toHaveValue('http://127.0.0.1:11434')
    await user.clear(backend)
    await user.type(backend, 'javascript:bad')
    expect(screen.getByRole('button', { name: /Run Intelligence Cycle/i })).toBeDisabled()
    await user.clear(backend)
    await user.type(backend, 'http://127.0.0.1:11434/')
    await user.click(screen.getByRole('button', { name: /Run Intelligence Cycle/i }))
    await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce())
    expect(onSubmit.mock.calls[0]?.[0]).toMatchObject({
      llm_provider: 'ollama',
      quick_model: 'tradingagents-llama3.2:16k',
      deep_model: 'tradingagents-llama3.2:16k',
      backend_url: 'http://127.0.0.1:11434',
    })
    expect(onSubmit.mock.calls[0]?.[0]).not.toHaveProperty('thinking_level')
  })
})
