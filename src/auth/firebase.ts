import { getApp, getApps, initializeApp, type FirebaseApp, type FirebaseOptions } from 'firebase/app'
import {
  browserLocalPersistence,
  getAuth,
  GoogleAuthProvider,
  setPersistence,
  signInWithEmailAndPassword,
  signInWithPopup,
  type Auth,
  type User,
} from 'firebase/auth'

import type { FirebaseWebConfig } from '../api/types'

const FIREBASE_APP_NAME = 'tradingagents-web'
const persistenceTasks = new WeakMap<Auth, Promise<void>>()

export type FirebaseAuthUser = User

function asFirebaseOptions(config: FirebaseWebConfig): FirebaseOptions {
  return {
    apiKey: config.apiKey,
    authDomain: config.authDomain,
    projectId: config.projectId,
    appId: config.appId,
    ...(config.messagingSenderId ? { messagingSenderId: config.messagingSenderId } : {}),
    ...(config.storageBucket ? { storageBucket: config.storageBucket } : {}),
    ...(config.measurementId ? { measurementId: config.measurementId } : {}),
  }
}

function findOrCreateApp(config: FirebaseWebConfig): FirebaseApp {
  const existing = getApps().find((candidate) => candidate.name === FIREBASE_APP_NAME)
  return existing ?? initializeApp(asFirebaseOptions(config), FIREBASE_APP_NAME)
}

/**
 * Creates exactly one named Firebase app and establishes durable browser auth
 * persistence before any auth observer is installed.
 */
export async function initializeFirebaseAuth(config: FirebaseWebConfig): Promise<Auth> {
  const auth = getAuth(findOrCreateApp(config))
  let persistenceTask = persistenceTasks.get(auth)
  if (!persistenceTask) {
    persistenceTask = setPersistence(auth, browserLocalPersistence)
    persistenceTasks.set(auth, persistenceTask)
  }
  await persistenceTask
  return auth
}

export async function signInWithGoogle(auth: Auth): Promise<void> {
  const provider = new GoogleAuthProvider()
  provider.setCustomParameters({ prompt: 'select_account' })
  await signInWithPopup(auth, provider)
}

export async function signInWithEmail(
  auth: Auth,
  email: string,
  password: string,
): Promise<void> {
  await signInWithEmailAndPassword(auth, email, password)
}

function errorCode(error: unknown): string {
  if (typeof error !== 'object' || error === null || !('code' in error)) return ''
  const code = (error as { code?: unknown }).code
  return typeof code === 'string' ? code.toLowerCase() : ''
}

/** Maps Firebase SDK failures to stable, non-sensitive operator-facing copy. */
export function friendlyFirebaseError(error: unknown): string {
  switch (errorCode(error)) {
    case 'auth/invalid-credential':
    case 'auth/invalid-login-credentials':
    case 'auth/invalid-email':
    case 'auth/user-not-found':
    case 'auth/wrong-password':
      return 'Email or password is incorrect.'
    case 'auth/user-disabled':
      return 'This account has been disabled. Contact the Firebase administrator.'
    case 'auth/too-many-requests':
      return 'Too many sign-in attempts. Wait a few minutes, then try again.'
    case 'auth/popup-blocked':
      return 'The sign-in popup was blocked. Allow popups for this site and try again.'
    case 'auth/popup-closed-by-user':
    case 'auth/cancelled-popup-request':
      return 'Google sign-in was cancelled.'
    case 'auth/network-request-failed':
      return 'The authentication service could not be reached. Check your connection and try again.'
    case 'auth/unauthorized-domain':
      return 'This domain is not authorized for Firebase sign-in. Ask an administrator to add it.'
    case 'auth/invalid-api-key':
    case 'auth/api-key-not-valid.-please-pass-a-valid-api-key.':
    case 'auth/app-not-authorized':
    case 'auth/configuration-not-found':
    case 'auth/operation-not-allowed':
      return 'Firebase Authentication is not configured correctly. Contact the administrator.'
    default:
      return 'Authentication could not be completed. Please try again.'
  }
}

/** Useful when a host application has already initialized the named app. */
export function getInitializedFirebaseApp(): FirebaseApp | null {
  return getApps().some((candidate) => candidate.name === FIREBASE_APP_NAME)
    ? getApp(FIREBASE_APP_NAME)
    : null
}
