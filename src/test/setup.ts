/// <reference types="node" />

import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { transferableAbortController } from 'node:util'
import { afterAll, afterEach, beforeAll, vi } from 'vitest'
import { server } from './server'

// Node 25 exposes an incomplete experimental global localStorage when its
// --localstorage-file flag has no value. Install a deterministic browser-like
// Storage object so jsdom and application code see the same implementation.
const storageValues = new Map<string, string>()
const testStorage: Storage = {
  get length() {
    return storageValues.size
  },
  clear: () => storageValues.clear(),
  getItem: (key) => storageValues.get(String(key)) ?? null,
  key: (index) => [...storageValues.keys()][index] ?? null,
  removeItem: (key) => storageValues.delete(String(key)),
  setItem: (key, value) => storageValues.set(String(key), String(value)),
}
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: testStorage })
Object.defineProperty(window, 'localStorage', { configurable: true, value: testStorage })

class TestAbortController {
  private readonly controller = transferableAbortController()

  get signal(): AbortSignal {
    return this.controller.signal as AbortSignal
  }

  abort(reason?: unknown): void {
    this.controller.abort(reason)
  }
}
Object.defineProperty(globalThis, 'AbortController', {
  configurable: true,
  value: TestAbortController,
})
Object.defineProperty(window, 'AbortController', {
  configurable: true,
  value: TestAbortController,
})

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => {
  cleanup()
  server.resetHandlers()
  localStorage.clear()
})
afterAll(() => server.close())

Object.assign(navigator, {
  clipboard: {
    writeText: vi.fn().mockResolvedValue(undefined),
  },
})

if (!HTMLElement.prototype.scrollIntoView) {
  HTMLElement.prototype.scrollIntoView = vi.fn()
}
