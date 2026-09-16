/**
 * Synthetic demo data.
 *
 * Development only — `seedDemoData` refuses to run in a production build, so
 * this can never become a shipped control that writes fake history into a real
 * user's database. Every value here is invented.
 */

import { createHabit } from './repositories/habits.ts'
import { createGoal } from './repositories/goals.ts'
import { createEntry } from './repositories/entries.ts'
import { db } from './database.ts'
import type { TrackingModel } from '../domain/events/types.ts'
import { unitForModel } from '../domain/events/types.ts'
import { addDays } from '../domain/time/civil.ts'
import type { LocalDate } from '../domain/time/civil.ts'

/** Deterministic hash so a seeded database looks the same on every run. */
function hash01(input: string): number {
  let x = 2166136261
  for (let i = 0; i < input.length; i += 1) {
    x ^= input.charCodeAt(i)
    x = Math.imul(x, 16777619)
  }
  x ^= x >>> 15
  x = Math.imul(x, 2246822507)
  x ^= x >>> 13
  return (x >>> 0) / 4294967296
}

function pick<T>(seed: string, options: readonly T[]): T {
  return options[Math.min(options.length - 1, Math.floor(hash01(seed) * options.length))] as T
}

const DURATION_NOTES = [
  'Scales and bowing',
  'Technique exercises',
  'Repertoire',
  'Etudes',
  'Sight-reading',
  'Intonation drills',
]

const STUDY_NOTES = ['Policy gradient reading', 'Credit assignment', 'Lecture notes', 'Experiments']

const SESSION_NOTES = ['Upper body', 'Run 5k', 'Full body', 'Intervals']

interface SeedHabit {
  displayName: string
  trackingModel: TrackingModel
  isPrivate: boolean
  streakThreshold: number
  /** Chance a given day has no activity at all. */
  gap: number
  values: readonly number[]
  notes: readonly string[]
  goal?: 'cumulative' | 'weekly-minutes' | 'weekly-sessions' | 'weekly-max'
}

const SEED_HABITS: SeedHabit[] = [
  {
    displayName: 'Violin practice',
    trackingModel: 'duration',
    isPrivate: false,
    streakThreshold: 10,
    gap: 0.32,
    values: [15, 20, 25, 25, 30, 30, 35, 40, 45, 50, 60],
    notes: DURATION_NOTES,
    goal: 'cumulative',
  },
  {
    displayName: 'MARL study',
    trackingModel: 'duration',
    isPrivate: false,
    streakThreshold: 15,
    gap: 0.38,
    values: [20, 30, 40, 45, 50, 60, 75],
    notes: STUDY_NOTES,
    goal: 'weekly-minutes',
  },
  {
    displayName: 'Workout',
    trackingModel: 'count',
    isPrivate: false,
    streakThreshold: 1,
    gap: 0.45,
    values: [1, 1, 1, 2],
    notes: SESSION_NOTES,
    goal: 'weekly-sessions',
  },
  {
    displayName: 'Private',
    trackingModel: 'negative-occurrence',
    isPrivate: true,
    streakThreshold: 1,
    gap: 0.93,
    values: [1],
    notes: [],
    goal: 'weekly-max',
  },
]

export interface SeedOptions {
  today: LocalDate
  timezoneId: string
  weekStartsOn: 1 | 2 | 3 | 4 | 5 | 6 | 7
  /** How many days of invented history to write. */
  days?: number
}

export function seedingAvailable(): boolean {
  return import.meta.env.DEV === true
}

export async function seedDemoData(options: SeedOptions): Promise<void> {
  if (!seedingAvailable()) {
    throw new Error('Demo data can only be generated in a development build.')
  }
  const days = options.days ?? 140
  const start = addDays(options.today, -days)

  for (const spec of SEED_HABITS) {
    const habit = await createHabit({
      displayName: spec.displayName,
      trackingModel: spec.trackingModel,
      isPrivate: spec.isPrivate,
      streakThreshold: spec.streakThreshold,
      createdLocalDate: start,
      timezoneId: options.timezoneId,
    })

    const unit = unitForModel(spec.trackingModel)
    for (let offset = 0; offset <= days; offset += 1) {
      const date = addDays(start, offset)
      const seed = `${habit.habitId}:${date}`
      if (hash01(seed) < spec.gap) continue
      const value = pick(`v${seed}`, spec.values)
      const startTime = spec.trackingModel === 'negative-occurrence' ? 22 * 60 + 40 : 17 * 60 + 45
      await createEntry({
        habitId: habit.habitId,
        occurredLocalDate: date,
        timezoneId: options.timezoneId,
        value: spec.trackingModel === 'duration' ? value : 1,
        unit,
        startTime,
        endTime:
          spec.trackingModel === 'duration' ? Math.min(1439, startTime + value) : undefined,
        note: spec.notes.length ? pick(`n${seed}`, spec.notes) : undefined,
      })
    }

    if (spec.goal === 'cumulative') {
      await createGoal({
        habitId: habit.habitId,
        goalType: 'cumulative-by-deadline',
        metric: 'duration-minutes',
        targetValue: 60 * 60,
        deadlineLocalDate: `${options.today.slice(0, 4)}-12-31`,
        effectiveFromLocalDate: start,
        timezoneId: options.timezoneId,
        weekStartsOn: options.weekStartsOn,
      })
    } else if (spec.goal === 'weekly-minutes') {
      await createGoal({
        habitId: habit.habitId,
        goalType: 'periodic-minimum',
        metric: 'duration-minutes',
        targetValue: 300,
        period: 'week',
        effectiveFromLocalDate: start,
        timezoneId: options.timezoneId,
        weekStartsOn: options.weekStartsOn,
      })
    } else if (spec.goal === 'weekly-sessions') {
      await createGoal({
        habitId: habit.habitId,
        goalType: 'periodic-minimum',
        metric: 'completion-count',
        targetValue: 4,
        period: 'week',
        effectiveFromLocalDate: start,
        timezoneId: options.timezoneId,
        weekStartsOn: options.weekStartsOn,
      })
    } else if (spec.goal === 'weekly-max') {
      await createGoal({
        habitId: habit.habitId,
        goalType: 'periodic-maximum',
        metric: 'occurrence-count',
        targetValue: 2,
        period: 'week',
        effectiveFromLocalDate: start,
        timezoneId: options.timezoneId,
        weekStartsOn: options.weekStartsOn,
      })
    }
  }
}

/** Development helper: wipe every table so a flow can be replayed from zero. */
export async function clearAllData(): Promise<void> {
  const database = db()
  await database.transaction(
    'rw',
    database.tables,
    async () => {
      await Promise.all(database.tables.map((t) => t.clear()))
    },
  )
}
