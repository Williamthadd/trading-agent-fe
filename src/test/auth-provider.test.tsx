import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { AuthConfigResponse, SessionResponse } from '../api/types'

interface FakeFirebaseUser {
  getIdToken: ReturnType<typeof vi.fn>
}

type AuthObserver = (user: FakeFirebaseUser | null) => void
type AuthErrorObserver = (error: unknown) => void

const mocks = vi.hoisted(() => ({
  apiClient: {
    getAuthConfig: vi.fn(),
    getSession: vi.fn(),
    setAuthTokenProvider: vi.fn(),
    setUnauthorizedHandler: vi.fn(),
    setForbiddenHandler: vi.fn(),
  },
  fakeAuth: { currentUser: null as FakeFirebaseUser | null },
  authObserver: null as AuthObserver | null,
  authErrorObserver: null as AuthErrorObserver | null,
  unsubscribe: vi.fn(),
  initializeFirebaseAuth: vi.fn(),
  signInWithEmail: vi.fn(),
  signInWithGoogle: vi.fn(),
  firebaseSignOut: vi.fn(),
}))

vi.mock('../api/client', () => ({
  apiClient: mocks.apiClient,
  apiUrl: { ok: true, value: 'http://127.0.0.1:8000', message: null },
}))

vi.mock('../auth/firebase', () => ({
  initializeFirebaseAuth: mocks.initializeFirebaseAuth,
  signInWithEmail: mocks.signInWithEmail,
  signInWithGoogle: mocks.signInWithGoogle,
  friendlyFirebaseError: (error: unknown) => {
    const code =
      typeof error === 'object' && error !== null && 'code' in error
        ? String((error as { code: unknown }).code)
        : ''
    return code === 'auth/popup-blocked'
      ? 'The sign-in popup was blocked. Allow popups for this site and try again.'
      : 'Email or password is incorrect.'
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
import { AuthProvider, useAuth } from '../auth/AuthProvider'

const configuredAuth: AuthConfigResponse = {
  required: true,
  configured: true,
  firebase: {
    apiKey: 'public-browser-key',
    authDomain: 'example.firebaseapp.com',
    projectId: 'tradingagents-test',
    appId: '1:123:web:abc',
  },
  missing: [],
  access_restricted: true,
}

const disabledAuth: AuthConfigResponse = {
  required: false,
  configured: false,
  firebase: {},
  missing: [],
  access_restricted: false,
}

const session: SessionResponse = {
  authenticated: true,
  user: {
    uid: 'user-1',
    email: 'analyst@example.com',
    name: 'Analyst',
  },
}

function ProtectedWorkspace() {
  const auth = useAuth()
  return (
    <div data-testid="protected-workstation">
      <span>{auth.user?.email}</span>
      {auth.canLogout ? (
        <button type="button" onClick={() => void auth.logout()}>
          LOGOUT
        </button>
      ) : null}
    </div>
  )
}

function renderAuth() {
  return render(
    <AuthProvider>
      <AuthBoundary>
        <ProtectedWorkspace />
      </AuthBoundary>
    </AuthProvider>,
  )
}

async function waitForFirebaseObserver() {
  await waitFor(() => expect(mocks.authObserver).not.toBeNull())
}

async function emitAuthUser(user: FakeFirebaseUser | null) {
  mocks.fakeAuth.currentUser = user
  await act(async () => {
    mocks.authObserver?.(user)
  })
}

beforeEach(() => {
  mocks.authObserver = null
  mocks.authErrorObserver = null
  mocks.fakeAuth.currentUser = null
  mocks.apiClient.getAuthConfig.mockReset()
  mocks.apiClient.getSession.mockReset()
  mocks.apiClient.setAuthTokenProvider.mockReset()
  mocks.apiClient.setUnauthorizedHandler.mockReset()
  mocks.initializeFirebaseAuth.mockReset().mockResolvedValue(mocks.fakeAuth)
  mocks.signInWithEmail.mockReset().mockResolvedValue(undefined)
  mocks.signInWithGoogle.mockReset().mockResolvedValue(undefined)
  mocks.firebaseSignOut.mockReset().mockResolvedValue(undefined)
  mocks.unsubscribe.mockReset()
})

describe('AuthProvider state machine', () => {
  it('shows setup-required state and safe missing variable names', async () => {
    mocks.apiClient.getAuthConfig.mockResolvedValue({
      ...configuredAuth,
      configured: false,
      missing: ['FIREBASE_WEB_API_KEY', '<unsafe-value>'],
    })

    renderAuth()

    expect(await screen.findByRole('heading', { name: 'SETUP REQUIRED' })).toBeVisible()
    expect(screen.getByText('FIREBASE_WEB_API_KEY')).toBeVisible()
    expect(screen.queryByText('<unsafe-value>')).not.toBeInTheDocument()
    expect(screen.queryByTestId('protected-workstation')).not.toBeInTheDocument()
    expect(mocks.initializeFirebaseAuth).not.toHaveBeenCalled()
  })

  it('opens an auth-disabled local session without a bearer token', async () => {
    mocks.apiClient.getAuthConfig.mockResolvedValue(disabledAuth)
    mocks.apiClient.getSession.mockResolvedValue({
      ...session,
      user: { ...session.user, auth_disabled: true },
    })

    renderAuth()

    expect(await screen.findByTestId('protected-workstation')).toHaveTextContent(
      'analyst@example.com',
    )
    expect(mocks.apiClient.getSession).toHaveBeenCalledWith(
      expect.objectContaining({ token: null, protected: false }),
    )
    expect(mocks.initializeFirebaseAuth).not.toHaveBeenCalled()
  })

  it('keeps the workstation hidden until a fresh token is verified by the backend', async () => {
    mocks.apiClient.getAuthConfig.mockResolvedValue(configuredAuth)
    mocks.apiClient.getSession.mockResolvedValue(session)
    const user = { getIdToken: vi.fn().mockResolvedValue('fresh-id-token') }

    renderAuth()
    await waitForFirebaseObserver()
    expect(screen.queryByTestId('protected-workstation')).not.toBeInTheDocument()

    await emitAuthUser(user)

    expect(await screen.findByTestId('protected-workstation')).toBeVisible()
    expect(user.getIdToken).toHaveBeenCalledWith(true)
    expect(mocks.apiClient.getSession).toHaveBeenCalledWith(
      expect.objectContaining({ token: 'fresh-id-token', protected: true }),
    )
    expect(localStorage.length).toBe(0)
  })

  it('maps Google and email sign-in failures without offering registration', async () => {
    const user = userEvent.setup()
    mocks.apiClient.getAuthConfig.mockResolvedValue(configuredAuth)
    mocks.signInWithGoogle.mockRejectedValue({ code: 'auth/popup-blocked' })
    mocks.signInWithEmail.mockRejectedValue({ code: 'auth/invalid-credential' })

    renderAuth()
    await waitForFirebaseObserver()
    await emitAuthUser(null)

    await user.click(screen.getByRole('button', { name: 'CONTINUE WITH GOOGLE' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('sign-in popup was blocked')

    await user.type(screen.getByLabelText('Email address'), 'person@example.com')
    await user.type(screen.getByLabelText('Password'), 'incorrect-password')
    await user.click(screen.getByRole('button', { name: /LOGIN TO TERMINAL/ }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Email or password is incorrect')
    expect(mocks.signInWithEmail).toHaveBeenCalledWith(
      mocks.fakeAuth,
      'person@example.com',
      'incorrect-password',
    )
    expect(screen.queryByText(/sign up|register|create account/i)).not.toBeInTheDocument()
  })

  it('renders an account-not-authorized terminal after backend 403', async () => {
    mocks.apiClient.getAuthConfig.mockResolvedValue(configuredAuth)
    mocks.apiClient.getSession.mockRejectedValue({ status: 403, message: 'server detail' })
    const user = { getIdToken: vi.fn().mockResolvedValue('rejected-id-token') }

    renderAuth()
    await waitForFirebaseObserver()
    await emitAuthUser(user)

    expect(await screen.findByRole('heading', { name: 'ACCOUNT NOT AUTHORIZED' })).toBeVisible()
    expect(screen.queryByTestId('protected-workstation')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /RETURN TO LOGIN/ })).toBeVisible()
  })

  it('immediately hides protected data when any later API request returns 403', async () => {
    mocks.apiClient.getAuthConfig.mockResolvedValue(configuredAuth)
    mocks.apiClient.getSession.mockResolvedValue(session)
    const firebaseUser = { getIdToken: vi.fn().mockResolvedValue('id-token') }

    renderAuth()
    await waitForFirebaseObserver()
    await emitAuthUser(firebaseUser)
    await screen.findByTestId('protected-workstation')
    const handler = mocks.apiClient.setForbiddenHandler.mock.calls.at(-1)?.[0] as
      | (() => void)
      | undefined
    expect(handler).toBeTypeOf('function')
    act(() => handler?.())
    expect(screen.queryByTestId('protected-workstation')).not.toBeInTheDocument()
    expect(await screen.findByRole('heading', { name: 'ACCOUNT NOT AUTHORIZED' })).toBeVisible()
  })

  it('signs Firebase out and returns to login after an expired backend session', async () => {
    mocks.apiClient.getAuthConfig.mockResolvedValue(configuredAuth)
    mocks.apiClient.getSession.mockRejectedValue({ status: 401 })
    const user = { getIdToken: vi.fn().mockResolvedValue('expired-id-token') }

    renderAuth()
    await waitForFirebaseObserver()
    await emitAuthUser(user)

    expect(await screen.findByText('Your session has expired. Please sign in again.')).toBeVisible()
    expect(mocks.firebaseSignOut).toHaveBeenCalledWith(mocks.fakeAuth)
    expect(screen.queryByTestId('protected-workstation')).not.toBeInTheDocument()
  })

  it('clears protected UI immediately when the user logs out', async () => {
    const user = userEvent.setup()
    mocks.apiClient.getAuthConfig.mockResolvedValue(configuredAuth)
    mocks.apiClient.getSession.mockResolvedValue(session)
    const firebaseUser = { getIdToken: vi.fn().mockResolvedValue('id-token') }

    renderAuth()
    await waitForFirebaseObserver()
    await emitAuthUser(firebaseUser)
    await screen.findByTestId('protected-workstation')

    await user.click(screen.getByRole('button', { name: 'LOGOUT' }))

    expect(screen.queryByTestId('protected-workstation')).not.toBeInTheDocument()
    expect(await screen.findByRole('heading', { name: 'Sign in to workstation' })).toBeVisible()
    expect(mocks.firebaseSignOut).toHaveBeenCalledTimes(1)
  })

  it('installs a fresh-enough token provider for every protected API request', async () => {
    mocks.apiClient.getAuthConfig.mockResolvedValue(configuredAuth)
    renderAuth()
    await waitForFirebaseObserver()

    const firebaseUser = { getIdToken: vi.fn().mockResolvedValue('request-token') }
    mocks.fakeAuth.currentUser = firebaseUser
    const providers = mocks.apiClient.setAuthTokenProvider.mock.calls
      .map(([candidate]) => candidate)
      .filter((candidate): candidate is () => Promise<string | null> => typeof candidate === 'function')
    const provider = providers.at(-1)

    expect(provider).toBeDefined()
    await expect(provider?.()).resolves.toBe('request-token')
    expect(firebaseUser.getIdToken).toHaveBeenCalledWith(false)
    expect(localStorage.getItem('firebase-id-token')).toBeNull()
  })
})
