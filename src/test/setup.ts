/**
 * Test environment: a real (in-memory) IndexedDB, Web Crypto, and the handful
 * of browser APIs jsdom does not implement that the app touches.
 */

import '@testing-library/jest-dom/vitest'
import 'fake-indexeddb/auto'
import { webcrypto } from 'node:crypto'
import { afterEach, beforeEach } from 'vitest'
import { cleanup } from '@testing-library/react'
import { HabitDatabase, setDatabaseForTesting } from '../db/database.ts'

if (!globalThis.crypto?.subtle) {
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true })
}

if (!window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia
}

if (!window.requestAnimationFrame) {
  window.requestAnimationFrame = ((cb: FrameRequestCallback) =>
    setTimeout(() => cb(performance.now()), 0) as unknown as number) as typeof window.requestAnimationFrame
  window.cancelAnimationFrame = ((id: number) => clearTimeout(id)) as typeof window.cancelAnimationFrame
}

if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {}
}

let databaseCounter = 0

/**
 * Each test file gets a fresh database name so parallel workers never share a
 * store, and every test starts from an empty log.
 */
beforeEach(async () => {
  databaseCounter += 1
  const database = new HabitDatabase(`habit-test-${Date.now()}-${databaseCounter}`)
  setDatabaseForTesting(database)
  await database.open()
})

afterEach(async () => {
  cleanup()
  const { db } = await import('../db/database.ts')
  try {
    await db().delete()
  } catch {
    // A test that already deleted the database is fine.
  }
  setDatabaseForTesting(null)
})
