import { useEffect } from 'react'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

interface FakeFirebaseUser {
  uid: string
  email: string | null
  displayName: string | null
  photoURL: string | null
  emailVerified: boolean
  getIdToken: ReturnType<typeof vi.fn>
}

type AuthObserver = (user: FakeFirebaseUser | null) => void
type AuthErrorObserver = (error: unknown) => void

const mocks = vi.hoisted(() => ({
  fakeAuth: { currentUser: null as FakeFirebaseUser | null },
  authObserver: null as AuthObserver | null,
  authErrorObserver: null as AuthErrorObserver | null,
  unsubscribe: vi.fn(),
  getValidation: vi.fn(),
  ensurePersistence: vi.fn(),
  signInWithEmail: vi.fn(),
  signInWithGoogle: vi.fn(),
  firebaseSignOut: vi.fn(),
}))

vi.mock('../firebase/client', () => ({
  firebaseAuth: mocks.fakeAuth,
  firebaseClientInitializationError: null,
  getFirebaseConfigValidation: mocks.getValidation,
  ensureFirebaseAuthPersistence: mocks.ensurePersistence,
}))

vi.mock('../auth/firebase', () => ({
  signInWithEmail: mocks.signInWithEmail,
  signInWithGoogle: mocks.signInWithGoogle,
  friendlyFirebaseError: (error: unknown) => {
    const code =
      typeof error === 'object' && error !== null && 'code' in error
        ? String((error as { code: unknown }).code)
        : ''
    return code === 'auth/popup-blocked'
      ? 'The sign-in popup was blocked. Allow popups for this site and try again.'
      : 'Authentication could not be completed. Please try again.'
  },
}))

vi.mock('firebase/auth', () => ({
  onAuthStateChanged: (
    _auth: unknown,
    next: AuthObserver,
    error: AuthErrorObserver,
  ) => {
    mocks.authObserver = next
    mocks.authErrorObserver = error
    return mocks.unsubscribe
  },
  signOut: mocks.firebaseSignOut,
}))

import { AuthBoundary } from '../auth/AuthBoundary'
import {
  AuthProvider,
  useAuth,
  type ProtectedCleanup,
  type VerifyFirestoreAccess,
} from '../auth/AuthProvider'
import {
  TRADING_APP_ACCESS_DENIED_MESSAGE,
  TRADING_APP_ALLOWED_EMAIL,
} from '../auth/accessPolicy'

const validConfiguration = {
  ok: true,
  config: {
    options: {
      apiKey: 'public-browser-key',
      authDomain: 'example.firebaseapp.com',
      projectId: 'tradingagents-test',
      appId: '1:123:web:abc',
    },
    databaseId: '(default)',
  },
  missing: [],
  invalid: [],
  message: null,
} as const

function firebaseUser(
  uid = 'firebase-uid-123',
  overrides: Partial<FakeFirebaseUser> = {},
): FakeFirebaseUser {
  return {
    uid,
    email: TRADING_APP_ALLOWED_EMAIL,
    displayName: 'Analyst',
    photoURL: null,
    emailVerified: true,
    getIdToken: vi.fn().mockResolvedValue('fresh-token'),
    ...overrides,
  }
}

function ProtectedWorkspace({ onCleanup }: { onCleanup?: ProtectedCleanup }) {
  const auth = useAuth()
  useEffect(() => {
    if (!onCleanup) return undefined
    return auth.registerProtectedCleanup(onCleanup)
  }, [auth, onCleanup])
  return (
    <div data-testid="protected-workstation">
      <span>{auth.user?.uid}</span>
      <button type="button" onClick={() => void auth.logout()}>LOGOUT</button>
    </div>
  )
}

function renderAuth(
  verifyAccess: VerifyFirestoreAccess = vi.fn().mockResolvedValue(undefined),
  onCleanup?: ProtectedCleanup,
) {
  return render(
    <AuthProvider verifyAccess={verifyAccess}>
      <AuthBoundary>
        <ProtectedWorkspace {...(onCleanup ? { onCleanup } : {})} />
      </AuthBoundary>
    </AuthProvider>,
  )
}

async function waitForObserver() {
  await waitFor(() => expect(mocks.authObserver).not.toBeNull())
}

async function emitAuthUser(user: FakeFirebaseUser | null) {
  mocks.fakeAuth.currentUser = user
  await act(async () => {
    mocks.authObserver?.(user)
  })
}

beforeEach(() => {
  mocks.fakeAuth.currentUser = null
  mocks.authObserver = null
  mocks.authErrorObserver = null
  mocks.unsubscribe.mockReset()
  mocks.getValidation.mockReset().mockReturnValue(validConfiguration)
  mocks.ensurePersistence.mockReset().mockResolvedValue(undefined)
  mocks.signInWithEmail.mockReset().mockResolvedValue(undefined)
  mocks.signInWithGoogle.mockReset().mockResolvedValue(undefined)
  mocks.firebaseSignOut.mockReset().mockResolvedValue(undefined)
})

describe('Firebase-only AuthProvider', () => {
  it('shows only missing/invalid Firebase variable names and never starts auth', async () => {
    mocks.getValidation.mockReturnValue({
      ok: false,
      config: null,
      missing: ['VITE_FIREBASE_API_KEY', 'VITE_FIREBASE_PROJECT_ID'],
      invalid: ['VITE_FIREBASE_DATABASE_ID'],
      message: 'Required Firebase Web configuration is missing.',
    })

    renderAuth()

    expect(await screen.findByRole('heading', { name: 'FIREBASE SETUP REQUIRED' })).toBeVisible()
    expect(screen.getByText('VITE_FIREBASE_API_KEY')).toBeVisible()
    expect(screen.getByText('VITE_FIREBASE_PROJECT_ID')).toBeVisible()
    expect(screen.getByText('VITE_FIREBASE_DATABASE_ID')).toBeVisible()
    expect(screen.queryByTestId('protected-workstation')).not.toBeInTheDocument()
    expect(mocks.ensurePersistence).not.toHaveBeenCalled()
    expect(mocks.authObserver).toBeNull()
  })

  it('supports Google and email login without making any FastAPI request', async () => {
    const user = userEvent.setup()
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    renderAuth()
    await waitForObserver()
    await emitAuthUser(null)

    await user.click(screen.getByRole('button', { name: 'CONTINUE WITH GOOGLE' }))
    expect(mocks.signInWithGoogle).toHaveBeenCalledWith(mocks.fakeAuth)

    await emitAuthUser(null)
    await user.type(screen.getByLabelText('Email address'), ` ${TRADING_APP_ALLOWED_EMAIL.toUpperCase()} `)
    await user.type(screen.getByLabelText('Password'), 'existing-password')
    await user.click(screen.getByRole('button', { name: /LOGIN TO TERMINAL/ }))

    expect(mocks.signInWithEmail).toHaveBeenCalledWith(
      mocks.fakeAuth,
      TRADING_APP_ALLOWED_EMAIL.toUpperCase(),
      'existing-password',
    )
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(screen.queryByText(/sign up|register|create account/i)).not.toBeInTheDocument()
  })

  it('rejects another email before an email/password Firebase request is made', async () => {
    const user = userEvent.setup()
    renderAuth()
    await waitForObserver()
    await emitAuthUser(null)

    await user.type(screen.getByLabelText('Email address'), 'another@example.com')
    await user.type(screen.getByLabelText('Password'), 'not-sent-to-firebase')
    await user.click(screen.getByRole('button', { name: /LOGIN TO TERMINAL/ }))

    expect(mocks.signInWithEmail).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toHaveTextContent(TRADING_APP_ACCESS_DENIED_MESSAGE)
    expect(screen.queryByTestId('protected-workstation')).not.toBeInTheDocument()
  })

  it.each([
    ['another Firebase email', { email: 'another@example.com', emailVerified: true }],
    ['an unverified owner email', { email: TRADING_APP_ALLOWED_EMAIL, emailVerified: false }],
    ['a missing Firebase email', { email: null, emailVerified: true }],
  ])('signs out %s before Firestore verification or workspace rendering', async (_label, identity) => {
    const verifyAccess = vi.fn().mockResolvedValue(undefined)
    const disallowedUser = firebaseUser('disallowed-uid', identity)
    renderAuth(verifyAccess)
    await waitForObserver()

    await emitAuthUser(disallowedUser)

    await waitFor(() => expect(mocks.firebaseSignOut).toHaveBeenCalledWith(mocks.fakeAuth))
    expect(verifyAccess).not.toHaveBeenCalled()
    expect(screen.queryByTestId('protected-workstation')).not.toBeInTheDocument()
    expect(await screen.findByRole('alert')).toHaveTextContent(TRADING_APP_ACCESS_DENIED_MESSAGE)
  })

  it('keeps the workspace hidden while checking Firestore, then reveals it on an empty-query success', async () => {
    let resolveAccess: (() => void) | undefined
    const verifyAccess = vi.fn(
      () => new Promise<void>((resolve) => {
        resolveAccess = resolve
      }),
    )
    const currentUser = firebaseUser()
    renderAuth(verifyAccess)
    await waitForObserver()

    await emitAuthUser(currentUser)
    expect(await screen.findByRole('heading', { name: 'CHECKING FIRESTORE ACCESS' })).toBeVisible()
    expect(screen.queryByTestId('protected-workstation')).not.toBeInTheDocument()
    expect(verifyAccess).toHaveBeenCalledWith(currentUser.uid)

    await act(async () => resolveAccess?.())
    expect(await screen.findByTestId('protected-workstation')).toHaveTextContent(currentUser.uid)
    expect(mocks.authObserver).not.toBeNull()
  })

  it('shows rule-deployment guidance and retries a permission denial', async () => {
    const user = userEvent.setup()
    const verifyAccess = vi
      .fn()
      .mockRejectedValueOnce({ code: 'permission-denied' })
      .mockResolvedValueOnce(undefined)
    const currentUser = firebaseUser('approved-format-uid')
    renderAuth(verifyAccess)
    await waitForObserver()
    await emitAuthUser(currentUser)

    expect(await screen.findByRole('heading', { name: 'FIRESTORE ACCESS DENIED' })).toBeVisible()
    expect(screen.getByRole('alert')).toHaveTextContent(/email-only Firestore Rules/u)
    expect(screen.queryByText(/tradingagents_members/u)).not.toBeInTheDocument()
    expect(screen.queryByTestId('protected-workstation')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /RETRY ACCESS/ }))
    expect(await screen.findByTestId('protected-workstation')).toHaveTextContent(currentUser.uid)
    expect(verifyAccess).toHaveBeenCalledTimes(2)
  })

  it('retains the signed-in UID through a retryable Firestore failure and retries access', async () => {
    const user = userEvent.setup()
    const verifyAccess = vi
      .fn()
      .mockRejectedValueOnce({ code: 'unavailable' })
      .mockResolvedValueOnce(undefined)
    const currentUser = firebaseUser('retained-uid')
    renderAuth(verifyAccess)
    await waitForObserver()
    await emitAuthUser(currentUser)

    expect(await screen.findByRole('heading', { name: 'FIRESTORE UNAVAILABLE' })).toBeVisible()
    expect(mocks.fakeAuth.currentUser?.uid).toBe(currentUser.uid)
    expect(mocks.firebaseSignOut).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: /RETRY FIRESTORE/ }))
    expect(await screen.findByTestId('protected-workstation')).toHaveTextContent(currentUser.uid)
    expect(verifyAccess).toHaveBeenCalledTimes(2)
  })

  it('refreshes Firebase auth once for an unauthenticated Firestore check without signing out', async () => {
    const verifyAccess = vi
      .fn()
      .mockRejectedValueOnce({ code: 'unauthenticated' })
      .mockResolvedValueOnce(undefined)
    const currentUser = firebaseUser('refresh-uid')
    renderAuth(verifyAccess)
    await waitForObserver()
    await emitAuthUser(currentUser)

    expect(await screen.findByTestId('protected-workstation')).toBeVisible()
    expect(currentUser.getIdToken).toHaveBeenCalledWith(true)
    expect(verifyAccess).toHaveBeenCalledTimes(2)
    expect(mocks.firebaseSignOut).not.toHaveBeenCalled()
  })

  it('runs every protected listener cleanup before Firebase sign-out', async () => {
    const user = userEvent.setup()
    const order: string[] = []
    const cleanupOne = vi.fn(() => order.push('cleanup-one'))
    mocks.firebaseSignOut.mockImplementation(async () => {
      order.push('firebase-signout')
    })
    const currentUser = firebaseUser('cleanup-uid')
    renderAuth(vi.fn().mockResolvedValue(undefined), cleanupOne)
    await waitForObserver()
    await emitAuthUser(currentUser)
    await screen.findByTestId('protected-workstation')

    await user.click(screen.getByRole('button', { name: 'LOGOUT' }))

    expect(cleanupOne).toHaveBeenCalledOnce()
    expect(order).toEqual(['cleanup-one', 'firebase-signout'])
    expect(screen.queryByTestId('protected-workstation')).not.toBeInTheDocument()
  })

  it('unsubscribes the single auth observer on unmount', async () => {
    const view = renderAuth()
    await waitForObserver()
    view.unmount()
    expect(mocks.unsubscribe).toHaveBeenCalledOnce()
  })
})
