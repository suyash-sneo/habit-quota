/**
 * Helpers for component tests: render a screen inside the real router and
 * provider stack, then wait for the first Dexie query to resolve.
 */

import { render, screen, waitForElementToBeRemoved } from '@testing-library/react'
import type { RenderResult } from '@testing-library/react'
import type { ReactNode } from 'react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { AppProvider } from '../app/providers.tsx'
import { createHabit } from '../db/repositories/habits.ts'
import { createEntry } from '../db/repositories/entries.ts'
import { createGoal } from '../db/repositories/goals.ts'
import { saveSettings } from '../db/database.ts'
import type { TrackingModel } from '../domain/events/types.ts'
import { unitForModel } from '../domain/events/types.ts'
import type { LocalDate } from '../domain/time/civil.ts'
import { deviceTimezone, todayInZone } from '../domain/time/zone.ts'

// Matching the machine's own zone keeps the provider's first render and its
// post-load render on the same local date, so tests never race that transition.
export const TEST_TZ = deviceTimezone()
export const TEST_TODAY: LocalDate = todayInZone(TEST_TZ)

export function renderWithProviders(
  ui: ReactNode,
  { route = '/', path = '/' }: { route?: string; path?: string } = {},
): RenderResult {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <AppProvider>
        <Routes>
          <Route path={path} element={ui} />
        </Routes>
      </AppProvider>
    </MemoryRouter>,
  )
}

/** Waits out the provider's boot sequence and the first live query. */
export async function waitForAppReady(): Promise<void> {
  const loading = screen.queryByText(/Opening your local database|Rebuilding your views|Loading/i)
  if (loading) await waitForElementToBeRemoved(() => screen.queryByText(loading.textContent ?? ''))
}

export interface SeedOptions {
  displayName?: string
  trackingModel?: TrackingModel
  isPrivate?: boolean
  streakThreshold?: number
  /** Local date -> value. Duration uses minutes; other models record that many entries. */
  days?: Record<string, number>
  goal?: 'weekly-minimum' | 'weekly-maximum' | 'cumulative'
}

export async function seedHabit(options: SeedOptions = {}): Promise<string> {
  await saveSettings({ timezoneId: TEST_TZ, weekStartsOn: 1, onboardedAt: new Date().toISOString() })

  const model = options.trackingModel ?? 'duration'
  const habit = await createHabit({
    displayName: options.displayName ?? 'Violin practice',
    trackingModel: model,
    isPrivate: options.isPrivate ?? false,
    streakThreshold: options.streakThreshold ?? 10,
    createdLocalDate: '2026-01-01',
    timezoneId: TEST_TZ,
  })

  for (const [date, value] of Object.entries(options.days ?? {})) {
    if (value <= 0) continue
    const occurrences = model === 'duration' ? 1 : value
    for (let i = 0; i < occurrences; i += 1) {
      await createEntry({
        habitId: habit.habitId,
        occurredLocalDate: date,
        timezoneId: TEST_TZ,
        value: model === 'duration' ? value : 1,
        unit: unitForModel(model),
        startTime: 18 * 60 + 15 + i * 30,
        note: 'Scales and bowing',
      })
    }
  }

  if (options.goal === 'weekly-minimum') {
    await createGoal({
      habitId: habit.habitId,
      goalType: 'periodic-minimum',
      metric: 'duration-minutes',
      targetValue: 300,
      period: 'week',
      effectiveFromLocalDate: '2026-01-01',
      timezoneId: TEST_TZ,
      weekStartsOn: 1,
    })
  } else if (options.goal === 'weekly-maximum') {
    await createGoal({
      habitId: habit.habitId,
      goalType: 'periodic-maximum',
      metric: 'occurrence-count',
      targetValue: 2,
      period: 'week',
      effectiveFromLocalDate: '2026-01-01',
      timezoneId: TEST_TZ,
      weekStartsOn: 1,
    })
  } else if (options.goal === 'cumulative') {
    await createGoal({
      habitId: habit.habitId,
      goalType: 'cumulative-by-deadline',
      metric: 'duration-minutes',
      targetValue: 3600,
      deadlineLocalDate: `${TEST_TODAY.slice(0, 4)}-12-31`,
      effectiveFromLocalDate: '2026-01-01',
      timezoneId: TEST_TZ,
      weekStartsOn: 1,
    })
  }

  return habit.habitId
}
