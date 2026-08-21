import {
  GoogleAuthProvider,
  signInWithEmailAndPassword,
  signInWithPopup,
  type Auth,
  type User,
} from 'firebase/auth'

import { ensureFirebaseAuthPersistence } from '../firebase/client'

export type FirebaseAuthUser = User

export async function signInWithGoogle(auth: Auth): Promise<void> {
  await ensureFirebaseAuthPersistence()
  const provider = new GoogleAuthProvider()
  provider.setCustomParameters({ prompt: 'select_account' })
  await signInWithPopup(auth, provider)
}

export async function signInWithEmail(
  auth: Auth,
  email: string,
  password: string,
): Promise<void> {
  await ensureFirebaseAuthPersistence()
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
