import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'

const e2eAuthProvider = fileURLToPath(new URL('./e2e/mocks/AuthProvider.tsx', import.meta.url))
const e2eHistoryRepository = fileURLToPath(new URL('./e2e/mocks/tradingHistoryRepository.ts', import.meta.url))

export default defineConfig(({ mode }) => {
  const useE2eFirebaseMocks = mode === 'e2e'
  const e2eFirebaseMockPlugin = {
    name: 'tradingagents-e2e-firebase-mocks',
    enforce: 'pre' as const,
    resolveId(source: string, importer: string | undefined) {
      if (!useE2eFirebaseMocks) return null
      const normalizedImporter = importer?.replaceAll('\\', '/') ?? ''
      if (source === './AuthProvider' && normalizedImporter.includes('/src/auth/')) {
        return e2eAuthProvider
      }
      if (source.endsWith('/firebase/tradingHistoryRepository')) {
        return e2eHistoryRepository
      }
      return null
    },
  }

  return {
    plugins: [react(), e2eFirebaseMockPlugin],
    server: {
      host: 'localhost',
      port: 5173,
      strictPort: true,
    },
    preview: {
      host: 'localhost',
      port: 4173,
    },
    test: {
      include: ['src/test/**/*.test.{ts,tsx}'],
      environment: 'jsdom',
      setupFiles: ['./src/test/setup.ts'],
      css: true,
      restoreMocks: true,
      clearMocks: true,
    },
  }
})
