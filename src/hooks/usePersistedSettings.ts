import { useCallback } from 'react'
import type { OptionsResponse } from '../api/types'
import { isValidPastOrTodayDate, toLocalDateKey } from '../utils/date'

export const SETTINGS_KEY = 'tradingagents.web.settings.v1'
const STORED_TICKER_PATTERN = /^(?:[A-Z0-9._^=-]{1,32}|[A-Z0-9._^=-]{1,31}\+)$/

export interface PersistedSettings {
  ticker?: string
  analysis_date?: string
  output_language?: string
  custom_output_language?: string
  analysts?: string[]
  research_depth?: 1 | 3 | 5
  llm_provider?: string
  quick_model?: string
  custom_quick_model?: string
  deep_model?: string
  custom_deep_model?: string
  backend_url?: string
  thinking_value?: string
}

function readStored(): PersistedSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    if (!raw) return {}
    const parsed: unknown = JSON.parse(raw)
    return typeof parsed === 'object' && parsed !== null ? (parsed as PersistedSettings) : {}
  } catch {
    return {}
  }
}

function hasOption(options: Array<{ id: string }>, value: unknown): value is string {
  return typeof value === 'string' && options.some((option) => option.id === value)
}

function isCustomOption(
  options: Array<{ id: string; custom?: boolean }>,
  value: string,
): boolean {
  const option = options.find((item) => item.id === value)
  return option?.id === 'custom' || option?.custom === true
}

function optionFallback(
  options: Array<{ id: string; custom?: boolean }>,
  preferred: unknown,
): string {
  if (hasOption(options, preferred)) return preferred
  return options.find((item) => item.id !== 'custom' && item.custom !== true)?.id
    ?? options[0]?.id
    ?? ''
}

function safeStoredUrl(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null
  try {
    const url = new URL(value.trim())
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    ) return null
    return value.trim()
  } catch {
    return null
  }
}

export function hydrateSettings(options: OptionsResponse): PersistedSettings {
  const saved = readStored()
  const languages = options.output_languages.length ? options.output_languages : options.languages
  const provider = optionFallback(
    options.providers,
    hasOption(options.providers, saved.llm_provider)
      ? saved.llm_provider
      : options.defaults.llm_provider,
  )
  const providerOption = options.providers.find((item) => item.id === provider) ?? options.providers[0]
  const validAnalysts = new Set(options.analysts.map((item) => item.id))
  const savedAnalysts = Array.isArray(saved.analysts)
    ? [...new Set(saved.analysts.filter((item) => validAnalysts.has(item)))]
    : []
  const depths = options.research_depths.map((item) => item.id)
  const savedDepth = saved.research_depth
  const defaultDepth = depths.includes(options.defaults.research_depth)
    ? options.defaults.research_depth
    : options.research_depths[0]?.id ?? 1
  const depth: 1 | 3 | 5 =
    savedDepth !== undefined && depths.includes(savedDepth)
      ? savedDepth
      : defaultDepth
  const configuredAnalysts = [...new Set(options.defaults.analysts.filter((item) => validAnalysts.has(item)))]
  const defaultAnalysts = configuredAnalysts.length
    ? configuredAnalysts
    : options.analysts[0]
      ? [options.analysts[0].id]
      : []
  const defaultLanguage = optionFallback(languages, options.defaults.output_language)
  const language = optionFallback(
    languages,
    hasOption(languages, saved.output_language) ? saved.output_language : defaultLanguage,
  )
  const customLanguage = typeof saved.custom_output_language === 'string'
    ? saved.custom_output_language.trim()
    : ''
  const selectedLanguage = isCustomOption(languages, language) && !customLanguage
    ? optionFallback(languages.filter((item) => item.id !== language), defaultLanguage)
    : language
  const defaultQuick = providerOption
    ? optionFallback(providerOption.quick_models, providerOption.default_quick_model ?? options.defaults.quick_model)
    : options.defaults.quick_model
  const defaultDeep = providerOption
    ? optionFallback(providerOption.deep_models, providerOption.default_deep_model ?? options.defaults.deep_model)
    : options.defaults.deep_model
  const savedQuick = providerOption && hasOption(providerOption.quick_models, saved.quick_model)
    ? saved.quick_model
    : defaultQuick
  const savedDeep = providerOption && hasOption(providerOption.deep_models, saved.deep_model)
    ? saved.deep_model
    : defaultDeep
  const customQuick = typeof saved.custom_quick_model === 'string' ? saved.custom_quick_model.trim() : ''
  const customDeep = typeof saved.custom_deep_model === 'string' ? saved.custom_deep_model.trim() : ''
  const quickModel = providerOption && isCustomOption(providerOption.quick_models, savedQuick) && !customQuick
    ? optionFallback(providerOption.quick_models.filter((item) => item.id !== savedQuick), defaultQuick)
    : savedQuick
  const deepModel = providerOption && isCustomOption(providerOption.deep_models, savedDeep) && !customDeep
    ? optionFallback(providerOption.deep_models.filter((item) => item.id !== savedDeep), defaultDeep)
    : savedDeep
  const savedBackend = providerOption?.supports_backend_url ? safeStoredUrl(saved.backend_url) : null
  const thinkingOptions = providerOption?.thinking_control?.options ?? []
  const thinkingValue = optionFallback(
    thinkingOptions,
    hasOption(thinkingOptions, saved.thinking_value)
      ? saved.thinking_value
      : providerOption?.thinking_control?.default,
  )
  const defaultTicker = STORED_TICKER_PATTERN.test(options.defaults.ticker.toUpperCase())
    ? options.defaults.ticker.toUpperCase()
    : ''
  const defaultDate = isValidPastOrTodayDate(options.defaults.analysis_date)
    ? options.defaults.analysis_date
    : toLocalDateKey()

  return {
    ticker:
      typeof saved.ticker === 'string' && STORED_TICKER_PATTERN.test(saved.ticker.toUpperCase())
        ? saved.ticker.toUpperCase()
        : defaultTicker,
    analysis_date:
      typeof saved.analysis_date === 'string' && isValidPastOrTodayDate(saved.analysis_date)
        ? saved.analysis_date
        : defaultDate,
    output_language: selectedLanguage,
    custom_output_language: customLanguage,
    analysts: savedAnalysts.length ? savedAnalysts : defaultAnalysts,
    research_depth: depth,
    llm_provider: provider,
    quick_model: quickModel,
    custom_quick_model: customQuick,
    deep_model: deepModel,
    custom_deep_model: customDeep,
    backend_url:
      savedBackend ?? providerOption?.backend_url ?? options.defaults.backend_url ?? '',
    thinking_value: thinkingValue,
  }
}

export function usePersistedSettings(): (settings: PersistedSettings) => void {
  return useCallback((settings: PersistedSettings) => {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings))
    } catch {
      // Persistence is an enhancement; private browsing may deny storage.
    }
  }, [])
}
