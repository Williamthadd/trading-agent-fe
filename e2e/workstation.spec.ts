import { expect, test, type Locator, type Page, type Route } from '@playwright/test'
import type { OptionsResponse, TradingRun } from '../src/api/types'
import { TRADING_APP_ALLOWED_EMAIL } from '../src/auth/accessPolicy'
import { activeRunFixture, completedRunFixture, optionsFixture } from '../src/test/fixtures'

type EngineMode = 'ready' | 'offline' | 'forbidden' | 'local'

const longAnalysis = Array.from(
  { length: 36 },
  (_, index) => `## Analysis section ${index + 1}\n\nEvidence, risk controls, and portfolio implications for this stage of the review.`,
).join('\n\n')

const reconstructedCompletedRun: TradingRun = {
  ...completedRunFixture,
  reports: {},
  date_key: completedRunFixture.analysis_date,
  events: [
    ...(Array.isArray(completedRunFixture.events) ? completedRunFixture.events : []),
    {
      event_id: 'report-market',
      sequence: 50,
      type: 'report',
      report_key: 'market_report',
      content: (completedRunFixture.reports as Record<string, unknown>).market_report,
    },
    {
      event_id: 'report-news',
      sequence: 51,
      type: 'report',
      report_key: 'news_report',
      content: (completedRunFixture.reports as Record<string, unknown>).news_report,
    },
    {
      event_id: 'report-decision',
      sequence: 52,
      type: 'report',
      report_key: 'final_trade_decision',
      content: (completedRunFixture.reports as Record<string, unknown>).final_trade_decision,
    },
  ],
}

const e2eActiveRunFixture: TradingRun = {
  ...activeRunFixture,
  run_id: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
}

const scrollableRunFixture: TradingRun = {
  ...reconstructedCompletedRun,
  run_id: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  events: [
    ...Array.from({ length: 64 }, (_, index) => ({
      event_id: `scroll-event-${index + 1}`,
      sequence: index + 1,
      timestamp: `2026-08-20T09:${String(Math.floor(index / 60)).padStart(2, '0')}:${String(index % 60).padStart(2, '0')}Z`,
      agent: index % 2 === 0 ? 'Market Analyst' : 'Risk Manager',
      message: `Transmission ${index + 1}: completed a detailed analysis checkpoint with supporting evidence.`,
      status: 'completed',
    })),
    {
      event_id: 'scroll-report-market',
      sequence: 100,
      type: 'report',
      report_key: 'market_report',
      content: longAnalysis,
    },
    {
      event_id: 'scroll-report-decision',
      sequence: 101,
      type: 'report',
      report_key: 'final_trade_decision',
      content: longAnalysis,
    },
  ],
}

async function json(route: Route, body: unknown, status = 200): Promise<void> {
  const origin = route.request().headers().origin ?? 'http://localhost:5173'
  await route.fulfill({
    status,
    contentType: 'application/json',
    headers: {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Headers': 'Authorization, Content-Type',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    },
    body: JSON.stringify(body),
  })
}

async function mockFirebase(
  page: Page,
  {
    signedIn = true,
    denied = false,
    runs = [reconstructedCompletedRun, e2eActiveRunFixture],
    cachedOptions = optionsFixture,
  }: {
    signedIn?: boolean
    denied?: boolean
    runs?: TradingRun[]
    cachedOptions?: OptionsResponse | null
  } = {},
): Promise<void> {
  await page.addInitScript(
    ({ shouldSignIn, shouldDeny, firestoreRuns, options }) => {
      if (shouldSignIn) localStorage.setItem('e2e.auth', 'signed-in')
      else localStorage.removeItem('e2e.auth')
      if (shouldDeny) localStorage.setItem('e2e.firestoreDenied', 'true')
      else localStorage.removeItem('e2e.firestoreDenied')
      if (options) localStorage.setItem('tradingagents.web.options.v1', JSON.stringify(options))
      else localStorage.removeItem('tradingagents.web.options.v1')

      const now = new Date()
      const dateKey = [
        now.getFullYear(),
        String(now.getMonth() + 1).padStart(2, '0'),
        String(now.getDate()).padStart(2, '0'),
      ].join('-')
      ;(window as unknown as { __E2E_FIRESTORE_RUNS__: TradingRun[] }).__E2E_FIRESTORE_RUNS__ =
        firestoreRuns.map((run) => ({ ...run, analysis_date: dateKey, date_key: dateKey }))
    },
    { shouldSignIn: signedIn, shouldDeny: denied, firestoreRuns: runs, options: cachedOptions },
  )
}

async function mockEngine(
  page: Page,
  initialMode: EngineMode = 'ready',
): Promise<{ setMode: (mode: EngineMode) => void }> {
  let mode = initialMode
  await page.route('http://127.0.0.1:8000/**', async (route) => {
    const request = route.request()
    const path = new URL(request.url()).pathname
    if (request.method() === 'OPTIONS') {
      const origin = request.headers().origin ?? 'http://localhost:5173'
      await route.fulfill({
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': origin,
          'Access-Control-Allow-Headers': 'Authorization, Content-Type',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        },
      })
      return
    }
    if (path === '/api/health') {
      if (mode === 'offline') {
        await route.abort('connectionrefused')
        return
      }
      const storage = mode === 'local'
        ? { mode: 'local-json', backend: 'json', configured: true, message: 'Local JSON' }
        : optionsFixture.storage
      await json(route, {
        status: 'ok',
        service: 'tradingagents-api',
        version: '1.0.0',
        storage,
        active_runs: 1,
      })
      return
    }
    if (path === '/api/options') {
      if (mode === 'forbidden') {
        await json(route, { detail: 'not allowed' }, 403)
        return
      }
      await json(route, optionsFixture)
      return
    }
    if (path === '/api/runs' && request.method() === 'POST') {
      await json(route, { run_id: e2eActiveRunFixture.run_id, ticker: 'NVDA' }, 202)
      return
    }
    await json(route, { detail: `Unhandled test route ${request.method()} ${path}` }, 404)
  })
  return { setMode: (next) => { mode = next } }
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

async function dragHorizontally(page: Page, handle: Locator, distance: number): Promise<void> {
  const box = await handle.boundingBox()
  expect(box).not.toBeNull()
  if (!box) return
  const startX = box.x + box.width / 2
  const startY = box.y + box.height / 2
  await page.mouse.move(startX, startY)
  await page.mouse.down()
  await page.mouse.move(startX + distance, startY, { steps: 5 })
  await page.mouse.up()
}

function overlaps(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y
}

test('terminal login is Firebase-only and complete', async ({ page }, testInfo) => {
  await mockFirebase(page, { signedIn: false })
  await mockEngine(page, 'offline')
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Sign in to workstation' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'CONTINUE WITH GOOGLE' })).toBeVisible()
  await expect(page.getByLabel('Email address')).toBeVisible()
  await expect(page.getByText('Analysis Control')).toHaveCount(0)
  await expectNoPageOverflow(page)
  await page.screenshot({ path: testInfo.outputPath('login-1440x1000.png'), fullPage: true })
})

test('backend offline still allows login, history, reconstructed reports, and decision', async ({ page }) => {
  await mockFirebase(page, { signedIn: false })
  await mockEngine(page, 'offline')
  await page.goto('/')
  await page.getByRole('button', { name: 'CONTINUE WITH GOOGLE' }).click()
  await expect(page.getByText('HISTORY ONLY', { exact: true }).first()).toBeVisible()
  const launch = page.getByRole('button', { name: /Run Intelligence Cycle/ })
  await expect(launch).toBeDisabled()
  await page.getByRole('button', { name: /NVDA.*COMPLETED/ }).click()
  await page.getByRole('tab', { name: /Reports/ }).click()
  const marketCard = page.locator('details.report-card').filter({ hasText: 'Market Report' })
  await marketCard.locator('summary').click()
  await expect(marketCard.getByRole('heading', { name: 'Market Report' })).toBeVisible()
  await page.getByRole('tab', { name: /Decision/ }).click()
  await expect(
    page.getByLabel('Portfolio manager decision').getByText('Accumulate with measured risk.'),
  ).toBeVisible()
})

test('first-use history-only mode preserves the disabled Analysis Control shell', async ({ page }) => {
  await mockFirebase(page, { cachedOptions: null })
  await mockEngine(page, 'offline')
  await page.goto('/')

  await expect(page.getByRole('heading', { name: 'Analysis Control' })).toBeVisible()
  await expect(page.getByLabel('Provider')).toBeDisabled()
  await expect(page.getByLabel('Provider')).toHaveValue('unavailable')
  await expect(page.getByLabel('Symbol / Ticker')).toBeEnabled()
  await expect(page.getByRole('button', { name: /Run Intelligence Cycle/ })).toBeDisabled()
  await expect(page.getByRole('heading', { name: 'Daily History' })).toBeVisible()
})

test('analysis engine retry returns from history-only mode without re-authentication', async ({ page }) => {
  await mockFirebase(page)
  const engine = await mockEngine(page, 'offline')
  await page.goto('/')
  await expect(page.getByText('HISTORY ONLY', { exact: true }).first()).toBeVisible()
  engine.setMode('ready')
  await page.getByRole('button', { name: 'RETRY ENGINE' }).click()
  await expect(page.getByText('READY', { exact: true }).first()).toBeVisible()
  await expect(page.getByRole('button', { name: /Run Intelligence Cycle/ })).toBeEnabled()
  await expect(page.getByText(TRADING_APP_ALLOWED_EMAIL)).toBeVisible()
})

test('stale Firestore rules denial shows retry controls and never flashes history metadata', async ({ page }) => {
  await mockFirebase(page, { denied: true })
  await mockEngine(page)
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'FIRESTORE ACCESS DENIED' })).toBeVisible()
  await expect(page.getByText(/email-only Firestore Rules/).first()).toBeVisible()
  await expect(page.getByRole('button', { name: /RETRY ACCESS/ })).toBeVisible()
  await expect(page.getByRole('button', { name: /LOGOUT/ })).toBeVisible()
  await expect(page.getByText(/RUNS/)).toHaveCount(0)
})

test('backend 403 disables analysis but leaves history selectable', async ({ page }) => {
  await mockFirebase(page)
  await mockEngine(page, 'forbidden')
  await page.goto('/')
  await expect(page.getByText('ANALYSIS ACCESS DENIED', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: /NVDA.*COMPLETED/ }).click()
  await expect(page.getByRole('tab', { name: /Reports/ })).toBeVisible()
  await expect(page.getByRole('button', { name: /Run Intelligence Cycle/ })).toBeDisabled()
})

for (const viewport of [
  { width: 1440, height: 1000, scale: 110 },
  { width: 1024, height: 900, scale: 110 },
  { width: 390, height: 844, scale: 110 },
  { width: 390, height: 844, scale: 160 },
]) {
  test(`idle workstation ${viewport.width}x${viewport.height} at ${viewport.scale}%`, async ({ page }, testInfo) => {
    await page.addInitScript((scale) => localStorage.setItem('tradingagents.web.textScale.v1', String(scale)), viewport.scale)
    await mockFirebase(page)
    await mockEngine(page)
    await page.setViewportSize(viewport)
    await page.goto('/')
    await expect(page.getByRole('heading', { name: 'Analysis Control' })).toBeVisible()
    await expect(page.getByRole('button', { name: /Run Intelligence Cycle/ })).toBeEnabled()
    await expect(page.locator('#terminal-text-scale')).toHaveValue(String(viewport.scale))
    const [providerBox, modelGridBox] = await Promise.all([
      page.getByLabel('Provider').boundingBox(),
      page.locator('.model-routing-grid').boundingBox(),
    ])
    expect(providerBox).not.toBeNull()
    expect(modelGridBox).not.toBeNull()
    if (providerBox && modelGridBox) {
      expect(modelGridBox.y - (providerBox.y + providerBox.height)).toBeGreaterThanOrEqual(10)
    }
    const [inputBox, quickBox, deepBox] = await Promise.all([
      page.locator('#input-panel').boundingBox(),
      page.getByLabel('Quick Model').boundingBox(),
      page.getByLabel('Deep Model').boundingBox(),
    ])
    expect(inputBox).not.toBeNull()
    expect(quickBox).not.toBeNull()
    expect(deepBox).not.toBeNull()
    if (inputBox && quickBox && deepBox) {
      expect(overlaps(quickBox, deepBox)).toBe(false)
      expect(quickBox.x).toBeGreaterThanOrEqual(inputBox.x - 1)
      expect(deepBox.x + deepBox.width).toBeLessThanOrEqual(inputBox.x + inputBox.width + 1)
    }
    await expectNoPageOverflow(page)
    await page.screenshot({
      path: testInfo.outputPath(`idle-${viewport.width}x${viewport.height}-${viewport.scale}.png`),
      fullPage: true,
    })
    await page.reload()
    await expect(page.locator('#terminal-text-scale')).toHaveValue(String(viewport.scale))
  })
}

test('desktop workstation panels resize in both directions and persist their widths', async ({ page }) => {
  await mockFirebase(page)
  await mockEngine(page)
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/')
  const inputPanel = page.locator('#input-panel')
  const deskPanel = page.locator('#intelligence-panel')
  const archivePanel = page.locator('#archive-panel')
  const inputHandle = page.getByRole('separator', { name: 'Resize Input and Intelligence Desk panels' })
  const archiveHandle = page.getByRole('separator', { name: 'Resize Intelligence Desk and Archive panels' })
  await expect(inputHandle).toBeVisible()
  await expect(archiveHandle).toBeVisible()
  const initialInputWidth = await inputPanel.evaluate((node) => node.getBoundingClientRect().width)
  const initialDeskWidth = await deskPanel.evaluate((node) => node.getBoundingClientRect().width)
  await dragHorizontally(page, inputHandle, 120)
  await expect.poll(() => inputPanel.evaluate((node) => node.getBoundingClientRect().width)).toBeGreaterThan(initialInputWidth + 100)
  await expect.poll(() => deskPanel.evaluate((node) => node.getBoundingClientRect().width)).toBeLessThan(initialDeskWidth - 100)
  await inputHandle.focus()
  await page.keyboard.press('Enter')
  await expect.poll(() => inputPanel.evaluate((node) => node.getBoundingClientRect().width)).toBeLessThan(initialInputWidth + 5)
  const initialArchiveWidth = await archivePanel.evaluate((node) => node.getBoundingClientRect().width)
  await dragHorizontally(page, archiveHandle, -100)
  await expect.poll(() => archivePanel.evaluate((node) => node.getBoundingClientRect().width)).toBeGreaterThan(initialArchiveWidth + 80)
  const beforeReload = await archivePanel.evaluate((node) => node.getBoundingClientRect().width)
  await page.reload()
  await expect.poll(() => archivePanel.evaluate((node) => node.getBoundingClientRect().width)).toBeCloseTo(beforeReload, 0)
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(inputHandle).toBeHidden()
  await expect(archiveHandle).toBeHidden()
  await expectNoPageOverflow(page)
})

test('active live wire, focus rings, and reduced motion', async ({ page }, testInfo) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await mockFirebase(page)
  await mockEngine(page)
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
  await mockFirebase(page, { runs: [scrollableRunFixture] })
  await mockEngine(page)
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
  await mockFirebase(page, { runs: [reconstructedCompletedRun] })
  await mockEngine(page)
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

test('logout detaches active Firestore listeners without console or render warnings', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await mockFirebase(page)
  await mockEngine(page)
  await page.goto('/')
  await page.getByRole('button', { name: /NVDA.*COMPLETED/ }).click()
  await expect.poll(() => page.evaluate(() =>
    (window as unknown as { __E2E_FIRESTORE_LISTENERS__?: number }).__E2E_FIRESTORE_LISTENERS__ ?? 0,
  )).toBeGreaterThan(0)
  await page.getByRole('button', { name: 'LOGOUT' }).click()
  await expect(page.getByRole('heading', { name: 'Sign in to workstation' })).toBeVisible()
  await expect.poll(() => page.evaluate(() =>
    (window as unknown as { __E2E_FIRESTORE_LISTENERS__?: number }).__E2E_FIRESTORE_LISTENERS__ ?? 0,
  )).toBe(0)
  expect(errors).toEqual([])
})
