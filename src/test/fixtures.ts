import type { OptionsResponse, TradingRun } from '../api/types'

export const optionsFixture: OptionsResponse = {
  analysts: [
    { id: 'market', label: 'Market' },
    { id: 'social', label: 'Social' },
    { id: 'news', label: 'News' },
    { id: 'fundamentals', label: 'Fundamentals' },
  ],
  research_depths: [
    { id: 1, label: 'Quick', description: 'Fast scan' },
    { id: 3, label: 'Standard', description: 'Balanced debate' },
    { id: 5, label: 'Deep', description: 'Full research' },
  ],
  providers: [
    {
      id: 'google',
      label: 'Google Gemini',
      quick_models: [
        { id: 'gemini-quick', label: 'Gemini Quick' },
        { id: 'custom', label: 'Custom', custom: true },
      ],
      deep_models: [
        { id: 'gemini-deep', label: 'Gemini Deep' },
        { id: 'custom', label: 'Custom', custom: true },
      ],
      default_quick_model: 'gemini-quick',
      default_deep_model: 'gemini-deep',
      supports_backend_url: false,
      requires_backend_url: false,
      thinking_control: {
        key: 'thinking_level',
        label: 'Thinking Level',
        default: 'high',
        options: [
          { id: 'high', label: 'High' },
          { id: 'minimal', label: 'Minimal' },
        ],
      },
    },
    {
      id: 'ollama',
      label: 'Llama 3.2 3B (Local / Ollama)',
      quick_models: [{ id: 'tradingagents-llama3.2:16k', label: 'Llama 3.2 3B' }],
      deep_models: [{ id: 'tradingagents-llama3.2:16k', label: 'Llama 3.2 3B' }],
      default_quick_model: 'tradingagents-llama3.2:16k',
      default_deep_model: 'tradingagents-llama3.2:16k',
      supports_backend_url: true,
      requires_backend_url: true,
      backend_url: 'http://127.0.0.1:11434',
      backend_urls: [{ id: 'http://127.0.0.1:11434', label: 'Local Ollama' }],
    },
  ],
  output_languages: [
    { id: 'en', label: 'English' },
    { id: 'custom', label: 'Custom', custom: true },
  ],
  languages: [],
  defaults: {
    ticker: 'NVDA',
    analysis_date: '2026-08-20',
    output_language: 'en',
    analysts: ['market', 'news', 'fundamentals'],
    research_depth: 3,
    llm_provider: 'google',
    quick_model: 'gemini-quick',
    deep_model: 'gemini-deep',
    backend_url: null,
    thinking_level: 'high',
  },
  storage: {
    mode: 'firebase',
    backend: 'firestore',
    configured: true,
    message: 'Online',
  },
}

export const activeRunFixture: TradingRun = {
  run_id: '1234567890abcdef1234567890abcdef',
  ticker: 'NVDA',
  analysis_date: '2026-08-20',
  status: 'running',
  progress: 42,
  current_phase: 'Market analysis',
  llm_provider: 'google',
  quick_model: 'gemini-quick',
  agent_status: {
    market_analyst: 'completed',
    news_analyst: 'running',
    bull_researcher: 'queued',
  },
  events: [
    {
      id: 'event-1',
      sequence: 1,
      timestamp: '2026-08-20T09:10:11Z',
      agent: 'Market Analyst',
      message: 'Market structure and volume profile received.',
    },
  ],
}

export const completedRunFixture: TradingRun = {
  ...activeRunFixture,
  status: 'completed',
  progress: 100,
  reports: {
    market_report: '# Market Report\n\nMomentum is **BULLISH**.\n\n| Metric | Value |\n| :--- | ---: |\n| RSI | 58 |\n\n```text\nLONG_MODEL_OUTPUT=' + 'x'.repeat(180) + '\n```',
    news_report: '## News Report\n\nCatalyst flow remains constructive.',
    final_trade_decision: '# Portfolio Decision\n\nAccumulate with measured risk.',
  },
  decision: { action: 'BUY', confidence: 0.78, target_price: 142 },
  final_trade_decision: {
    action: 'BUY',
    confidence: 0.78,
    target_price: 142,
    rationale: '# Portfolio Decision\n\nAccumulate with measured risk.',
  },
}
