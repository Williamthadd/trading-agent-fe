import { useId, useState, type FormEvent, type ReactNode } from 'react'

import { useAuth } from './AuthProvider'
import '../styles/auth.css'

function GoogleMark() {
  return (
    <svg className="auth-google-mark" aria-hidden="true" viewBox="0 0 24 24">
      <path
        fill="currentColor"
        d="M21.6 12.23c0-.71-.06-1.23-.2-1.77H12v3.4h5.52a4.73 4.73 0 0 1-2.05 3.02l-.02.11 2.98 2.31.2.02c1.83-1.7 2.97-4.18 2.97-7.09Z"
      />
      <path
        fill="currentColor"
        d="M12 22c2.69 0 4.94-.88 6.59-2.4l-3.14-2.43c-.84.58-1.97.98-3.45.98a5.99 5.99 0 0 1-5.67-4.14l-.1.01-3.1 2.4-.04.1A9.96 9.96 0 0 0 12 22Z"
      />
      <path
        fill="currentColor"
        d="M6.33 14.01A6.14 6.14 0 0 1 6 12c0-.7.12-1.37.32-2.01l-.01-.14-3.14-2.44-.1.05A10.03 10.03 0 0 0 2 12c0 1.63.39 3.17 1.09 4.53l3.24-2.52Z"
      />
      <path
        fill="currentColor"
        d="M12 5.85c1.87 0 3.13.8 3.85 1.46l2.8-2.74A9.5 9.5 0 0 0 12 2a9.96 9.96 0 0 0-8.92 5.47l3.24 2.52A6.01 6.01 0 0 1 12 5.85Z"
      />
    </svg>
  )
}

function Brand() {
  return (
    <div className="auth-brand" aria-label="TradingAgents">
      <span>TRADING</span>
      <span className="auth-brand-accent">AGENTS</span>
    </div>
  )
}

function StatusDot({ busy = false }: { busy?: boolean }) {
  return <span className={`auth-status-dot${busy ? ' auth-status-dot--busy' : ''}`} aria-hidden="true" />
}

function StatePanel({
  code,
  heading,
  message,
  actionLabel,
  onAction,
  children,
}: {
  code: string
  heading: string
  message: string
  actionLabel?: string
  onAction?: () => void
  children?: ReactNode
}) {
  return (
    <div className="auth-state-panel">
      <div className="auth-panel-code">{code}</div>
      <h1 id="auth-heading">{heading}</h1>
      <p>{message}</p>
      {children}
      {actionLabel && onAction ? (
        <button className="auth-command-button auth-command-button--compact" type="button" onClick={onAction}>
          <span>{actionLabel}</span>
          <span aria-hidden="true">&#8594;</span>
        </button>
      ) : null}
    </div>
  )
}

function authStatusText(activity: ReturnType<typeof useAuth>['activity']): string {
  switch (activity) {
    case 'signing_in':
      return 'AUTHENTICATING CREDENTIALS'
    case 'signing_out':
      return 'ENDING SECURE SESSION'
    case 'verifying':
      return 'VERIFYING BACKEND SESSION'
    default:
      return 'INITIALIZING FIREBASE AUTH'
  }
}

export function LoginPage() {
  const auth = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [localError, setLocalError] = useState<string | null>(null)
  const emailId = useId()
  const passwordId = useId()
  const errorId = useId()
  const busy = auth.phase === 'initializing' || auth.phase === 'submitting'

  const handleEmailLogin = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!email.trim()) {
      setLocalError('Enter your email address.')
      return
    }
    if (!password) {
      setLocalError('Enter your password.')
      return
    }
    setLocalError(null)
    void auth.loginWithEmail(email, password)
  }

  const visibleError = localError ?? auth.error

  return (
    <main className="auth-shell" aria-busy={busy}>
      <div className="auth-grid-glow" aria-hidden="true" />
      <section className="auth-card" aria-labelledby="auth-heading">
        <header className="auth-card-header">
          <div>
            <p className="auth-eyebrow">SECURE MARKET INTELLIGENCE</p>
            <Brand />
          </div>
          <div className="auth-node-mark" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
        </header>

        <div className="auth-live-line" role="status" aria-live="polite">
          <StatusDot busy={busy} />
          <span>{authStatusText(auth.activity)}</span>
        </div>

        {auth.phase === 'setup_required' ? (
          <StatePanel
            code="CONFIG // 00"
            heading="SETUP REQUIRED"
            message={auth.setupMessage ?? 'Authentication configuration is incomplete.'}
            actionLabel="RECHECK CONFIGURATION"
            onAction={auth.retry}
          >
            <div className="auth-missing" aria-label="Missing server environment variables">
              <span className="auth-missing-label">MISSING SERVER VARIABLES</span>
              <ul>
                {auth.missing.map((name) => (
                  <li key={name}>
                    <code>{name}</code>
                  </li>
                ))}
              </ul>
            </div>
          </StatePanel>
        ) : auth.phase === 'forbidden' ? (
          <StatePanel
            code="ACCESS // 03"
            heading="ACCOUNT NOT AUTHORIZED"
            message="Your identity was verified, but this account does not have workstation access. Contact the Firebase administrator."
            actionLabel="RETURN TO LOGIN"
            onAction={() => void auth.logout()}
          >
            <div className="auth-alert" role="alert" aria-live="assertive">
              {visibleError}
            </div>
          </StatePanel>
        ) : auth.phase === 'error' ? (
          <StatePanel
            code="SYSTEM // ERR"
            heading="AUTH SERVICE OFFLINE"
            message="The secure session could not be established. Confirm the backend is running and retry the connection."
            actionLabel="RETRY CONNECTION"
            onAction={auth.retry}
          >
            <div className="auth-alert" role="alert" aria-live="assertive">
              {visibleError}
            </div>
          </StatePanel>
        ) : (
          <div className="auth-access-panel">
            <div className="auth-panel-code">ACCESS // 01</div>
            <h1 id="auth-heading">Sign in to workstation</h1>
            <p className="auth-supporting-copy">
              Authentication is required before market analysis and Firestore history can be accessed.
            </p>

            <button
              className="auth-google-button"
              type="button"
              disabled={busy}
              onClick={() => {
                setLocalError(null)
                void auth.loginWithGoogle()
              }}
            >
              <GoogleMark />
              <span>CONTINUE WITH GOOGLE</span>
              {busy ? <span className="auth-spinner" aria-hidden="true" /> : null}
            </button>

            <div className="auth-divider" aria-hidden="true">
              <span>OR USE EMAIL</span>
            </div>

            <form className="auth-form" onSubmit={handleEmailLogin} noValidate>
              <div className="auth-field">
                <label htmlFor={emailId}>Email address</label>
                <input
                  id={emailId}
                  name="email"
                  type="email"
                  autoComplete="email"
                  inputMode="email"
                  value={email}
                  disabled={busy}
                  aria-invalid={Boolean(localError && !email.trim())}
                  aria-describedby={visibleError ? errorId : undefined}
                  onChange={(event) => {
                    setEmail(event.currentTarget.value)
                    if (localError) setLocalError(null)
                  }}
                />
              </div>

              <div className="auth-field">
                <label htmlFor={passwordId}>Password</label>
                <input
                  id={passwordId}
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  disabled={busy}
                  aria-invalid={Boolean(localError && email.trim() && !password)}
                  aria-describedby={visibleError ? errorId : undefined}
                  onChange={(event) => {
                    setPassword(event.currentTarget.value)
                    if (localError) setLocalError(null)
                  }}
                />
              </div>

              <div
                id={errorId}
                className={`auth-error-region${visibleError ? ' auth-error-region--visible' : ''}`}
                role={visibleError ? 'alert' : undefined}
                aria-live="assertive"
              >
                {visibleError ?? ''}
              </div>

              <button className="auth-command-button" type="submit" disabled={busy}>
                <span className="auth-key-block">ENT</span>
                <span>LOGIN TO TERMINAL</span>
                <span className="auth-command-arrow" aria-hidden="true">
                  &#8594;
                </span>
              </button>
            </form>
          </div>
        )}

        <footer className="auth-policy">
          LOGIN ONLY <span aria-hidden="true">·</span> ACCOUNTS ARE MANAGED BY THE FIREBASE ADMINISTRATOR
        </footer>
      </section>
    </main>
  )
}
