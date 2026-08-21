import type { RunEvent, TradingRun } from '../api/types'

const ACTIVE = new Set(['queued', 'pending', 'running', 'processing', 'in_progress'])
const COMPLETE = new Set(['completed', 'complete', 'done', 'success', 'succeeded'])
const FAILED = new Set(['failed', 'failure', 'error', 'errored'])
const CANCELLED = new Set(['cancelled', 'canceled'])

export type NormalizedStatus = 'active' | 'completed' | 'failed' | 'cancelled' | 'unknown'

export function isTerminalStatus(status: string | undefined): boolean {
  const normalized = (status ?? '').toLowerCase()
  return COMPLETE.has(normalized) || FAILED.has(normalized) || CANCELLED.has(normalized)
}

export function normalizeStatus(status: string | undefined): NormalizedStatus {
  const normalized = (status ?? '').toLowerCase()
  if (ACTIVE.has(normalized)) return 'active'
  if (COMPLETE.has(normalized)) return 'completed'
  if (FAILED.has(normalized)) return 'failed'
  if (CANCELLED.has(normalized)) return 'cancelled'
  return 'unknown'
}

export function displayStatus(status: string | undefined): string {
  return (status || 'standby').replaceAll('_', ' ').toUpperCase()
}

export function runProgress(run: TradingRun | null): number {
  if (!run) return 0
  const value = run.progress
  let numeric = 0
  if (typeof value === 'number') numeric = value
  else if (value && typeof value === 'object') {
    if (typeof value.percent === 'number') numeric = value.percent
    else if (typeof value.fraction === 'number') numeric = value.fraction * 100
    else if (typeof value.value === 'number') numeric = value.value
  }
  if (numeric > 0 && numeric <= 1) numeric *= 100
  if (isTerminalStatus(run.status) && run.status.toLowerCase() === 'completed') numeric = 100
  return Math.min(100, Math.max(0, Math.round(numeric)))
}

export function safeText(value: unknown, maximum = 50_000): string {
  let result: string
  if (typeof value === 'string') result = value
  else if (value === null || value === undefined) result = ''
  else if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    result = String(value)
  } else {
    try {
      result = JSON.stringify(value, null, 2)
    } catch {
      result = '[Unserializable data]'
    }
  }
  return result.length > maximum ? `${result.slice(0, maximum)}\n…[content truncated]` : result
}

export interface NormalizedEvent {
  id: string
  time: string | null
  agent: string
  message: string
  status: string | null
  sequence: number
}

function eventEntries(events: TradingRun['events']): Array<RunEvent | string> {
  if (Array.isArray(events)) return events as Array<RunEvent | string>
  if (events && typeof events === 'object') return Object.values(events)
  return []
}

export function normalizeEvents(run: TradingRun | null): NormalizedEvent[] {
  if (!run) return []
  return eventEntries(run.events)
    .map((entry, index): NormalizedEvent => {
      if (typeof entry === 'string') {
        return {
          id: `${run.run_id}:${index}`,
          time: null,
          agent: 'SYSTEM',
          message: entry,
          status: null,
          sequence: Number.POSITIVE_INFINITY,
        }
      }
      const message = entry.message ?? entry.content ?? entry.data ?? entry.type ?? ''
      return {
        id: String(entry.event_id ?? entry.id ?? `${run.run_id}:${index}`),
        time:
          typeof entry.created_at === 'string'
            ? entry.created_at
            : typeof entry.timestamp === 'string'
              ? entry.timestamp
              : null,
        agent:
          typeof entry.agent === 'string'
            ? entry.agent
            : typeof entry.type === 'string'
              ? entry.type
              : 'SYSTEM',
        message: safeText(message, 20_000) || 'Event received',
        status: typeof entry.status === 'string' ? entry.status : null,
        sequence:
          typeof entry.sequence === 'number' && Number.isFinite(entry.sequence)
            ? entry.sequence
            : Number.POSITIVE_INFINITY,
      }
    })
    .sort((a, b) => a.sequence - b.sequence)
    .slice(-500)
}

export interface ExtractedReport {
  label: string
  content: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function addReport(target: ExtractedReport[], seen: Set<string>, label: string, value: unknown): void {
  const content = safeText(value, 200_000).trim()
  if (!content) return
  const key = `${label}\0${content}`
  if (seen.has(key)) return
  seen.add(key)
  target.push({ label, content })
}

function collectContainer(target: ExtractedReport[], seen: Set<string>, value: unknown): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      if (isRecord(item)) {
        const label =
          typeof item.label === 'string'
            ? item.label
            : typeof item.name === 'string'
              ? item.name
              : typeof item.key === 'string'
                ? item.key
                : `report_${index + 1}`
        addReport(target, seen, label, item.content ?? item.report ?? item.text ?? item)
      } else {
        addReport(target, seen, `report_${index + 1}`, item)
      }
    })
  } else if (isRecord(value)) {
    Object.entries(value).forEach(([label, content]) => addReport(target, seen, label, content))
  }
}

const DIRECT_REPORTS = [
  'market_report',
  'sentiment_report',
  'news_report',
  'fundamentals_report',
  'trader_investment_plan',
] as const

export function extractReports(run: TradingRun | null): ExtractedReport[] {
  if (!run) return []
  const reports: ExtractedReport[] = []
  const seen = new Set<string>()
  collectContainer(reports, seen, run.reports)
  if (isRecord(run.result)) collectContainer(reports, seen, run.result.reports)

  const containers = [run, isRecord(run.result) ? run.result : {}, run.final_state ?? {}]
  for (const key of DIRECT_REPORTS) {
    for (const source of containers) addReport(reports, seen, key, source[key])
  }

  const debatePaths: Array<[string, string, string]> = [
    ['investment_debate_state', 'bull_history', 'bull_history'],
    ['investment_debate_state', 'bear_history', 'bear_history'],
    ['investment_debate_state', 'judge_decision', 'judge_decision'],
    ['risk_debate_state', 'aggressive_history', 'aggressive_history'],
    ['risk_debate_state', 'conservative_history', 'conservative_history'],
    ['risk_debate_state', 'neutral_history', 'neutral_history'],
  ]
  for (const [containerKey, field, label] of debatePaths) {
    for (const source of containers) {
      const nested = source[containerKey]
      if (isRecord(nested)) addReport(reports, seen, label, nested[field])
      addReport(reports, seen, label, source[field])
    }
  }
  return reports
}

export function humanizeLabel(value: string): string {
  return value
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (character) => character.toUpperCase())
}

export interface ExtractedDecision {
  signal: string
  narrative: string
  raw: string
  fields: Array<[string, string]>
}

const SIGNAL_KEYS = ['action', 'signal', 'recommendation', 'decision', 'position', 'verdict']
const NARRATIVE_KEYS = [
  'final_trade_decision',
  'narrative',
  'reasoning',
  'analysis',
  'rationale',
  'summary',
  'content',
]

function findString(record: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return ''
}

function decisionCandidates(run: TradingRun): unknown[] {
  const reports = isRecord(run.reports) ? run.reports : {}
  const result = isRecord(run.result) ? run.result : {}
  const finalState = isRecord(run.final_state) ? run.final_state : {}
  const runRisk = isRecord(run.risk_debate_state) ? run.risk_debate_state : {}
  const resultRisk = isRecord(result.risk_debate_state) ? result.risk_debate_state : {}
  const finalRisk = isRecord(finalState.risk_debate_state) ? finalState.risk_debate_state : {}
  return [
    reports.final_trade_decision,
    run.final_trade_decision,
    result.final_trade_decision,
    finalState.final_trade_decision,
    run.final_decision,
    run.decision,
    result.final_decision,
    result.decision,
    finalRisk.judge_decision,
    resultRisk.judge_decision,
    runRisk.judge_decision,
  ]
}

export function extractDecision(run: TradingRun | null): ExtractedDecision | null {
  if (!run) return null
  const candidates = decisionCandidates(run).filter(
    (value) => value !== null && value !== undefined && safeText(value).trim(),
  )
  if (!candidates.length) return null

  const structured = candidates.find(isRecord)
  const shortCandidate = [run.decision, run.final_decision].find(isRecord)
  const signal =
    (shortCandidate ? findString(shortCandidate, SIGNAL_KEYS) : '') ||
    (structured ? findString(structured, SIGNAL_KEYS) : '') ||
    (typeof run.final_decision === 'string' && run.final_decision.length < 80 ? run.final_decision : '') ||
    (typeof run.decision === 'string' && run.decision.length < 80 ? run.decision : '') ||
    'REVIEW'

  let narrative = ''
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) {
      narrative = candidate.trim()
      break
    }
    if (isRecord(candidate)) {
      narrative = findString(candidate, NARRATIVE_KEYS)
      if (narrative) break
    }
  }
  if (!narrative) narrative = safeText(candidates[0], 200_000)

  const fields: Array<[string, string]> = []
  if (structured) {
    for (const [key, value] of Object.entries(structured)) {
      if (SIGNAL_KEYS.includes(key) || NARRATIVE_KEYS.includes(key)) continue
      if (['string', 'number', 'boolean'].includes(typeof value)) {
        fields.push([humanizeLabel(key), String(value)])
      }
      if (fields.length === 12) break
    }
  }
  return {
    signal: signal.toUpperCase(),
    narrative,
    raw: safeText(candidates[0], 200_000),
    fields,
  }
}

export function rawRunSignature(run: TradingRun | null, key: 'reports' | 'decision'): string {
  if (!run) return 'standby'
  const parts: string[] = []
  if (key === 'reports') {
    for (const report of extractReports(run)) parts.push(report.label, report.content)
  } else {
    const decision = extractDecision(run)
    if (decision) {
      parts.push(decision.signal, decision.narrative, decision.raw)
      for (const [label, value] of decision.fields) parts.push(label, value)
    }
  }

  let hashA = 0x811c9dc5
  let hashB = 0x9e3779b9
  let totalLength = 0
  for (const part of parts) {
    totalLength += part.length
    hashA = Math.imul(hashA ^ part.length, 0x01000193)
    hashB = Math.imul(hashB ^ part.length, 0x85ebca6b)
    for (let index = 0; index < part.length; index += 1) {
      const code = part.charCodeAt(index)
      hashA = Math.imul(hashA ^ code, 0x01000193)
      hashB = Math.imul(hashB ^ code, 0xc2b2ae35)
    }
  }
  return `${run.run_id}:${key}:${parts.length}:${totalLength}:${(hashA >>> 0).toString(16)}:${(hashB >>> 0).toString(16)}`
}
