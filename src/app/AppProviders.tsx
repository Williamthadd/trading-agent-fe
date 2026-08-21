import type { ReactNode } from 'react'
import { AuthProvider } from '../auth'
import { tradingHistoryRepository } from '../firebase/tradingHistoryRepository'

export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <AuthProvider verifyAccess={tradingHistoryRepository.verifyReadAccess}>
      {children}
    </AuthProvider>
  )
}
