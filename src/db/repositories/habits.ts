/**
 * Habit lifecycle. Each function turns intent into one immutable event; the
 * projection tables follow automatically inside the same transaction.
 */

import { appendEvents, db } from '../database.ts'
import type { DraftEvent } from '../database.ts'
import { parentsForEdit } from './common.ts'
import { newId } from '../../domain/events/ids.ts'
import { EVENT_SCHEMA_VERSION, unitForModel } from '../../domain/events/types.ts'
import type { HabitSnapshot, TrackingModel } from '../../domain/events/types.ts'
import type { HabitViewRow } from '../schema.ts'
import type { LocalDate } from '../../domain/time/civil.ts'

export const PRIVATE_DISPLAY_NAME = 'Private'

export interface CreateHabitInput {
  displayName: string
  trackingModel: TrackingModel
  isPrivate: boolean
  streakThreshold: number
  createdLocalDate: LocalDate
  timezoneId: string
  logLabel?: string
}

/**
 * Default verb for the primary button, derived from the habit name.
 *
 * The activity is the *last* word, not the first: "Violin practice" becomes
 * "Log practice" and "MARL study" becomes "Log study". An all-caps word is an
 * acronym and keeps its capitals, so a habit simply called "MARL" reads
 * "Log MARL" rather than "Log marl".
 *
 * A private habit never contributes its words: the label is always the neutral
 * "Log event".
 */
export function defaultLogLabel(input: {
  displayName: string
  trackingModel: TrackingModel
  isPrivate: boolean
}): string {
  if (input.isPrivate || input.trackingModel === 'negative-occurrence') return 'Log event'
  const words = input.displayName.trim().split(/\s+/).filter(Boolean)
  const activity = words[words.length - 1]
  if (!activity) return 'Log entry'
  const isAcronym = activity.length > 1 && activity === activity.toUpperCase()
  return `Log ${(isAcronym ? activity : activity.toLowerCase()).slice(0, 24)}`
}

export async function listHabits(includeArchived = false): Promise<HabitViewRow[]> {
  const rows = await db().habitViews.orderBy('sortOrder').toArray()
  return includeArchived ? rows : rows.filter((h) => !h.archived)
}

export async function getHabit(habitId: string): Promise<HabitViewRow | undefined> {
  return db().habitViews.get(habitId)
}

export async function createHabit(input: CreateHabitInput): Promise<HabitSnapshot> {
  const existing = await db().habitViews.toArray()
  const sortOrder = existing.reduce((max, h) => Math.max(max, h.sortOrder), -1) + 1

  const snapshot: HabitSnapshot = {
    habitId: newId(),
    // The real name of a private habit is never stored anywhere.
    displayName: input.isPrivate ? PRIVATE_DISPLAY_NAME : input.displayName.trim(),
    trackingModel: input.trackingModel,
    unit: unitForModel(input.trackingModel),
    isPrivate: input.isPrivate,
    sortOrder,
    archived: false,
    createdLocalDate: input.createdLocalDate,
    streakThreshold: Math.max(1, Math.round(input.streakThreshold)),
    logLabel: input.logLabel ?? defaultLogLabel(input),
  }

  await appendEvents([
    {
      schemaVersion: EVENT_SCHEMA_VERSION,
      eventId: newId(),
      entityId: snapshot.habitId,
      entityType: 'habit',
      habitId: snapshot.habitId,
      eventType: 'habit.created',
      parentEventIds: [],
      occurredLocalDate: input.createdLocalDate,
      timezoneId: input.timezoneId,
      payload: snapshot,
    },
  ])

  return snapshot
}

async function habitEvent(
  habitId: string,
  eventType: DraftEvent['eventType'],
  mutate: (current: HabitSnapshot) => HabitSnapshot,
  timezoneId: string,
): Promise<HabitSnapshot> {
  const current = await db().habitViews.get(habitId)
  if (!current) throw new Error('That habit no longer exists.')
  const parentEventIds = await parentsForEdit(habitId)

  const {
    conflicted: _c,
    headEventIds: _h,
    lastRecordedAt: _l,
    archivedFlag: _a,
    ...snapshot
  } = current
  void _c
  void _h
  void _l
  void _a

  const next = mutate(snapshot)
  await appendEvents([
    {
      schemaVersion: EVENT_SCHEMA_VERSION,
      eventId: newId(),
      entityId: habitId,
      entityType: 'habit',
      habitId,
      eventType,
      parentEventIds,
      timezoneId,
      payload: next,
    },
  ])
  return next
}

export interface UpdateHabitInput {
  displayName?: string
  streakThreshold?: number
  logLabel?: string
  /**
   * Changing the model never rewrites existing entries; old events keep their
   * own unit and are still shown in the timeline.
   */
  trackingModel?: TrackingModel
}

export async function updateHabit(
  habitId: string,
  patch: UpdateHabitInput,
  timezoneId: string,
): Promise<HabitSnapshot> {
  return habitEvent(
    habitId,
    'habit.updated',
    (current) => ({
      ...current,
      displayName: current.isPrivate
        ? PRIVATE_DISPLAY_NAME
        : (patch.displayName?.trim() ?? current.displayName),
      streakThreshold:
        patch.streakThreshold === undefined
          ? current.streakThreshold
          : Math.max(1, Math.round(patch.streakThreshold)),
      logLabel: patch.logLabel ?? current.logLabel,
      trackingModel: patch.trackingModel ?? current.trackingModel,
      unit: patch.trackingModel ? unitForModel(patch.trackingModel) : current.unit,
    }),
    timezoneId,
  )
}

export async function archiveHabit(habitId: string, timezoneId: string): Promise<void> {
  await habitEvent(habitId, 'habit.archived', (c) => ({ ...c, archived: true }), timezoneId)
}

export async function restoreHabit(habitId: string, timezoneId: string): Promise<void> {
  await habitEvent(habitId, 'habit.restored', (c) => ({ ...c, archived: false }), timezoneId)
}

/**
 * Move a habit one place in the dropdown order.
 *
 * Both affected habits get a `habit.reordered` event, so the order is itself
 * part of the auditable history rather than device-local state.
 */
export async function moveHabit(
  habitId: string,
  direction: -1 | 1,
  timezoneId: string,
): Promise<void> {
  const ordered = (await db().habitViews.orderBy('sortOrder').toArray()).sort(
    (a, b) => a.sortOrder - b.sortOrder,
  )
  const index = ordered.findIndex((h) => h.habitId === habitId)
  const targetIndex = index + direction
  if (index < 0 || targetIndex < 0 || targetIndex >= ordered.length) return

  const a = ordered[index] as HabitViewRow
  const b = ordered[targetIndex] as HabitViewRow

  const drafts: DraftEvent[] = await Promise.all(
    [
      { habit: a, sortOrder: b.sortOrder },
      { habit: b, sortOrder: a.sortOrder },
    ].map(async ({ habit, sortOrder }) => ({
      schemaVersion: EVENT_SCHEMA_VERSION,
      eventId: newId(),
      entityId: habit.habitId,
      entityType: 'habit' as const,
      habitId: habit.habitId,
      eventType: 'habit.reordered' as const,
      parentEventIds: await parentsForEdit(habit.habitId),
      timezoneId,
      payload: { sortOrder },
    })),
  )

  await appendEvents(drafts)
}
