const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

export function toLocalDateKey(date: Date = new Date()): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function parseLocalDate(value: string): Date | null {
  if (!DATE_PATTERN.test(value)) return null
  const [yearText, monthText, dayText] = value.split('-')
  const year = Number(yearText)
  const month = Number(monthText)
  const day = Number(dayText)
  const result = new Date(year, month - 1, day)
  if (
    result.getFullYear() !== year ||
    result.getMonth() !== month - 1 ||
    result.getDate() !== day
  ) {
    return null
  }
  return result
}

export function addLocalDays(value: string, amount: number): string {
  const date = parseLocalDate(value) ?? new Date()
  date.setDate(date.getDate() + amount)
  return toLocalDateKey(date)
}

export function formatLocalDate(value: string): string {
  const date = parseLocalDate(value)
  if (!date) return value
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: '2-digit',
  }).format(date)
}

export function isValidPastOrTodayDate(value: string): boolean {
  return parseLocalDate(value) !== null && value <= toLocalDateKey()
}
