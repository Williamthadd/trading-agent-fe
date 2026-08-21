import { expect, test, type Page, type Route } from '@playwright/test'
import { activeRunFixture, completedRunFixture, optionsFixture } from '../src/test/fixtures'

type AuthMode = 'disabled' | 'login'

async function json(route: Route, body: unknown, status = 200): Promise<void> {
  await route.fulfill({
    status,
    contentType: 'application/json',
    headers: { 'Access-Control-Allow-Origin': 'http://localhost:5173' },
    body: JSON.stringify(body),
  })
}

async function mockApi(page: Page, authMode: AuthMode = 'disabled'): Promise<void> {
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
      await json(route, { date: url.searchParams.get('date'), count: 1, runs: [completedRunFixture] })
      return
    }
    if (path === `/api/history/${completedRunFixture.run_id}`) {
      await json(route, completedRunFixture)
      return
    }
    if (path === '/api/runs' && request.method() === 'POST') {
      await json(route, activeRunFixture, 202)
      return
    }
    if (path === `/api/runs/${activeRunFixture.run_id}`) {
      await json(route, activeRunFixture)
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
