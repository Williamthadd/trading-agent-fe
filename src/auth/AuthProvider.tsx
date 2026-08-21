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
import { onAuthStateChanged, signOut as firebaseSignOut, type Auth } from 'firebase/auth'

import { apiClient, apiUrl } from '../api/client'
import { ApiError, readableError } from '../api/errors'
import type {
  AuthConfigResponse,
  FirebaseWebConfig,
  SessionResponse,
  SessionUser,
} from '../api/types'
import {
  friendlyFirebaseError,
  initializeFirebaseAuth,
  signInWithEmail,
  signInWithGoogle,
  type FirebaseAuthUser,
} from './firebase'

export type AuthPhase =
  | 'initializing'
  | 'signed_out'
  | 'submitting'
  | 'authenticated'
  | 'setup_required'
  | 'forbidden'
  | 'error'

export type AuthActivity = 'initializing' | 'signing_in' | 'signing_out' | 'verifying' | null

interface AuthState {
  phase: AuthPhase
  activity: AuthActivity
  config: AuthConfigResponse | null
  session: SessionResponse | null
  error: string | null
  setupMessage: string | null
  missing: string[]
}

export interface AuthContextValue extends AuthState {
  user: SessionUser | null
  authRequired: boolean | null
  canLogout: boolean
  loginWithGoogle: () => Promise<void>
  loginWithEmail: (email: string, password: string) => Promise<void>
  logout: () => Promise<void>
  getIdToken: (forceRefresh?: boolean) => Promise<string | null>
  invalidateSession: (message?: string) => Promise<void>
  retry: () => void
}

const initialState: AuthState = {
  phase: 'initializing',
  activity: 'initializing',
  config: null,
  session: null,
  error: null,
  setupMessage: null,
  missing: [],
}

const AuthContext = createContext<AuthContextValue | null>(null)

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}

function statusOf(error: unknown): number | null {
  if (error instanceof ApiError) return error.status
  if (typeof error !== 'object' || error === null || !('status' in error)) return null
  const status = (error as { status?: unknown }).status
  return typeof status === 'number' ? status : null
}

function authenticationErrorMessage(error: unknown, fallback: string): string {
  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof (error as { code?: unknown }).code === 'string' &&
    (error as { code: string }).code.startsWith('auth/')
  ) {
    return friendlyFirebaseError(error)
  }
  return readableError(error, fallback)
}

function isFirebaseWebConfig(
  value: AuthConfigResponse['firebase'],
): value is FirebaseWebConfig {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Partial<FirebaseWebConfig>
  return [candidate.apiKey, candidate.authDomain, candidate.projectId, candidate.appId].every(
    (entry) => typeof entry === 'string' && entry.trim().length > 0,
  )
}

function safeMissingNames(names: string[]): string[] {
  const safe = names
    .filter((name) => /^[A-Za-z][A-Za-z0-9_]{0,127}$/.test(name))
    .slice(0, 24)
  return safe.length > 0 ? safe : ['FIREBASE_WEB_CONFIGURATION']
}

export interface AuthProviderProps {
  children: ReactNode
}

export function AuthProvider({ children }: AuthProviderProps) {
  const [state, setState] = useState<AuthState>(initialState)
  const [retryGeneration, setRetryGeneration] = useState(0)
  const mountedRef = useRef(false)
  const firebaseAuthRef = useRef<Auth | null>(null)
  const authRequiredRef = useRef<boolean | null>(null)
  const lifecycleGenerationRef = useRef(0)
  const verificationGenerationRef = useRef(0)
  const verificationAbortRef = useRef<AbortController | null>(null)

  const getIdToken = useCallback(async (forceRefresh = false): Promise<string | null> => {
    if (authRequiredRef.current === false) return null
    const user = firebaseAuthRef.current?.currentUser
    return user ? user.getIdToken(forceRefresh) : null
  }, [])

  const invalidateSession = useCallback(async (message?: string): Promise<void> => {
    verificationGenerationRef.current += 1
    verificationAbortRef.current?.abort()
    verificationAbortRef.current = null

    const auth = firebaseAuthRef.current
    if (mountedRef.current) {
      setState((current) => ({
        ...current,
        phase: authRequiredRef.current === false ? 'error' : 'signed_out',
        activity: null,
        session: null,
        error:
          message ??
          (authRequiredRef.current === false
            ? 'The local development session is no longer available.'
            : 'Your session has expired. Please sign in again.'),
      }))
    }

    if (auth?.currentUser) {
      try {
        await firebaseSignOut(auth)
      } catch {
        // The protected UI is already cleared. A failed remote sign-out must
        // never keep workstation data mounted in this browser tab.
      }
    }
  }, [])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  useEffect(() => {
    const lifecycleGeneration = ++lifecycleGenerationRef.current
    const startupController = new AbortController()
    let unsubscribe: (() => void) | undefined

    const isCurrent = () =>
      mountedRef.current &&
      lifecycleGeneration === lifecycleGenerationRef.current &&
      !startupController.signal.aborted

    const verifyUser = async (user: FirebaseAuthUser): Promise<void> => {
      const verificationGeneration = ++verificationGenerationRef.current
      verificationAbortRef.current?.abort()
      const controller = new AbortController()
      verificationAbortRef.current = controller

      if (isCurrent()) {
        setState((current) => ({
          ...current,
          phase: current.phase === 'submitting' ? 'submitting' : 'initializing',
          activity: 'verifying',
          session: null,
          error: null,
        }))
      }

      try {
        const token = await user.getIdToken(true)
        if (!isCurrent() || verificationGeneration !== verificationGenerationRef.current) return

        const session = await apiClient!.getSession({
          token,
          protected: true,
          signal: controller.signal,
        })
        if (!isCurrent() || verificationGeneration !== verificationGenerationRef.current) return

        setState((current) => ({
          ...current,
          phase: 'authenticated',
          activity: null,
          session,
          error: null,
        }))
      } catch (error) {
        if (
          isAbortError(error) ||
          !isCurrent() ||
          verificationGeneration !== verificationGenerationRef.current
        ) {
          return
        }

        const status = statusOf(error)
        if (status === 403) {
          setState((current) => ({
            ...current,
            phase: 'forbidden',
            activity: null,
            session: null,
            error: 'This account is not authorized to access the workstation.',
          }))
          return
        }
        if (status === 401) {
          await invalidateSession('Your session has expired. Please sign in again.')
          return
        }
        setState((current) => ({
          ...current,
          phase: 'error',
          activity: null,
          session: null,
          error: authenticationErrorMessage(error, 'The secure session could not be verified.'),
        }))
      }
    }

    const initialize = async (): Promise<void> => {
      verificationGenerationRef.current += 1
      verificationAbortRef.current?.abort()
      verificationAbortRef.current = null
      firebaseAuthRef.current = null
      authRequiredRef.current = null
      setState(initialState)

      if (!apiClient) {
        if (!isCurrent()) return
        setState({
          ...initialState,
          phase: 'setup_required',
          activity: null,
          setupMessage: apiUrl.message,
          missing: ['VITE_TRADINGAGENTS_API_URL'],
        })
        return
      }

      apiClient.setAuthTokenProvider(getIdToken)
      apiClient.setUnauthorizedHandler(() => invalidateSession())
      apiClient.setForbiddenHandler(() => {
        if (!mountedRef.current) return
        verificationGenerationRef.current += 1
        verificationAbortRef.current?.abort()
        verificationAbortRef.current = null
        setState((current) => ({
          ...current,
          phase: 'forbidden',
          activity: null,
          session: null,
          error: 'This account is not authorized to access the workstation.',
        }))
      })

      try {
        const config = await apiClient.getAuthConfig(startupController.signal)
        if (!isCurrent()) return
        authRequiredRef.current = config.required

        if (!config.required) {
          setState({
            phase: 'initializing',
            activity: 'verifying',
            config,
            session: null,
            error: null,
            setupMessage: null,
            missing: [],
          })
          const session = await apiClient.getSession({
            signal: startupController.signal,
            token: null,
            protected: false,
          })
          if (!isCurrent()) return
          setState({
            phase: 'authenticated',
            activity: null,
            config,
            session,
            error: null,
            setupMessage: null,
            missing: [],
          })
          return
        }

        if (!config.configured) {
          setState({
            phase: 'setup_required',
            activity: null,
            config,
            session: null,
            error: null,
            setupMessage:
              'Firebase Authentication must be configured on the backend before this workstation can accept sign-ins.',
            missing: safeMissingNames(config.missing),
          })
          return
        }

        if (!isFirebaseWebConfig(config.firebase)) {
          setState({
            phase: 'setup_required',
            activity: null,
            config,
            session: null,
            error: null,
            setupMessage:
              'The backend returned an incomplete Firebase Web configuration.',
            missing: ['FIREBASE_WEB_CONFIGURATION'],
          })
          return
        }

        setState({
          phase: 'initializing',
          activity: 'initializing',
          config,
          session: null,
          error: null,
          setupMessage: null,
          missing: [],
        })

        const auth = await initializeFirebaseAuth(config.firebase)
        if (!isCurrent()) return
        firebaseAuthRef.current = auth
        apiClient.setAuthTokenProvider(async () => {
          const currentUser = auth.currentUser
          return currentUser ? currentUser.getIdToken(false) : null
        })

        unsubscribe = onAuthStateChanged(
          auth,
          (user) => {
            if (!isCurrent()) return
            if (!user) {
              verificationGenerationRef.current += 1
              verificationAbortRef.current?.abort()
              verificationAbortRef.current = null
              setState((current) => ({
                ...current,
                phase: 'signed_out',
                activity: null,
                session: null,
              }))
              return
            }
            void verifyUser(user)
          },
          (error) => {
            if (!isCurrent()) return
            setState((current) => ({
              ...current,
              phase: 'error',
              activity: null,
              session: null,
              error: friendlyFirebaseError(error),
            }))
          },
        )
      } catch (error) {
        if (isAbortError(error) || !isCurrent()) return
        const status = statusOf(error)
        setState((current) => ({
          ...current,
          phase: status === 403 ? 'forbidden' : 'error',
          activity: null,
          session: null,
          error:
            status === 403
              ? 'This account is not authorized to access the workstation.'
              : authenticationErrorMessage(error, 'Authentication could not be initialized.'),
        }))
      }
    }

    void initialize()

    return () => {
      startupController.abort()
      unsubscribe?.()
      verificationGenerationRef.current += 1
      verificationAbortRef.current?.abort()
      verificationAbortRef.current = null
      if (apiClient) {
        apiClient.setUnauthorizedHandler(null)
        apiClient.setForbiddenHandler(null)
        apiClient.setAuthTokenProvider(null)
      }
    }
  }, [getIdToken, invalidateSession, retryGeneration])

  const loginWithGoogle = useCallback(async (): Promise<void> => {
    const auth = firebaseAuthRef.current
    if (!auth || !mountedRef.current) {
      setState((current) => ({
        ...current,
        error: 'Authentication is still initializing. Please wait and try again.',
      }))
      return
    }
    setState((current) => ({
      ...current,
      phase: 'submitting',
      activity: 'signing_in',
      session: null,
      error: null,
    }))
    try {
      await signInWithGoogle(auth)
    } catch (error) {
      if (!mountedRef.current || auth !== firebaseAuthRef.current) return
      setState((current) => ({
        ...current,
        phase: 'signed_out',
        activity: null,
        session: null,
        error: friendlyFirebaseError(error),
      }))
    }
  }, [])

  const loginWithEmail = useCallback(async (email: string, password: string): Promise<void> => {
    const auth = firebaseAuthRef.current
    if (!auth || !mountedRef.current) {
      setState((current) => ({
        ...current,
        error: 'Authentication is still initializing. Please wait and try again.',
      }))
      return
    }
    setState((current) => ({
      ...current,
      phase: 'submitting',
      activity: 'signing_in',
      session: null,
      error: null,
    }))
    try {
      await signInWithEmail(auth, email.trim(), password)
    } catch (error) {
      if (!mountedRef.current || auth !== firebaseAuthRef.current) return
      setState((current) => ({
        ...current,
        phase: 'signed_out',
        activity: null,
        session: null,
        error: friendlyFirebaseError(error),
      }))
    }
  }, [])

  const logout = useCallback(async (): Promise<void> => {
    const auth = firebaseAuthRef.current
    if (!auth || authRequiredRef.current === false) return

    verificationGenerationRef.current += 1
    verificationAbortRef.current?.abort()
    verificationAbortRef.current = null
    setState((current) => ({
      ...current,
      phase: 'submitting',
      activity: 'signing_out',
      session: null,
      error: null,
    }))
    try {
      await firebaseSignOut(auth)
      if (!mountedRef.current) return
      setState((current) => ({
        ...current,
        phase: 'signed_out',
        activity: null,
        session: null,
        error: null,
      }))
    } catch (error) {
      if (!mountedRef.current) return
      setState((current) => ({
        ...current,
        phase: 'signed_out',
        activity: null,
        session: null,
        error: friendlyFirebaseError(error),
      }))
    }
  }, [])

  const retry = useCallback(() => {
    setRetryGeneration((generation) => generation + 1)
  }, [])

  const value = useMemo<AuthContextValue>(
    () => ({
      ...state,
      user: state.session?.user ?? null,
      authRequired: state.config?.required ?? null,
      canLogout: state.config?.required === true && firebaseAuthRef.current !== null,
      loginWithGoogle,
      loginWithEmail,
      logout,
      getIdToken,
      invalidateSession,
      retry,
    }),
    [getIdToken, invalidateSession, loginWithEmail, loginWithGoogle, logout, retry, state],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext)
  if (!value) throw new Error('useAuth must be used inside AuthProvider.')
  return value
}
