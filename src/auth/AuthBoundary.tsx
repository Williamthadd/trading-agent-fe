import type { ReactNode } from 'react'

import { useAuth } from './AuthProvider'
import { LoginPage } from './LoginPage'

export interface AuthBoundaryProps {
  children: ReactNode
}

/** Unmounts all protected UI and in-memory workstation state on auth loss. */
export function AuthBoundary({ children }: AuthBoundaryProps) {
  const { phase } = useAuth()
  return phase === 'authenticated' ? <>{children}</> : <LoginPage />
}
