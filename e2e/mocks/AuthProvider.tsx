import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { TRADING_APP_ALLOWED_EMAIL } from '../../src/auth/accessPolicy'

export type AuthPhase =
  | 'signed_out'
  | 'submitting'
  | 'authenticated'
  | 'permission_denied'

export type AuthActivity = 'signing_in' | 'signing_out' | null
export type ProtectedCleanup = () => void

export interface AuthContextValue {
  phase: AuthPhase
  activity: AuthActivity
  user: { uid: string; email: string | null } | null
  error: string | null
  setupMessage: string | null
  missing: string[]
  authRequired: true
  canLogout: boolean
  loginWithGoogle: () => Promise<void>
  loginWithEmail: (email: string, password: string) => Promise<void>
  logout: () => Promise<void>
  getIdToken: (forceRefresh?: boolean) => Promise<string | null>
  retry: () => void
  revalidateFirestoreAccess: () => void
  registerProtectedCleanup: (cleanup: ProtectedCleanup) => () => void
}

export interface AuthProviderProps {
  children: ReactNode
  verifyAccess?: (uid: string) => Promise<void>
}

const Context = createContext<AuthContextValue | null>(null)
const E2E_UID = 'playwright-owner-uid'

function initialPhase(): AuthPhase {
  if (localStorage.getItem('e2e.auth') !== 'signed-in') return 'signed_out'
  return localStorage.getItem('e2e.firestoreDenied') === 'true'
    ? 'permission_denied'
    : 'authenticated'
}

export function AuthProvider({ children }: AuthProviderProps) {
  const [phase, setPhase] = useState<AuthPhase>(initialPhase)
  const [activity, setActivity] = useState<AuthActivity>(null)
  const cleanups = useRef(new Set<ProtectedCleanup>())
  const signedIn = phase !== 'signed_out'
  const user = useMemo(
    () => signedIn ? { uid: E2E_UID, email: TRADING_APP_ALLOWED_EMAIL } : null,
    [signedIn],
  )

  const clearProtected = useCallback(() => {
    for (const cleanup of cleanups.current) cleanup()
    cleanups.current.clear()
  }, [])

  const completeLogin = useCallback(async () => {
    setActivity('signing_in')
    localStorage.setItem('e2e.auth', 'signed-in')
    setPhase(localStorage.getItem('e2e.firestoreDenied') === 'true' ? 'permission_denied' : 'authenticated')
    setActivity(null)
  }, [])

  const logout = useCallback(async () => {
    setActivity('signing_out')
    clearProtected()
    localStorage.removeItem('e2e.auth')
    setPhase('signed_out')
    setActivity(null)
  }, [clearProtected])

  const revalidateFirestoreAccess = useCallback(() => {
    clearProtected()
    setPhase(localStorage.getItem('e2e.firestoreDenied') === 'true' ? 'permission_denied' : 'authenticated')
  }, [clearProtected])

  const value = useMemo<AuthContextValue>(() => ({
    phase,
    activity,
    user,
    error: phase === 'permission_denied'
      ? 'Firestore denied the verified owner account. Deploy the current email-only Firestore Rules.'
      : null,
    setupMessage: null,
    missing: [],
    authRequired: true,
    canLogout: signedIn,
    loginWithGoogle: completeLogin,
    loginWithEmail: async () => completeLogin(),
    logout,
    getIdToken: async () => signedIn ? 'playwright-firebase-id-token' : null,
    retry: () => {
      setPhase(localStorage.getItem('e2e.firestoreDenied') === 'true' ? 'permission_denied' : 'authenticated')
    },
    revalidateFirestoreAccess,
    registerProtectedCleanup: (cleanup) => {
      cleanups.current.add(cleanup)
      return () => cleanups.current.delete(cleanup)
    },
  }), [activity, completeLogin, logout, phase, revalidateFirestoreAccess, signedIn, user])

  return <Context.Provider value={value}>{children}</Context.Provider>
}

export function useAuth(): AuthContextValue {
  const value = useContext(Context)
  if (!value) throw new Error('useAuth must be used inside AuthProvider.')
  return value
}
