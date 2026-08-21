import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDirectory = dirname(fileURLToPath(import.meta.url))
const workspace = resolve(scriptDirectory, '..')
const rulesFile = join(workspace, 'firestore.rules')
const firebaseConfig = join(workspace, 'firebase.json')
const testFile = join(workspace, 'tests', 'firestore.rules.test.ts')
const temporaryConfig = join(
  scriptDirectory,
  `.vitest-firestore-rules.${process.pid}.config.mjs`,
)

function assertTemporaryPath(target, prefix) {
  const resolvedTarget = resolve(target)
  const relativeTarget = relative(scriptDirectory, resolvedTarget)
  if (
    !relativeTarget.startsWith(prefix) ||
    relativeTarget.includes('/') ||
    relativeTarget.includes('\\')
  ) {
    throw new Error(`Refusing to clean up an unexpected temporary path: ${resolvedTarget}`)
  }
  return resolvedTarget
}

const verifiedTemporaryConfig = assertTemporaryPath(
  temporaryConfig,
  '.vitest-firestore-rules.',
)

const projectId =
  process.env.FIREBASE_RULES_TEST_PROJECT_ID ?? 'demo-tradingagents-rules'

if (!/^demo-[a-z0-9][a-z0-9-]{3,40}$/.test(projectId)) {
  throw new Error(
    'FIREBASE_RULES_TEST_PROJECT_ID must be a demo-* project ID; refusing to run rules tests against a production project.',
  )
}

for (const requiredFile of [rulesFile, firebaseConfig, testFile]) {
  if (!existsSync(requiredFile)) {
    throw new Error(`Required rules-test file is missing: ${requiredFile}`)
  }
}

function packageExecutable(packageName) {
  const packageRoot = join(workspace, 'node_modules', packageName)
  const manifestPath = join(packageRoot, 'package.json')
  if (!existsSync(manifestPath)) {
    throw new Error(
      `${packageName} is not installed. Run npm install before the rules tests.`,
    )
  }

  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  const binary =
    typeof manifest.bin === 'string'
      ? manifest.bin
      : manifest.bin?.firebase ?? manifest.bin?.vitest
  if (typeof binary !== 'string') {
    throw new Error(`Could not locate the ${packageName} executable.`)
  }
  return join(packageRoot, binary)
}

function quoteForCommand(value) {
  if (process.platform === 'win32') {
    return `"${value.replaceAll('"', '""')}"`
  }
  return `'${value.replaceAll("'", "'\\''")}'`
}

const rulesTestRelativePath = relative(workspace, testFile).replaceAll('\\', '/')
const temporaryConfigSource = `export default {
  root: ${JSON.stringify(workspace)},
  test: {
    include: [${JSON.stringify(rulesTestRelativePath)}],
    environment: 'node',
    setupFiles: [],
    globals: false,
    isolate: true,
    fileParallelism: false,
  },
}\n`

let exitCode = 1
let firebaseCliConfigDirectory = null
try {
  firebaseCliConfigDirectory = mkdtempSync(
    join(scriptDirectory, '.firebase-cli-config.'),
  )
  const verifiedFirebaseCliConfigDirectory = assertTemporaryPath(
    firebaseCliConfigDirectory,
    '.firebase-cli-config.',
  )
  writeFileSync(verifiedTemporaryConfig, temporaryConfigSource, {
    encoding: 'utf8',
    flag: 'wx',
  })

  const firebaseCli = packageExecutable('firebase-tools')
  const vitestCli = packageExecutable('vitest')
  const testCommand = [
    quoteForCommand(process.execPath),
    quoteForCommand(vitestCli),
    'run',
    quoteForCommand(testFile),
    '--config',
    quoteForCommand(temporaryConfig),
  ].join(' ')

  const childEnvironment = {
    ...process.env,
    CI: 'true',
    FIREBASE_RULES_TEST_PROJECT_ID: projectId,
    XDG_CACHE_HOME: verifiedFirebaseCliConfigDirectory,
    XDG_CONFIG_HOME: verifiedFirebaseCliConfigDirectory,
  }
  // Some developer shells set DEBUG globally. Firebase CLI treats any value as
  // verbose mode and can echo the complete child-process environment.
  delete childEnvironment.DEBUG
  delete childEnvironment.FIREBASE_DEBUG_MODE

  const result = spawnSync(
    process.execPath,
    [
      firebaseCli,
      'emulators:exec',
      '--only',
      'firestore',
      '--project',
      projectId,
      '--config',
      firebaseConfig,
      testCommand,
    ],
    {
      cwd: workspace,
      env: childEnvironment,
      stdio: 'inherit',
      windowsHide: true,
    },
  )

  if (result.error) {
    throw result.error
  }
  exitCode = result.status ?? 1
} finally {
  if (existsSync(temporaryConfig)) {
    unlinkSync(verifiedTemporaryConfig)
  }
  if (firebaseCliConfigDirectory !== null) {
    const verifiedFirebaseCliConfigDirectory = assertTemporaryPath(
      firebaseCliConfigDirectory,
      '.firebase-cli-config.',
    )
    rmSync(verifiedFirebaseCliConfigDirectory, { recursive: true, force: true })
  }
}

process.exitCode = exitCode
