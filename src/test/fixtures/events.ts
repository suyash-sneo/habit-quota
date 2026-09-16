/**
 * Synthetic fixtures. Every value here is invented — no real habit data, no
 * real device names, no real notes.
 */

import { EVENT_SCHEMA_VERSION } from '../../domain/events/types.ts'
import type {
  DomainEvent,
  EntrySnapshot,
  GoalSnapshot,
  HabitSnapshot,
  TrackingModel,
} from '../../domain/events/types.ts'
import type { LocalDate } from '../../domain/time/civil.ts'

export const DEVICE_A = '11111111-1111-4111-8111-111111111111'
export const DEVICE_B = '22222222-2222-4222-8222-222222222222'
export const HABIT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
export const TZ = 'America/Los_Angeles'
export const TODAY: LocalDate = '2026-09-16'

let counter = 0
export function testId(prefix = 'id'): string {
  counter += 1
  return `${prefix}-${String(counter).padStart(8, '0')}-0000-4000-8000-000000000000`.slice(0, 40)
}

export function resetTestIds(): void {
  counter = 0
}

export function habitSnapshot(patch: Partial<HabitSnapshot> = {}): HabitSnapshot {
  return {
    habitId: HABIT_ID,
    displayName: 'Violin practice',
    trackingModel: 'duration',
    unit: 'minutes',
    isPrivate: false,
    sortOrder: 0,
    archived: false,
    createdLocalDate: '2026-01-01',
    streakThreshold: 10,
    logLabel: 'Log practice',
    ...patch,
  }
}

export function entrySnapshot(patch: Partial<EntrySnapshot> = {}): EntrySnapshot {
  return {
    entryId: testId('entry'),
    habitId: HABIT_ID,
    occurredLocalDate: TODAY,
    timezoneId: TZ,
    value: 25,
    unit: 'minutes',
    deleted: false,
    ...patch,
  }
}

export function goalSnapshot(patch: Partial<GoalSnapshot> = {}): GoalSnapshot {
  return {
    goalId: testId('goal'),
    habitId: HABIT_ID,
    goalType: 'periodic-minimum',
    metric: 'duration-minutes',
    targetValue: 300,
    period: 'week',
    effectiveFromLocalDate: '2026-01-01',
    timezoneId: TZ,
    weekStartsOn: 1,
    active: true,
    ...patch,
  }
}

export interface EventOptions {
  eventId?: string
  parents?: string[]
  deviceId?: string
  sequence?: number
  recordedAt?: string
}

export function entryEvent(
  eventType: DomainEvent['eventType'],
  snapshot: EntrySnapshot,
  options: EventOptions = {},
): DomainEvent<EntrySnapshot> {
  return {
    schemaVersion: EVENT_SCHEMA_VERSION,
    eventId: options.eventId ?? testId('event'),
    entityId: snapshot.entryId,
    entityType: 'entry',
    habitId: snapshot.habitId,
    eventType,
    parentEventIds: options.parents ?? [],
    deviceId: options.deviceId ?? DEVICE_A,
    deviceSequence: options.sequence ?? 1,
    recordedAt: options.recordedAt ?? '2026-09-16T18:42:00.000Z',
    occurredLocalDate: snapshot.occurredLocalDate,
    timezoneId: snapshot.timezoneId,
    payload: snapshot,
  }
}

export function habitEvent(
  eventType: DomainEvent['eventType'],
  snapshot: HabitSnapshot,
  options: EventOptions = {},
): DomainEvent<HabitSnapshot> {
  return {
    schemaVersion: EVENT_SCHEMA_VERSION,
    eventId: options.eventId ?? testId('event'),
    entityId: snapshot.habitId,
    entityType: 'habit',
    habitId: snapshot.habitId,
    eventType,
    parentEventIds: options.parents ?? [],
    deviceId: options.deviceId ?? DEVICE_A,
    deviceSequence: options.sequence ?? 1,
    recordedAt: options.recordedAt ?? '2026-01-01T12:00:00.000Z',
    occurredLocalDate: snapshot.createdLocalDate,
    timezoneId: TZ,
    payload: snapshot,
  }
}

/** A day-by-day series, for aggregation and streak tests. */
export function entriesFromDailyMinutes(
  minutesByDate: Record<LocalDate, number>,
  model: TrackingModel = 'duration',
): DomainEvent<EntrySnapshot>[] {
  return Object.entries(minutesByDate)
    .filter(([, minutes]) => minutes > 0)
    .map(([date, minutes]) =>
      entryEvent(
        'entry.created',
        entrySnapshot({
          occurredLocalDate: date,
          value: model === 'duration' ? minutes : 1,
          unit: model === 'duration' ? 'minutes' : 'sessions',
        }),
      ),
    )
}
