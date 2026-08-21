import type { ReactNode } from 'react'
import { AuthProvider } from '../auth'

export function AppProviders({ children }: { children: ReactNode }) {
  return <AuthProvider>{children}</AuthProvider>
}
