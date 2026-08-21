import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { onAuthStateChanged, signOut as firebaseSignOut, type User } from 'firebase/auth'

import {
  ensureFirebaseAuthPersistence,
  firebaseAuth,
  firebaseClientInitializationError,
  getFirebaseConfigValidation,
} from '../firebase/client'
import {
  isAllowedFirebaseIdentity,
  isAllowedLoginEmail,
  TRADING_APP_ACCESS_DENIED_MESSAGE,
} from './accessPolicy'
import { friendlyFirebaseError, signInWithEmail, signInWithGoogle } from './firebase'

export type AuthPhase =
  | 'initializing'
  | 'signed_out'
  | 'submitting'
  | 'checking_access'
  | 'authenticated'
  | 'setup_required'
  | 'permission_denied'
  | 'firestore_unavailable'
  | 'error'

export type AuthActivity =
  | 'initializing'
  | 'signing_in'
  | 'signing_out'
  | 'checking_access'
  | null

export interface AuthUser {
  uid: string
  email: string | null
  name?: string | null
  picture?: string | null
  email_verified?: boolean
}

export type VerifyFirestoreAccess = (uid: string) => Promise<void>
export type ProtectedCleanup = () => void

interface AuthState {
  phase: AuthPhase
  activity: AuthActivity
  user: AuthUser | null
  error: string | null
  setupMessage: string | null
  missing: string[]
}

export interface AuthContextValue extends AuthState {
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

const initialState: AuthState = {
  phase: 'initializing',
  activity: 'initializing',
  user: null,
  error: null,
  setupMessage: null,
  missing: [],
}

const missingAccessVerifier: VerifyFirestoreAccess = async () => {
  const error = new Error('Firestore history access verification is not configured.')
  Object.assign(error, { code: 'failed-precondition' })
  throw error
}

const AuthContext = createContext<AuthContextValue | null>(null)

function safeUser(user: User): AuthUser {
  return {
    uid: user.uid,
    email: user.email,
    name: user.displayName,
    picture: user.photoURL,
    email_verified: user.emailVerified,
  }
}

function errorCode(error: unknown): string {
  if (typeof error !== 'object' || error === null || !('code' in error)) return ''
  const code = (error as { code?: unknown }).code
  if (typeof code !== 'string') return ''
  return code.toLowerCase().replace(/^firestore\//, '')
}

interface AccessFailure {
  phase: 'permission_denied' | 'firestore_unavailable'
  message: string
  unauthenticated: boolean
}

function normalizeAccessFailure(error: unknown): AccessFailure {
  switch (errorCode(error)) {
    case 'permission-denied':
      return {
        phase: 'permission_denied',
        message:
          'Firestore denied the verified owner account. Deploy the current email-only Firestore Rules to the same Firebase project.',
        unauthenticated: false,
      }
    case 'unauthenticated':
      return {
        phase: 'firestore_unavailable',
        message: 'Firebase could not authorize this history request. Retry the secure connection.',
        unauthenticated: true,
      }
    case 'resource-exhausted':
      return {
        phase: 'firestore_unavailable',
        message: 'Cloud Firestore quota is currently exhausted. Wait before retrying history access.',
        unauthenticated: false,
      }
    case 'failed-precondition':
      return {
        phase: 'firestore_unavailable',
        message:
          'Cloud Firestore is not configured for this history query. Check the project, database, rules, and indexes.',
        unauthenticated: false,
      }
    case 'deadline-exceeded':
    case 'unavailable':
    case 'network-request-failed':
      return {
        phase: 'firestore_unavailable',
        message:
          'Cloud Firestore could not be reached. Your Firebase sign-in remains active while you retry.',
        unauthenticated: false,
      }
    default:
      return {
        phase: 'firestore_unavailable',
        message: 'Cloud Firestore history access could not be verified. Retry the data connection.',
        unauthenticated: false,
      }
  }
}

export interface AuthProviderProps {
  children: ReactNode
  /** Repository boundary used for a minimal server-authorized history read. */
  verifyAccess?: VerifyFirestoreAccess
}

export function AuthProvider({ children, verifyAccess }: AuthProviderProps) {
  const [state, setState] = useState<AuthState>(initialState)
  const [initializationGeneration, setInitializationGeneration] = useState(0)
  const mountedRef = useRef(false)
  const accessGenerationRef = useRef(0)
  const verifierRef = useRef<VerifyFirestoreAccess>(verifyAccess ?? missingAccessVerifier)
  const protectedCleanupsRef = useRef(new Set<ProtectedCleanup>())
  const policyDenialRef = useRef<string | null>(null)

  const runProtectedCleanups = useCallback((): void => {
    const cleanups = [...protectedCleanupsRef.current]
    protectedCleanupsRef.current.clear()
    for (const cleanup of cleanups) {
      try {
        cleanup()
      } catch {
        // Cleanup is best-effort, but every remaining callback must still run.
      }
    }
  }, [])

  const registerProtectedCleanup = useCallback((cleanup: ProtectedCleanup): (() => void) => {
    protectedCleanupsRef.current.add(cleanup)
    return () => protectedCleanupsRef.current.delete(cleanup)
  }, [])

  const verifyUserAccess = useCallback(
    async (firebaseUser: User, allowTokenRefresh = true): Promise<void> => {
      const generation = ++accessGenerationRef.current
      const user = safeUser(firebaseUser)
      let tokenWasRefreshed = false
      if (mountedRef.current) {
        setState({
          phase: 'checking_access',
          activity: 'checking_access',
          user,
          error: null,
          setupMessage: null,
          missing: [],
        })
      }

      while (true) {
        try {
          await verifierRef.current(firebaseUser.uid)
          if (
            !mountedRef.current ||
            generation !== accessGenerationRef.current ||
            firebaseAuth?.currentUser?.uid !== firebaseUser.uid
          ) {
            return
          }
          setState({
            phase: 'authenticated',
            activity: null,
            user,
            error: null,
            setupMessage: null,
            missing: [],
          })
          return
        } catch (error) {
          if (!mountedRef.current || generation !== accessGenerationRef.current) return
          const failure = normalizeAccessFailure(error)

          if (failure.unauthenticated && allowTokenRefresh && !tokenWasRefreshed) {
            if (firebaseAuth?.currentUser?.uid !== firebaseUser.uid) {
              runProtectedCleanups()
              setState({ ...initialState, phase: 'signed_out', activity: null })
              return
            }
            try {
              await firebaseUser.getIdToken(true)
            } catch {
              // The observer remains authoritative. A present Firebase user is
              // retained and shown a retryable data-connection state.
            }
            if (generation !== accessGenerationRef.current) return
            tokenWasRefreshed = true
            continue
          }

          runProtectedCleanups()
          setState({
            phase: failure.phase,
            activity: null,
            user,
            error: failure.message,
            setupMessage: null,
            missing: [],
          })
          return
        }
      }
    },
    [runProtectedCleanups],
  )

  useEffect(() => {
    verifierRef.current = verifyAccess ?? missingAccessVerifier
  }, [verifyAccess])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  useEffect(() => {
    let disposed = false
    let unsubscribe: (() => void) | null = null
    const validation = getFirebaseConfigValidation()

    accessGenerationRef.current += 1
    runProtectedCleanups()
    setState(initialState)

    if (!validation.ok) {
      setState({
        phase: 'setup_required',
        activity: null,
        user: null,
        error: null,
        setupMessage: validation.message,
        missing: [...validation.missing, ...validation.invalid],
      })
      return undefined
    }

    if (firebaseClientInitializationError || !firebaseAuth) {
      setState({
        phase: 'setup_required',
        activity: null,
        user: null,
        error: null,
        setupMessage:
          firebaseClientInitializationError ??
          'Firebase Authentication could not be initialized from the Web configuration.',
        missing: [],
      })
      return undefined
    }
    const auth = firebaseAuth

    const rejectDisallowedIdentity = (): void => {
      const generation = ++accessGenerationRef.current
      runProtectedCleanups()
      policyDenialRef.current = TRADING_APP_ACCESS_DENIED_MESSAGE
      setState({
        ...initialState,
        phase: 'submitting',
        activity: 'signing_out',
        error: TRADING_APP_ACCESS_DENIED_MESSAGE,
      })

      void firebaseSignOut(auth)
        .catch(() => undefined)
        .finally(() => {
          if (
            !mountedRef.current ||
            generation !== accessGenerationRef.current ||
            policyDenialRef.current !== TRADING_APP_ACCESS_DENIED_MESSAGE
          ) return
          setState({
            ...initialState,
            phase: 'signed_out',
            activity: null,
            error: TRADING_APP_ACCESS_DENIED_MESSAGE,
          })
        })
    }

    void ensureFirebaseAuthPersistence()
      .then(() => {
        if (disposed || !mountedRef.current) return
        unsubscribe = onAuthStateChanged(
          auth,
          (firebaseUser) => {
            if (disposed || !mountedRef.current) return
            accessGenerationRef.current += 1
            runProtectedCleanups()
            if (!firebaseUser) {
              const policyError = policyDenialRef.current
              policyDenialRef.current = null
              setState({
                ...initialState,
                phase: 'signed_out',
                activity: null,
                error: policyError,
              })
              return
            }
            if (!isAllowedFirebaseIdentity(firebaseUser)) {
              rejectDisallowedIdentity()
              return
            }
            policyDenialRef.current = null
            void verifyUserAccess(firebaseUser)
          },
          (error) => {
            if (disposed || !mountedRef.current) return
            accessGenerationRef.current += 1
            runProtectedCleanups()
            setState({
              ...initialState,
              phase: 'error',
              activity: null,
              error: friendlyFirebaseError(error),
            })
          },
        )
      })
      .catch((error: unknown) => {
        if (disposed || !mountedRef.current) return
        setState({
          ...initialState,
          phase: 'error',
          activity: null,
          error: friendlyFirebaseError(error),
        })
      })

    return () => {
      disposed = true
      accessGenerationRef.current += 1
      policyDenialRef.current = null
      unsubscribe?.()
      runProtectedCleanups()
    }
  }, [initializationGeneration, runProtectedCleanups, verifyUserAccess])

  const loginWithGoogle = useCallback(async (): Promise<void> => {
    if (!firebaseAuth || !mountedRef.current) return
    policyDenialRef.current = null
    setState((current) => ({
      ...current,
      phase: 'submitting',
      activity: 'signing_in',
      user: null,
      error: null,
    }))
    try {
      await signInWithGoogle(firebaseAuth)
    } catch (error) {
      if (!mountedRef.current) return
      setState({
        ...initialState,
        phase: 'signed_out',
        activity: null,
        error: friendlyFirebaseError(error),
      })
    }
  }, [])

  const loginWithEmail = useCallback(async (email: string, password: string): Promise<void> => {
    if (!firebaseAuth || !mountedRef.current) return
    if (!isAllowedLoginEmail(email)) {
      setState({
        ...initialState,
        phase: 'signed_out',
        activity: null,
        error: TRADING_APP_ACCESS_DENIED_MESSAGE,
      })
      return
    }
    policyDenialRef.current = null
    setState((current) => ({
      ...current,
      phase: 'submitting',
      activity: 'signing_in',
      user: null,
      error: null,
    }))
    try {
      await signInWithEmail(firebaseAuth, email.trim(), password)
    } catch (error) {
      if (!mountedRef.current) return
      setState({
        ...initialState,
        phase: 'signed_out',
        activity: null,
        error: friendlyFirebaseError(error),
      })
    }
  }, [])

  const logout = useCallback(async (): Promise<void> => {
    if (!firebaseAuth) return
    accessGenerationRef.current += 1
    runProtectedCleanups()
    setState((current) => ({
      ...current,
      phase: 'submitting',
      activity: 'signing_out',
      error: null,
    }))
    try {
      await firebaseSignOut(firebaseAuth)
      if (!mountedRef.current) return
      setState({ ...initialState, phase: 'signed_out', activity: null })
    } catch (error) {
      if (!mountedRef.current) return
      setState({
        ...initialState,
        phase: 'signed_out',
        activity: null,
        error: friendlyFirebaseError(error),
      })
    }
  }, [runProtectedCleanups])

  const getIdToken = useCallback(async (forceRefresh = false): Promise<string | null> => {
    const currentUser = firebaseAuth?.currentUser
    return currentUser && isAllowedFirebaseIdentity(currentUser)
      ? currentUser.getIdToken(forceRefresh)
      : null
  }, [])

  const retry = useCallback((): void => {
    const currentUser = firebaseAuth?.currentUser
    if (currentUser && state.phase === 'firestore_unavailable') {
      void verifyUserAccess(currentUser)
      return
    }
    setInitializationGeneration((generation) => generation + 1)
  }, [state.phase, verifyUserAccess])

  const revalidateFirestoreAccess = useCallback((): void => {
    const currentUser = firebaseAuth?.currentUser
    if (!currentUser) {
      accessGenerationRef.current += 1
      runProtectedCleanups()
      setState({ ...initialState, phase: 'signed_out', activity: null })
      return
    }
    void verifyUserAccess(currentUser)
  }, [runProtectedCleanups, verifyUserAccess])

  const value = useMemo<AuthContextValue>(
    () => ({
      ...state,
      authRequired: true,
      canLogout: state.user !== null,
      loginWithGoogle,
      loginWithEmail,
      logout,
      getIdToken,
      retry,
      revalidateFirestoreAccess,
      registerProtectedCleanup,
    }),
    [
      getIdToken,
      loginWithEmail,
      loginWithGoogle,
      logout,
      registerProtectedCleanup,
      retry,
      revalidateFirestoreAccess,
      state,
    ],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext)
  if (!value) throw new Error('useAuth must be used inside AuthProvider.')
  return value
}
