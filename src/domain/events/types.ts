/**
 * The authoritative domain model.
 *
 * Every user-meaningful change is an immutable {@link DomainEvent}. Habits,
 * goals, entries, streaks and totals are all projections of the event log and
 * can be thrown away and rebuilt. Nothing in this file imports React or Dexie.
 */

import type { IsoWeekday, LocalDate } from '../time/civil.ts'
import type { TimezoneId } from '../time/zone.ts'

export const EVENT_SCHEMA_VERSION = 1 as const

export type TrackingModel = 'duration' | 'completion' | 'count' | 'negative-occurrence'

export type Unit = 'minutes' | 'sessions' | 'count' | 'events'

export type EntityType = 'habit' | 'goal' | 'entry' | 'system'

export type EventType =
  | 'habit.created'
  | 'habit.updated'
  | 'habit.reordered'
  | 'habit.archived'
  | 'habit.restored'
  | 'goal.created'
  | 'goal.updated'
  | 'goal.deleted'
  | 'entry.created'
  | 'entry.updated'
  | 'entry.deleted'
  | 'entry.restored'
  | 'conflict.resolved'
  | 'system.imported'

export interface DomainEvent<TPayload = unknown> {
  schemaVersion: typeof EVENT_SCHEMA_VERSION
  eventId: string
  entityId: string
  entityType: EntityType
  habitId?: string
  eventType: EventType
  /** Heads this event supersedes. Empty for a root; two or more for a merge. */
  parentEventIds: string[]
  deviceId: string
  /** Monotonic per device. Establishes order within one device only. */
  deviceSequence: number
  /** RFC 3339 UTC instant at which the record was written. */
  recordedAt: string
  /** RFC 3339 UTC instant at which the activity happened, when known. */
  occurredAt?: string
  /** The local date the user chose. Authoritative for grouping, forever. */
  occurredLocalDate?: LocalDate
  /** IANA zone in force when the record was made. */
  timezoneId?: TimezoneId
  payload: TPayload
}

/* ------------------------------------------------------------------ habits */

export interface HabitSnapshot {
  habitId: string
  /** For a private habit this is literally `Private`. The real name is never stored. */
  displayName: string
  trackingModel: TrackingModel
  unit: Unit
  isPrivate: boolean
  sortOrder: number
  archived: boolean
  createdLocalDate: LocalDate
  /**
   * Minimum daily aggregate that makes a day count toward a positive streak.
   * Meaningless for `negative-occurrence`, where any event resets the interval.
   */
  streakThreshold: number
  /** Verb used on the primary logging button, e.g. `Log practice`. */
  logLabel: string
}

/* ------------------------------------------------------------------- goals */

export type GoalType =
  | 'cumulative-by-deadline'
  | 'periodic-minimum'
  | 'periodic-maximum'
  | 'streak'

export type GoalMetric = 'duration-minutes' | 'completion-count' | 'occurrence-count'

export type GoalPeriod = 'day' | 'week' | 'month' | 'year'

export interface GoalSnapshot {
  goalId: string
  habitId: string
  goalType: GoalType
  metric: GoalMetric
  targetValue: number
  period?: GoalPeriod
  deadlineLocalDate?: LocalDate
  effectiveFromLocalDate: LocalDate
  effectiveToLocalDate?: LocalDate
  timezoneId: TimezoneId
  weekStartsOn: IsoWeekday
  active: boolean
}

/* ------------------------------------------------------------------ entries */

export interface EntrySnapshot {
  entryId: string
  habitId: string
  occurredAt?: string
  occurredLocalDate: LocalDate
  timezoneId: TimezoneId
  value: number
  unit: Unit
  /** Minutes after local midnight, when the user supplied a time. */
  startTime?: number
  endTime?: number
  note?: string
  /** Set when this entry was split out of another during a "keep both" merge. */
  sourceEntryId?: string
  deleted: boolean
}

/* ----------------------------------------------------------------- payloads */

export interface HabitReorderPayload {
  sortOrder: number
}

export interface ImportPayload {
  importId: string
  backupId: string
  sourceDeviceId: string
  sourceDeviceLabel: string
  newEventCount: number
  alreadyPresentCount: number
  conflictCount: number
}

export interface ConflictResolutionPayload<TSnapshot = unknown> {
  /** Which branch the user chose; `manual` means they typed a new value. */
  decision: 'keep-local' | 'use-imported' | 'manual' | 'keep-both'
  resolvedSnapshot: TSnapshot
  /** Set on the new sibling entity created by a "keep both" decision. */
  splitEntityId?: string
}

/* ------------------------------------------------------------- union sugar */

export type HabitEvent = DomainEvent<HabitSnapshot | HabitReorderPayload>
export type GoalEvent = DomainEvent<GoalSnapshot>
export type EntryEvent = DomainEvent<EntrySnapshot>

export function unitForModel(model: TrackingModel): Unit {
  switch (model) {
    case 'duration':
      return 'minutes'
    case 'completion':
      return 'sessions'
    case 'count':
      return 'count'
    case 'negative-occurrence':
      return 'events'
  }
}

export function isNegativeModel(model: TrackingModel): boolean {
  return model === 'negative-occurrence'
}

/** The label shown next to the heatmap legend, e.g. `min`. */
export function unitAbbreviation(unit: Unit): string {
  switch (unit) {
    case 'minutes':
      return 'min'
    case 'sessions':
      return 'sessions'
    case 'count':
      return 'count'
    case 'events':
      return ''
  }
}
