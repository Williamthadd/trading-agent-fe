import { expect, test, type Locator, type Page, type Route } from '@playwright/test'
import type { TradingRun } from '../src/api/types'
import { activeRunFixture, completedRunFixture, optionsFixture } from '../src/test/fixtures'

type AuthMode = 'disabled' | 'login'

interface MockApiFixtures {
  activeRun?: TradingRun
  completedRun?: TradingRun
}

const longAnalysis = Array.from(
  { length: 36 },
  (_, index) => `## Analysis section ${index + 1}\n\nEvidence, risk controls, and portfolio implications for this stage of the review.`,
).join('\n\n')

const scrollableRunFixture: TradingRun = {
  ...completedRunFixture,
  run_id: 'scrollable-output-run-000000000001',
  events: Array.from({ length: 64 }, (_, index) => ({
    id: `scroll-event-${index + 1}`,
    sequence: index + 1,
    timestamp: `2026-08-20T09:${String(Math.floor(index / 60)).padStart(2, '0')}:${String(index % 60).padStart(2, '0')}Z`,
    agent: index % 2 === 0 ? 'Market Analyst' : 'Risk Manager',
    message: `Transmission ${index + 1}: completed a detailed analysis checkpoint with supporting evidence.`,
    status: 'completed',
  })),
  reports: {
    ...(completedRunFixture.reports as Record<string, unknown>),
    market_report: longAnalysis,
    final_trade_decision: longAnalysis,
  },
}

async function json(route: Route, body: unknown, status = 200): Promise<void> {
  await route.fulfill({
    status,
    contentType: 'application/json',
    headers: { 'Access-Control-Allow-Origin': 'http://localhost:5173' },
    body: JSON.stringify(body),
  })
}

async function mockApi(
  page: Page,
  authMode: AuthMode = 'disabled',
  fixtures: MockApiFixtures = {},
): Promise<void> {
  const activeRun = fixtures.activeRun ?? activeRunFixture
  const completedRun = fixtures.completedRun ?? completedRunFixture
  await page.route('http://127.0.0.1:8000/**', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    const path = url.pathname
    if (path === '/api/auth/config') {
      await json(route, authMode === 'disabled' ? {
        required: false,
        configured: true,
        firebase: {},
        missing: [],
        access_restricted: false,
      } : {
        required: true,
        configured: true,
        firebase: {
          apiKey: 'public-test-key',
          authDomain: 'demo.example.test',
          projectId: 'demo-project',
          appId: '1:123:web:abc',
        },
        missing: [],
        access_restricted: true,
      })
      return
    }
    if (path === '/api/auth/session') {
      await json(route, {
        authenticated: true,
        user: { uid: 'local-user', email: 'analyst@example.com', auth_disabled: true },
      })
      return
    }
    if (path === '/api/options') {
      await json(route, optionsFixture)
      return
    }
    if (path === '/api/health') {
      await json(route, {
        status: 'ok', service: 'tradingagents-api', version: '1.0.0',
        storage: optionsFixture.storage, active_runs: 1,
      })
      return
    }
    if (path === '/api/history') {
      await json(route, { date: url.searchParams.get('date'), count: 1, runs: [completedRun] })
      return
    }
    if (path === `/api/history/${completedRun.run_id}`) {
      await json(route, completedRun)
      return
    }
    if (path === '/api/runs' && request.method() === 'POST') {
      await json(route, activeRun, 202)
      return
    }
    if (path === `/api/runs/${activeRun.run_id}`) {
      await json(route, activeRun)
      return
    }
    await json(route, { detail: `Unhandled test route ${request.method()} ${path}` }, 404)
  })
}

async function expectNoPageOverflow(page: Page): Promise<void> {
  await expect.poll(() => page.evaluate(
    () => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
  )).toBe(true)
}

async function expectWheelScrollable(page: Page, scroller: Locator): Promise<void> {
  await expect(scroller).toBeVisible()
  const dimensions = await scroller.evaluate((node) => ({
    clientHeight: node.clientHeight,
    overflowY: getComputedStyle(node).overflowY,
    scrollHeight: node.scrollHeight,
  }))
  expect(dimensions.clientHeight).toBeGreaterThan(0)
  expect(dimensions.scrollHeight).toBeGreaterThan(dimensions.clientHeight + 1)
  expect(['auto', 'scroll']).toContain(dimensions.overflowY)

  await scroller.evaluate((node) => { node.scrollTop = 0 })
  await scroller.hover()
  await page.mouse.wheel(0, 500)
  await expect.poll(() => scroller.evaluate((node) => node.scrollTop)).toBeGreaterThan(0)
}

function overlaps(a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y
}

test('terminal login is isolated and complete', async ({ page }, testInfo) => {
  await mockApi(page, 'login')
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Sign in to workstation' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'CONTINUE WITH GOOGLE' })).toBeVisible()
  await expect(page.getByLabel('Email address')).toBeVisible()
  await expect(page.getByText('Analysis Control')).toHaveCount(0)
  await expectNoPageOverflow(page)
  await page.screenshot({ path: testInfo.outputPath('login-1440x1000.png'), fullPage: true })
})

for (const viewport of [
  { width: 1440, height: 1000, scale: 110 },
  { width: 1024, height: 900, scale: 110 },
  { width: 390, height: 844, scale: 110 },
  { width: 390, height: 844, scale: 160 },
]) {
  test(`idle workstation ${viewport.width}x${viewport.height} at ${viewport.scale}%`, async ({ page }, testInfo) => {
    await page.addInitScript((scale) => localStorage.setItem('tradingagents.web.textScale.v1', String(scale)), viewport.scale)
    await mockApi(page)
    await page.setViewportSize(viewport)
    await page.goto('/')
    await expect(page.getByRole('heading', { name: 'Analysis Control' })).toBeVisible()
    await expect(page.locator('#terminal-text-scale')).toHaveValue(String(viewport.scale))
    await expect(page.locator('html')).toHaveCSS('--text-scale', String(viewport.scale / 100))
    await expectNoPageOverflow(page)
    await page.screenshot({
      path: testInfo.outputPath(`idle-${viewport.width}x${viewport.height}-${viewport.scale}.png`),
      fullPage: true,
    })
    await page.reload()
    await expect(page.locator('#terminal-text-scale')).toHaveValue(String(viewport.scale))
  })
}

test('active live wire, focus rings, and reduced motion', async ({ page }, testInfo) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await mockApi(page)
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto('/')
  await page.getByRole('button', { name: /Run Intelligence Cycle/ }).click()
  await expect(page.getByRole('tab', { name: /Live Wire/ })).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByText('Market structure and volume profile received.', { exact: true })).toBeVisible()
  await expectNoPageOverflow(page)

  await page.keyboard.press('Tab')
  const focusedOutline = await page.evaluate(() => {
    const active = document.activeElement
    return active instanceof HTMLElement ? getComputedStyle(active).outlineWidth : '0px'
  })
  expect(Number.parseFloat(focusedOutline)).toBeGreaterThanOrEqual(2)
  const reducedDuration = await page.locator('.desk-progress > span').evaluate(
    (node) => Number.parseFloat(getComputedStyle(node).transitionDuration),
  )
  expect(reducedDuration).toBeLessThanOrEqual(0.00001)
  await page.screenshot({ path: testInfo.outputPath('active-live-wire.png'), fullPage: true })
})

test('live wire, reports, and decision outputs scroll at the constrained desktop viewport', async ({ page }) => {
  await mockApi(page, 'disabled', { completedRun: scrollableRunFixture })
  await page.setViewportSize({ width: 1174, height: 769 })
  await page.goto('/')
  await page.getByRole('button', { name: /NVDA.*COMPLETED/ }).click()

  await expectWheelScrollable(page, page.getByLabel('Agent response event stream'))

  await page.getByRole('tab', { name: /Reports/ }).click()
  await expectWheelScrollable(page, page.getByLabel('Scrollable analysis reports'))

  await page.getByRole('tab', { name: /Decision/ }).click()
  await expectWheelScrollable(page, page.getByLabel('Scrollable final decision analysis'))
})

test('formatted reports, final decision, and populated archive remain collision-free', async ({ page }, testInfo) => {
  await mockApi(page)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  await page.getByRole('button', { name: /NVDA.*COMPLETED/ }).click()
  await page.getByRole('tab', { name: /Reports/ }).click()
  const marketCard = page.locator('details.report-card').filter({ hasText: 'Market Report' })
  await marketCard.locator('summary').click()
  await expect(marketCard.getByRole('heading', { name: 'Market Report' })).toBeVisible()
  const table = page.getByLabel('Scrollable analysis table')
  const code = page.getByLabel('Scrollable code block')
  await expect(table).toBeVisible()
  await expect(code).toBeVisible()
  expect(await table.evaluate((node) => getComputedStyle(node).overflowX)).toBe('auto')
  expect(await code.evaluate((node) => getComputedStyle(node).overflowX)).toBe('auto')
  await expectNoPageOverflow(page)
  await page.screenshot({ path: testInfo.outputPath('reports-mobile.png'), fullPage: true })

  await page.getByRole('tab', { name: /Decision/ }).click()
  await expect(page.getByText('PORTFOLIO MANAGER VERDICT')).toBeVisible()
  const headline = await page.locator('.decision-hero h4').boundingBox()
  const badge = await page.locator('.decision-hero strong').boundingBox()
  expect(headline).not.toBeNull()
  expect(badge).not.toBeNull()
  if (headline && badge) expect(overlaps(headline, badge)).toBe(false)
  await expectNoPageOverflow(page)
  await page.screenshot({ path: testInfo.outputPath('decision-history-mobile.png'), fullPage: true })
})
