const EXPECTED_FIREBASE_PROJECT_ID = 'trading-agent-6457f'
const REQUIRED_FIREBASE_VARIABLES = [
  'VITE_FIREBASE_API_KEY',
  'VITE_FIREBASE_AUTH_DOMAIN',
  'VITE_FIREBASE_PROJECT_ID',
  'VITE_FIREBASE_APP_ID',
  'VITE_FIREBASE_DATABASE_ID',
]

function nonEmptyEnvironmentValue(name) {
  const value = process.env[name]
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

const problems = []
const missing = REQUIRED_FIREBASE_VARIABLES.filter(
  (name) => nonEmptyEnvironmentValue(name) === null,
)

if (missing.length > 0) {
  problems.push(`Missing required variables: ${missing.join(', ')}`)
}

const projectId = nonEmptyEnvironmentValue('VITE_FIREBASE_PROJECT_ID')
if (projectId !== null && projectId !== EXPECTED_FIREBASE_PROJECT_ID) {
  problems.push(
    `VITE_FIREBASE_PROJECT_ID must be ${EXPECTED_FIREBASE_PROJECT_ID} for this deployment.`,
  )
}

const databaseId = nonEmptyEnvironmentValue('VITE_FIREBASE_DATABASE_ID')
if (databaseId !== null && databaseId !== '(default)') {
  problems.push('VITE_FIREBASE_DATABASE_ID must be exactly (default).')
}

const apiOrigin = nonEmptyEnvironmentValue('VITE_TRADINGAGENTS_API_URL')
if (apiOrigin !== null) {
  try {
    const url = new URL(apiOrigin)
    const normalizedPath = url.pathname.replace(/\/+$/u, '')
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      normalizedPath ||
      url.search ||
      url.hash
    ) {
      throw new Error('invalid production API origin')
    }
  } catch {
    problems.push(
      'VITE_TRADINGAGENTS_API_URL must be a public HTTPS origin without credentials, a path, query string, or fragment. Omit it for history-only mode.',
    )
  }
}

if (problems.length > 0) {
  console.error('Vercel deployment environment validation failed:')
  for (const problem of problems) console.error(`- ${problem}`)
  process.exitCode = 1
} else {
  console.log(
    `Vercel environment validated for Firebase project ${EXPECTED_FIREBASE_PROJECT_ID}.`,
  )
}
