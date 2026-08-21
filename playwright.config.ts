import { defineConfig, devices } from '@playwright/test'

const playwrightPort = process.env.PLAYWRIGHT_PORT ?? '5173'
const playwrightBaseUrl = `http://localhost:${playwrightPort}`

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: playwrightBaseUrl,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: `npm run dev -- --mode e2e --port ${playwrightPort} --strictPort`,
    url: playwrightBaseUrl,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      VITE_TRADINGAGENTS_API_URL: 'http://127.0.0.1:8000',
    },
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
})
