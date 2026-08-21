import type {
  HealthResponse,
  OptionItem,
  OptionsResponse,
  ProviderOption,
  ResearchDepth,
  StorageInfo,
} from './types'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

function isOption(value: unknown): value is OptionItem {
  return (
    isRecord(value) &&
    isNonEmptyString(value.id) &&
    isNonEmptyString(value.label) &&
    (value.custom === undefined || typeof value.custom === 'boolean')
  )
}

function isOptionArray(value: unknown): value is OptionItem[] {
  return Array.isArray(value) && value.length <= 250 && value.every(isOption)
}

function isStorage(value: unknown): value is StorageInfo {
  return (
    isRecord(value) &&
    isNonEmptyString(value.mode) &&
    typeof value.backend === 'string' &&
    typeof value.configured === 'boolean' &&
    typeof value.message === 'string'
  )
}

function isResearchDepth(value: unknown): value is ResearchDepth {
  return (
    isRecord(value) &&
    (value.id === 1 || value.id === 3 || value.id === 5) &&
    isNonEmptyString(value.label) &&
    typeof value.description === 'string'
  )
}

function isProvider(value: unknown): value is ProviderOption {
  if (!isRecord(value)) return false
  if (
    !isNonEmptyString(value.id) ||
    !isNonEmptyString(value.label) ||
    !isOptionArray(value.quick_models) ||
    !isOptionArray(value.deep_models) ||
    value.quick_models.length === 0 ||
    value.deep_models.length === 0 ||
    typeof value.supports_backend_url !== 'boolean' ||
    typeof value.requires_backend_url !== 'boolean'
  ) return false
  if (value.default_quick_model !== undefined && typeof value.default_quick_model !== 'string') return false
  if (value.default_deep_model !== undefined && typeof value.default_deep_model !== 'string') return false
  if (value.backend_url !== undefined && value.backend_url !== null && typeof value.backend_url !== 'string') return false
  if (value.backend_urls !== undefined && !isOptionArray(value.backend_urls)) return false
  if (value.thinking_control !== undefined) {
    const control = value.thinking_control
    if (
      !isRecord(control) ||
      !isNonEmptyString(control.key) ||
      !isNonEmptyString(control.label) ||
      (control.default !== undefined && control.default !== null && typeof control.default !== 'string') ||
      !isOptionArray(control.options)
    ) return false
  }
  return true
}

export function parseOptionsResponse(value: unknown): OptionsResponse | null {
  if (!isRecord(value)) return null
  const { defaults } = value
  if (
    !isOptionArray(value.analysts) ||
    value.analysts.length === 0 ||
    !Array.isArray(value.research_depths) ||
    !value.research_depths.every(isResearchDepth) ||
    !Array.isArray(value.providers) ||
    value.providers.length === 0 ||
    value.providers.length > 100 ||
    !value.providers.every(isProvider) ||
    !isOptionArray(value.output_languages) ||
    !isOptionArray(value.languages) ||
    !isStorage(value.storage) ||
    !isRecord(defaults) ||
    !isNonEmptyString(defaults.ticker) ||
    !isNonEmptyString(defaults.analysis_date) ||
    !isNonEmptyString(defaults.output_language) ||
    !isStringArray(defaults.analysts) ||
    (defaults.research_depth !== 1 && defaults.research_depth !== 3 && defaults.research_depth !== 5) ||
    !isNonEmptyString(defaults.llm_provider) ||
    !isNonEmptyString(defaults.quick_model) ||
    !isNonEmptyString(defaults.deep_model) ||
    (defaults.backend_url !== null && typeof defaults.backend_url !== 'string')
  ) return null
  return value as unknown as OptionsResponse
}

export function parseHealthResponse(value: unknown): HealthResponse | null {
  if (
    !isRecord(value) ||
    (value.status !== 'ok' && value.status !== 'degraded') ||
    !isNonEmptyString(value.service) ||
    typeof value.version !== 'string' ||
    !isStorage(value.storage) ||
    typeof value.active_runs !== 'number' ||
    !Number.isFinite(value.active_runs)
  ) return null
  return value as unknown as HealthResponse
}
