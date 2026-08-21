import { useEffect, useId, useMemo, useRef, useState } from 'react'
import type { OptionItem, OptionsResponse, ProviderOption, RunRequest } from '../api/types'
import {
  hydrateSettings,
  type PersistedSettings,
  usePersistedSettings,
} from '../hooks/usePersistedSettings'
import { isValidPastOrTodayDate, toLocalDateKey } from '../utils/date'

const TICKER_PATTERN = /^(?:[A-Z0-9._^=-]{1,32}|[A-Z0-9._^=-]{1,31}\+)$/
const CRYPTO_SUFFIXES = ['-USD', '-USDT', '-USDC', '-BTC', '-ETH']

interface FormState {
  ticker: string
  date: string
  language: string
  customLanguage: string
  analysts: string[]
  depth: 1 | 3 | 5
  provider: string
  quickModel: string
  customQuickModel: string
  deepModel: string
  customDeepModel: string
  backendUrl: string
  thinkingValue: string
}

export interface AnalysisControlProps {
  options: OptionsResponse
  disabled?: boolean
  submitting?: boolean
  active?: boolean
  persistPreferences?: boolean
  apiError?: string | null
  onSubmit: (request: RunRequest) => void | Promise<void>
  onClearApiError?: () => void
}

function optionIsCustom(option: OptionItem | undefined): boolean {
  return option?.id === 'custom' || option?.custom === true
}

function initialState(options: OptionsResponse): FormState {
  const hydrated = hydrateSettings(options)
  const provider = options.providers.find((item) => item.id === hydrated.llm_provider)
  return {
    ticker: (hydrated.ticker ?? options.defaults.ticker).toUpperCase(),
    date: hydrated.analysis_date ?? options.defaults.analysis_date,
    language: hydrated.output_language ?? options.defaults.output_language,
    customLanguage: hydrated.custom_output_language ?? '',
    analysts: hydrated.analysts ?? options.defaults.analysts,
    depth: hydrated.research_depth ?? options.defaults.research_depth,
    provider: hydrated.llm_provider ?? options.defaults.llm_provider,
    quickModel:
      hydrated.quick_model ?? provider?.default_quick_model ?? options.defaults.quick_model,
    customQuickModel: hydrated.custom_quick_model ?? '',
    deepModel: hydrated.deep_model ?? provider?.default_deep_model ?? options.defaults.deep_model,
    customDeepModel: hydrated.custom_deep_model ?? '',
    backendUrl: hydrated.backend_url ?? provider?.backend_url ?? '',
    thinkingValue:
      hydrated.thinking_value ?? provider?.thinking_control?.default ?? '',
  }
}

function validBackendUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return (
      (url.protocol === 'http:' || url.protocol === 'https:') &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash
    )
  } catch {
    return false
  }
}

function providerFor(options: OptionsResponse, id: string): ProviderOption | undefined {
  return options.providers.find((provider) => provider.id === id)
}

function selectedValue(options: OptionItem[], id: string, custom: string): string {
  return optionIsCustom(options.find((option) => option.id === id)) ? custom.trim() : id
}

function toPersisted(state: FormState): PersistedSettings {
  return {
    ticker: state.ticker,
    analysis_date: state.date,
    output_language: state.language,
    custom_output_language: state.customLanguage,
    analysts: state.analysts,
    research_depth: state.depth,
    llm_provider: state.provider,
    quick_model: state.quickModel,
    custom_quick_model: state.customQuickModel,
    deep_model: state.deepModel,
    custom_deep_model: state.customDeepModel,
    backend_url: state.backendUrl,
    thinking_value: state.thinkingValue,
  }
}

export function AnalysisControl({
  options,
  disabled = false,
  submitting = false,
  active = false,
  persistPreferences = true,
  apiError,
  onSubmit,
  onClearApiError,
}: AnalysisControlProps) {
  const [state, setState] = useState<FormState>(() => initialState(options))
  const formRef = useRef<HTMLFormElement>(null)
  const cryptoWasActive = useRef(false)
  const restoreFundamentals = useRef(false)
  const formId = useId()
  const persist = usePersistedSettings()
  const languages = options.output_languages.length ? options.output_languages : options.languages
  const provider = providerFor(options, state.provider)
  const isCrypto = CRYPTO_SUFFIXES.some((suffix) => state.ticker.endsWith(suffix))
  const fundamentals = options.analysts.find((item) => item.id.toLowerCase() === 'fundamentals')
  const languageOption = languages.find((item) => item.id === state.language)
  const quickOption = provider?.quick_models.find((item) => item.id === state.quickModel)
  const deepOption = provider?.deep_models.find((item) => item.id === state.deepModel)

  useEffect(() => {
    if (!persistPreferences) return
    persist(toPersisted(state))
  }, [persist, persistPreferences, state])

  useEffect(() => {
    const fundamentalsId = fundamentals?.id
    if (!fundamentalsId) return
    if (isCrypto && !cryptoWasActive.current) {
      restoreFundamentals.current = state.analysts.includes(fundamentalsId)
      if (restoreFundamentals.current) {
        setState((current) => ({
          ...current,
          analysts: current.analysts.filter((id) => id !== fundamentalsId),
        }))
      }
    } else if (!isCrypto && cryptoWasActive.current && restoreFundamentals.current) {
      setState((current) => ({
        ...current,
        analysts: current.analysts.includes(fundamentalsId)
          ? current.analysts
          : [...current.analysts, fundamentalsId],
      }))
    }
    cryptoWasActive.current = isCrypto
  }, [fundamentals?.id, isCrypto, state.analysts])

  const errors = useMemo(() => {
    const next: Record<string, string> = {}
    if (!TICKER_PATTERN.test(state.ticker)) {
      next.ticker = 'Use 1–32 uppercase ticker characters: letters, numbers, . _ ^ = - or a final +.'
    }
    if (!isValidPastOrTodayDate(state.date)) next.date = 'Choose a valid local date no later than today.'
    if (state.analysts.length === 0) next.analysts = 'Select at least one analyst.'
    if (!provider) next.provider = 'Choose an available provider.'
    if (!state.language || !languageOption || (optionIsCustom(languageOption) && !state.customLanguage.trim())) {
      next.language = 'Enter an output language.'
    }
    if (!options.research_depths.some((item) => item.id === state.depth)) {
      next.depth = 'Choose an available research depth.'
    }
    if (!state.quickModel || !quickOption || (optionIsCustom(quickOption) && !state.customQuickModel.trim())) {
      next.quickModel = 'Enter a quick model.'
    }
    if (!state.deepModel || !deepOption || (optionIsCustom(deepOption) && !state.customDeepModel.trim())) {
      next.deepModel = 'Enter a deep model.'
    }
    if (provider?.requires_backend_url && !state.backendUrl.trim()) {
      next.backendUrl = 'This provider requires a backend URL.'
    } else if (state.backendUrl.trim() && !validBackendUrl(state.backendUrl.trim())) {
      next.backendUrl = 'Use an absolute HTTP(S) URL without credentials, query, or fragment.'
    }
    if (provider?.thinking_control && !state.thinkingValue) {
      next.thinkingValue = `Choose ${provider.thinking_control.label.toLowerCase()}.`
    }
    return next
  }, [deepOption, languageOption, options.research_depths, provider, quickOption, state])

  const launchDisabled = disabled || submitting || active || Object.keys(errors).length > 0

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.ctrlKey && event.key === 'Enter') {
        event.preventDefault()
        if (!launchDisabled) formRef.current?.requestSubmit()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [launchDisabled])

  const update = <K extends keyof FormState>(key: K, value: FormState[K]): void => {
    onClearApiError?.()
    setState((current) => ({ ...current, [key]: value }))
  }

  const switchProvider = (providerId: string): void => {
    const next = providerFor(options, providerId)
    setState((current) => ({
      ...current,
      provider: providerId,
      quickModel: next?.default_quick_model ?? next?.quick_models[0]?.id ?? '',
      customQuickModel: '',
      deepModel: next?.default_deep_model ?? next?.deep_models[0]?.id ?? '',
      customDeepModel: '',
      backendUrl: next?.backend_url ?? '',
      thinkingValue: next?.thinking_control?.default ?? next?.thinking_control?.options[0]?.id ?? '',
    }))
    onClearApiError?.()
  }

  const submit = (event: React.FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    if (launchDisabled || !provider) return
    const request: RunRequest = {
      ticker: state.ticker,
      analysis_date: state.date,
      output_language: selectedValue(languages, state.language, state.customLanguage),
      analysts: [...new Set(state.analysts)],
      research_depth: state.depth,
      llm_provider: state.provider,
      quick_model: selectedValue(provider.quick_models, state.quickModel, state.customQuickModel),
      deep_model: selectedValue(provider.deep_models, state.deepModel, state.customDeepModel),
    }
    if (provider.supports_backend_url && state.backendUrl.trim()) {
      request.backend_url = state.backendUrl.trim().replace(/\/$/, '')
    }
    const thinking = provider.thinking_control
    if (thinking && state.thinkingValue) {
      if (thinking.key === 'thinking_level' && ['high', 'minimal'].includes(state.thinkingValue)) {
        request.thinking_level = state.thinkingValue as 'high' | 'minimal'
      }
      if (thinking.key === 'reasoning_effort' && ['low', 'medium', 'high'].includes(state.thinkingValue)) {
        request.reasoning_effort = state.thinkingValue as 'low' | 'medium' | 'high'
      }
      if (thinking.key === 'anthropic_effort' && ['low', 'medium', 'high'].includes(state.thinkingValue)) {
        request.anthropic_effort = state.thinkingValue as 'low' | 'medium' | 'high'
      }
    }
    void onSubmit(request)
  }

  const fieldError = (key: string): React.ReactNode =>
    errors[key] ? (
      <span className="field-error" id={`${formId}-${key}-error`}>
        {errors[key]}
      </span>
    ) : null

  return (
    <form className="terminal-form" ref={formRef} onSubmit={submit} noValidate>
      <section className="form-section" aria-labelledby={`${formId}-instrument`}>
        <h3 id={`${formId}-instrument`}>INSTRUMENT</h3>
        <div className="form-grid">
          <div className="field field--ticker">
            <label htmlFor={`${formId}-ticker`}>Symbol / Ticker</label>
            <span className="ticker-input">
              <span aria-hidden="true">$</span>
              <input
                id={`${formId}-ticker`}
                value={state.ticker}
                onChange={(event) => update('ticker', event.target.value.toUpperCase().slice(0, 32))}
                maxLength={32}
                autoCapitalize="characters"
                autoComplete="off"
                spellCheck={false}
                aria-invalid={Boolean(errors.ticker)}
                aria-describedby={errors.ticker ? `${formId}-ticker-error` : undefined}
              />
            </span>
            {fieldError('ticker')}
          </div>
          <label className="field">
            <span>As-of Date</span>
            <input
              type="date"
              value={state.date}
              max={toLocalDateKey()}
              onChange={(event) => update('date', event.target.value)}
              aria-invalid={Boolean(errors.date)}
              aria-describedby={errors.date ? `${formId}-date-error` : undefined}
            />
            {fieldError('date')}
          </label>
        </div>
      </section>

      <section className="form-section" aria-labelledby={`${formId}-research`}>
        <h3 id={`${formId}-research`}>RESEARCH PARAMETERS</h3>
        <div className="form-grid">
          <label className="field">
            <span>Output Language</span>
            <select value={state.language} onChange={(event) => update('language', event.target.value)}>
              {languages.map((item) => (
                <option key={item.id} value={item.id}>{item.label}</option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Research Depth</span>
            <select
              value={state.depth}
              onChange={(event) => update('depth', Number(event.target.value) as 1 | 3 | 5)}
              aria-invalid={Boolean(errors.depth)}
              aria-describedby={errors.depth ? `${formId}-depth-error` : undefined}
            >
              {options.research_depths.map((item) => (
                <option key={item.id} value={item.id}>{item.label} — {item.description}</option>
              ))}
            </select>
            {fieldError('depth')}
          </label>
        </div>
        {optionIsCustom(languageOption) && (
          <div className="field">
            <label htmlFor={`${formId}-custom-language`}>Custom Output Language</label>
            <input
              id={`${formId}-custom-language`}
              value={state.customLanguage}
              maxLength={80}
              onChange={(event) => update('customLanguage', event.target.value)}
              aria-invalid={Boolean(errors.language)}
              aria-describedby={errors.language ? `${formId}-language-error` : undefined}
            />
            {fieldError('language')}
          </div>
        )}
        <fieldset className="analyst-fieldset" aria-describedby={errors.analysts ? `${formId}-analysts-error` : undefined}>
          <legend>Analyst Team <span>{state.analysts.length} selected</span></legend>
          <div className="analyst-grid">
            {options.analysts.map((analyst) => {
              const cryptoDisabled = isCrypto && analyst.id === fundamentals?.id
              return (
                <label key={analyst.id} className={cryptoDisabled ? 'is-disabled' : undefined}>
                  <input
                    type="checkbox"
                    checked={state.analysts.includes(analyst.id)}
                    disabled={cryptoDisabled}
                    onChange={(event) => {
                      update(
                        'analysts',
                        event.target.checked
                          ? [...new Set([...state.analysts, analyst.id])]
                          : state.analysts.filter((id) => id !== analyst.id),
                      )
                    }}
                  />
                  <span>{analyst.label}</span>
                </label>
              )
            })}
          </div>
          {isCrypto && fundamentals && (
            <p className="field-note">Fundamentals is unavailable for crypto pairs and will be restored for equities.</p>
          )}
          {fieldError('analysts')}
        </fieldset>
      </section>

      <section className="form-section" aria-labelledby={`${formId}-routing`}>
        <h3 id={`${formId}-routing`}>MODEL ROUTING</h3>
        <label className="field">
          <span>Provider</span>
          <select
            value={state.provider}
            disabled={disabled}
            onChange={(event) => switchProvider(event.target.value)}
            aria-invalid={Boolean(errors.provider)}
          >
            {options.providers.map((item) => (
              <option key={item.id} value={item.id}>{item.label}</option>
            ))}
          </select>
          {fieldError('provider')}
        </label>
        <div className="form-grid model-routing-grid">
          <label className="field">
            <span>Quick Model</span>
            <select disabled={disabled} value={state.quickModel} onChange={(event) => update('quickModel', event.target.value)}>
              {provider?.quick_models.map((item) => (
                <option key={item.id} value={item.id}>{item.label}</option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Deep Model</span>
            <select disabled={disabled} value={state.deepModel} onChange={(event) => update('deepModel', event.target.value)}>
              {provider?.deep_models.map((item) => (
                <option key={item.id} value={item.id}>{item.label}</option>
              ))}
            </select>
          </label>
        </div>
        {optionIsCustom(quickOption) && (
          <div className="field">
            <label htmlFor={`${formId}-custom-quick`}>Custom Quick Model</label>
            <input
              id={`${formId}-custom-quick`}
              value={state.customQuickModel}
              disabled={disabled}
              maxLength={160}
              onChange={(event) => update('customQuickModel', event.target.value)}
              aria-invalid={Boolean(errors.quickModel)}
              aria-describedby={errors.quickModel ? `${formId}-quickModel-error` : undefined}
            />
            {fieldError('quickModel')}
          </div>
        )}
        {optionIsCustom(deepOption) && (
          <div className="field">
            <label htmlFor={`${formId}-custom-deep`}>Custom Deep Model</label>
            <input
              id={`${formId}-custom-deep`}
              value={state.customDeepModel}
              disabled={disabled}
              maxLength={160}
              onChange={(event) => update('customDeepModel', event.target.value)}
              aria-invalid={Boolean(errors.deepModel)}
              aria-describedby={errors.deepModel ? `${formId}-deepModel-error` : undefined}
            />
            {fieldError('deepModel')}
          </div>
        )}
        {provider?.supports_backend_url && (
          <div className="field">
            <label htmlFor={`${formId}-backend-url`}>
              Backend URL {provider.requires_backend_url ? '(Required)' : '(Optional)'}
            </label>
            <input
              id={`${formId}-backend-url`}
              type="url"
              value={state.backendUrl}
              disabled={disabled}
              list={`${formId}-backend-urls`}
              placeholder="http://127.0.0.1:11434"
              onChange={(event) => update('backendUrl', event.target.value)}
              aria-invalid={Boolean(errors.backendUrl)}
              aria-describedby={errors.backendUrl ? `${formId}-backendUrl-error` : undefined}
            />
            {provider.backend_urls && (
              <datalist id={`${formId}-backend-urls`}>
                {provider.backend_urls.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
              </datalist>
            )}
            {fieldError('backendUrl')}
          </div>
        )}
        {provider?.thinking_control && (
          <label className="field">
            <span>{provider.thinking_control.label}</span>
            <select disabled={disabled} value={state.thinkingValue} onChange={(event) => update('thinkingValue', event.target.value)}>
              {provider.thinking_control.options.map((item) => (
                <option key={item.id} value={item.id}>{item.label}</option>
              ))}
            </select>
            {fieldError('thinkingValue')}
          </label>
        )}
      </section>

      {apiError && <div className="form-api-error" role="alert">{apiError}</div>}
      <button type="submit" className="launch-button" disabled={launchDisabled}>
        <span className="launch-button__key">GO</span>
        <span className="launch-button__copy">
          <strong>Run Intelligence Cycle</strong>
          <small>
            {active
              ? 'ANOTHER RUN IS ACTIVE'
              : submitting
                ? 'SUBMITTING TO AGENT NETWORK'
                : `${state.ticker || 'SYMBOL'} · ${state.analysts.length} ANALYSTS · DEPTH ${state.depth}`}
          </small>
        </span>
        <span className="launch-button__arrow" aria-hidden="true">›</span>
      </button>
      <p className="keyboard-hint"><kbd>CTRL</kbd> + <kbd>ENTER</kbd> TO LAUNCH</p>
    </form>
  )
}
