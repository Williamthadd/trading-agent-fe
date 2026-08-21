export interface ValidationIssue {
  loc?: Array<string | number>
  msg?: string
  type?: string
}

export class ApiError extends Error {
  readonly status: number | null
  readonly retryAfter: number | null
  readonly issues: ValidationIssue[]
  readonly body: unknown

  constructor(
    message: string,
    options: {
      status?: number | null
      retryAfter?: number | null
      issues?: ValidationIssue[]
      body?: unknown
      cause?: unknown
    } = {},
  ) {
    super(message, { cause: options.cause })
    this.name = 'ApiError'
    this.status = options.status ?? null
    this.retryAfter = options.retryAfter ?? null
    this.issues = options.issues ?? []
    this.body = options.body
  }
}

const STATUS_MESSAGES: Record<number, string> = {
  401: 'Your session has expired. Please sign in again.',
  403: 'This account is not authorized to access the workstation.',
  422: 'Review the highlighted analysis settings and try again.',
  429: 'The analysis queue is full. Please wait before trying again.',
  503: 'The requested service is not configured or is temporarily unavailable.',
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function validationMessage(issues: ValidationIssue[]): string {
  return issues
    .map((issue) => {
      const field = issue.loc?.filter((part) => part !== 'body').join('.')
      return field ? `${field}: ${issue.msg ?? 'Invalid value'}` : issue.msg ?? 'Invalid value'
    })
    .join('; ')
}

export function apiErrorFromResponse(
  response: Response,
  body: unknown,
): ApiError {
  let message = STATUS_MESSAGES[response.status] ?? `Request failed (${response.status}).`
  let issues: ValidationIssue[] = []

  if (isRecord(body)) {
    const detail = body.detail
    const exposeDetail = ![401, 403, 429, 503].includes(response.status)
    if (typeof detail === 'string' && detail.trim() && exposeDetail) {
      message = detail.trim()
    } else if (Array.isArray(detail)) {
      issues = detail.filter(isRecord).map((item) => {
        const issue: ValidationIssue = {}
        if (Array.isArray(item.loc)) {
          issue.loc = item.loc.filter(
            (entry): entry is string | number =>
              typeof entry === 'string' || typeof entry === 'number',
          )
        }
        if (typeof item.msg === 'string') issue.msg = item.msg
        if (typeof item.type === 'string') issue.type = item.type
        return issue
      })
      if (issues.length > 0) message = validationMessage(issues)
    } else if (typeof body.message === 'string' && body.message.trim()) {
      message = body.message.trim()
    }
  }

  const retryHeader = response.headers.get('Retry-After')
  const retryValue = retryHeader ? Number.parseInt(retryHeader, 10) : Number.NaN
  return new ApiError(message, {
    status: response.status,
    retryAfter: Number.isFinite(retryValue) ? retryValue : null,
    issues,
    body,
  })
}

export function readableError(error: unknown, fallback = 'Something went wrong.'): string {
  if (error instanceof ApiError) return error.message
  if (error instanceof DOMException && error.name === 'AbortError') return 'Request cancelled.'
  if (error instanceof TypeError) return 'Unable to reach the TradingAgents API. Check that the backend is running.'
  if (error instanceof Error && error.message.trim()) return error.message
  return fallback
}
