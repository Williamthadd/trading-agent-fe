import {
  getApp,
  getApps,
  initializeApp,
  type FirebaseApp,
  type FirebaseOptions,
} from 'firebase/app'
import {
  browserLocalPersistence,
  getAuth,
  setPersistence,
  type Auth,
} from 'firebase/auth'
import {
  getFirestore,
  initializeFirestore,
  memoryLocalCache,
  type Firestore,
} from 'firebase/firestore'

const FIREBASE_APP_NAME = 'tradingagents-web'

export const REQUIRED_FIREBASE_ENV_NAMES = [
  'VITE_FIREBASE_API_KEY',
  'VITE_FIREBASE_AUTH_DOMAIN',
  'VITE_FIREBASE_PROJECT_ID',
  'VITE_FIREBASE_APP_ID',
  'VITE_FIREBASE_DATABASE_ID',
] as const

export type RequiredFirebaseEnvName = (typeof REQUIRED_FIREBASE_ENV_NAMES)[number]

export interface FirebaseEnvironment {
  readonly VITE_FIREBASE_API_KEY?: unknown
  readonly VITE_FIREBASE_AUTH_DOMAIN?: unknown
  readonly VITE_FIREBASE_PROJECT_ID?: unknown
  readonly VITE_FIREBASE_APP_ID?: unknown
  readonly VITE_FIREBASE_DATABASE_ID?: unknown
  readonly VITE_FIREBASE_MESSAGING_SENDER_ID?: unknown
  readonly VITE_FIREBASE_STORAGE_BUCKET?: unknown
  readonly VITE_FIREBASE_MEASUREMENT_ID?: unknown
}

export interface ValidFirebaseConfiguration {
  readonly options: FirebaseOptions
  readonly databaseId: '(default)'
}

export type FirebaseConfigValidation =
  | {
      readonly ok: true
      readonly config: ValidFirebaseConfiguration
      readonly missing: readonly []
      readonly invalid: readonly []
      readonly message: null
    }
  | {
      readonly ok: false
      readonly config: null
      readonly missing: readonly RequiredFirebaseEnvName[]
      readonly invalid: readonly RequiredFirebaseEnvName[]
      readonly message: string
    }

function nonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed ? trimmed : null
}

/** Pure validation: this function never initializes an SDK or exposes values in errors. */
export function validateFirebaseEnvironment(env: FirebaseEnvironment): FirebaseConfigValidation {
  const apiKey = nonEmptyString(env.VITE_FIREBASE_API_KEY)
  const authDomain = nonEmptyString(env.VITE_FIREBASE_AUTH_DOMAIN)
  const projectId = nonEmptyString(env.VITE_FIREBASE_PROJECT_ID)
  const appId = nonEmptyString(env.VITE_FIREBASE_APP_ID)
  const databaseId = nonEmptyString(env.VITE_FIREBASE_DATABASE_ID)
  const missing: RequiredFirebaseEnvName[] = []

  if (!apiKey) missing.push('VITE_FIREBASE_API_KEY')
  if (!authDomain) missing.push('VITE_FIREBASE_AUTH_DOMAIN')
  if (!projectId) missing.push('VITE_FIREBASE_PROJECT_ID')
  if (!appId) missing.push('VITE_FIREBASE_APP_ID')
  if (!databaseId) missing.push('VITE_FIREBASE_DATABASE_ID')

  if (missing.length > 0) {
    return {
      ok: false,
      config: null,
      missing,
      invalid: [],
      message: 'Required Firebase Web configuration is missing.',
    }
  }

  if (databaseId !== '(default)') {
    return {
      ok: false,
      config: null,
      missing: [],
      invalid: ['VITE_FIREBASE_DATABASE_ID'],
      message: 'This workstation requires the default Cloud Firestore database.',
    }
  }

  const options: FirebaseOptions = {
    apiKey: apiKey!,
    authDomain: authDomain!,
    projectId: projectId!,
    appId: appId!,
  }
  const messagingSenderId = nonEmptyString(env.VITE_FIREBASE_MESSAGING_SENDER_ID)
  const storageBucket = nonEmptyString(env.VITE_FIREBASE_STORAGE_BUCKET)
  const measurementId = nonEmptyString(env.VITE_FIREBASE_MEASUREMENT_ID)
  if (messagingSenderId) options.messagingSenderId = messagingSenderId
  if (storageBucket) options.storageBucket = storageBucket
  if (measurementId) options.measurementId = measurementId

  return {
    ok: true,
    config: { options, databaseId: '(default)' },
    missing: [],
    invalid: [],
    message: null,
  }
}

export const firebaseConfigValidation = validateFirebaseEnvironment(import.meta.env)

/** Indirection keeps AuthProvider easy to exercise without mutating Vite globals. */
export function getFirebaseConfigValidation(): FirebaseConfigValidation {
  return firebaseConfigValidation
}

interface InitializedFirebaseClient {
  app: FirebaseApp
  auth: Auth
  db: Firestore
}

function sameConfiguredProject(app: FirebaseApp, options: FirebaseOptions): boolean {
  return (
    app.options.apiKey === options.apiKey &&
    app.options.authDomain === options.authDomain &&
    app.options.projectId === options.projectId &&
    app.options.appId === options.appId
  )
}

function initializeFirebaseClient(
  validation: FirebaseConfigValidation,
): InitializedFirebaseClient | null {
  if (!validation.ok) return null

  const existing = getApps().find((candidate) => candidate.name === FIREBASE_APP_NAME)
  if (existing && !sameConfiguredProject(existing, validation.config.options)) {
    throw new Error('The initialized Firebase app does not match the validated Web configuration.')
  }

  if (existing) {
    return {
      app: getApp(FIREBASE_APP_NAME),
      auth: getAuth(existing),
      // An existing instance can only come from an earlier evaluation of this
      // module (for example Vite HMR). Its cache was initialized below.
      db: getFirestore(existing),
    }
  }

  const app = initializeApp(validation.config.options, FIREBASE_APP_NAME)
  return {
    app,
    auth: getAuth(app),
    db: initializeFirestore(app, { localCache: memoryLocalCache() }),
  }
}

let initializedClient: InitializedFirebaseClient | null = null
let initializationError: string | null = null

try {
  initializedClient = initializeFirebaseClient(firebaseConfigValidation)
} catch {
  // Configuration details and SDK objects must not be copied into UI errors.
  initializationError = 'Firebase could not be initialized with the configured Web application.'
}

export const firebaseApp: FirebaseApp | null = initializedClient?.app ?? null
export const firebaseAuth: Auth | null = initializedClient?.auth ?? null
export const firestoreDb: Firestore | null = initializedClient?.db ?? null
export const firebaseClientInitializationError = initializationError

let persistenceTask: Promise<void> | null = null

/** Called before observing/signing in so the existing remembered-login behavior is stable. */
export function ensureFirebaseAuthPersistence(): Promise<void> {
  if (!firebaseAuth) return Promise.reject(new Error('Firebase Authentication is unavailable.'))
  persistenceTask ??= setPersistence(firebaseAuth, browserLocalPersistence)
  return persistenceTask
}
