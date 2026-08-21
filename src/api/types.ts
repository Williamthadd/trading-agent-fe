export interface StorageInfo {
  mode: 'firebase' | 'local' | 'unavailable' | string
  backend: string
  configured: boolean
  message: string
}

export interface HealthResponse {
  status: 'ok' | 'degraded'
  service: 'tradingagents-api' | string
  version: string
  storage: StorageInfo
  active_runs: number
}

export interface FirebaseWebConfig {
  apiKey: string
  authDomain: string
  projectId: string
  appId: string
  messagingSenderId?: string
  storageBucket?: string
  measurementId?: string
}

export interface AuthConfigResponse {
  required: boolean
  configured: boolean
  firebase: FirebaseWebConfig | Record<string, never>
  missing: string[]
  access_restricted: boolean
}

export interface SessionUser {
  uid: string
  email: string | null
  name?: string | null
  picture?: string | null
  email_verified?: boolean
  auth_disabled?: boolean
}

export interface SessionResponse {
  authenticated: true
  user: SessionUser
}

export interface OptionItem {
  id: string
  label: string
  custom?: boolean
}

export interface ThinkingControl {
  key: 'thinking_level' | 'reasoning_effort' | 'anthropic_effort' | string
  label: string
  default?: string | null
  options: OptionItem[]
}

export interface ProviderOption {
  id: string
  label: string
  quick_models: OptionItem[]
  deep_models: OptionItem[]
  default_quick_model?: string
  default_deep_model?: string
  supports_backend_url: boolean
  requires_backend_url: boolean
  backend_url?: string | null
  backend_urls?: OptionItem[]
  thinking_control?: ThinkingControl
}

export interface ResearchDepth {
  id: 1 | 3 | 5
  label: string
  description: string
}

export interface OptionsResponse {
  analysts: OptionItem[]
  research_depths: ResearchDepth[]
  providers: ProviderOption[]
  output_languages: OptionItem[]
  languages: OptionItem[]
  defaults: {
    ticker: string
    analysis_date: string
    output_language: string
    analysts: string[]
    research_depth: 1 | 3 | 5
    llm_provider: string
    quick_model: string
    deep_model: string
    backend_url: string | null
    thinking_level?: 'high' | 'minimal' | null
  }
  storage: StorageInfo
}

export interface RunRequest {
  ticker: string
  analysis_date: string
  output_language: string
  analysts: string[]
  research_depth: 1 | 3 | 5
  llm_provider: string
  quick_model: string
  deep_model: string
  backend_url?: string
  thinking_level?: 'high' | 'minimal'
  reasoning_effort?: 'low' | 'medium' | 'high'
  anthropic_effort?: 'low' | 'medium' | 'high'
}

export type RunStatus =
  | 'queued'
  | 'pending'
  | 'running'
  | 'processing'
  | 'in_progress'
  | 'completed'
  | 'failed'
  | 'error'
  | 'cancelled'
  | 'canceled'
  | string

export interface RunEvent {
  event_id?: string
  id?: string
  run_id?: string
  created_at?: string
  timestamp?: string
  sequence?: number
  agent?: string
  type?: string
  status?: string
  message?: unknown
  report_key?: string
  content?: unknown
  data?: unknown
  [key: string]: unknown
}

export interface TradingRun {
  run_id: string
  ticker: string
  analysis_date: string
  output_language?: string
  analysts?: string[]
  research_depth?: 1 | 3 | 5
  llm_provider?: string
  quick_model?: string
  deep_model?: string
  asset_type?: string
  status: RunStatus
  progress?: number | { percent?: number; fraction?: number; value?: number }
  current_phase?: string | null
  current_agent?: string | null
  agent_status?: Record<string, string | { status?: string; state?: string }>
  reports?: Record<string, unknown> | unknown[]
  decision?: unknown
  final_decision?: unknown
  final_trade_decision?: unknown
  final_state?: Record<string, unknown>
  result?: Record<string, unknown>
  error?: unknown
  created_at?: string
  updated_at?: string
  completed_at?: string
  date_key?: string
  events?: RunEvent[] | Record<string, RunEvent>
  [key: string]: unknown
}

export interface HistoryResponse {
  date: string | null
  count: number
  runs: TradingRun[]
}
