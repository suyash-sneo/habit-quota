/**
 * Goals. Editing a goal never rewrites history: the previous definition stays
 * in the event log, and new calculations use the new one from today onward.
 */

import { appendEvents, db } from '../database.ts'
import { parentsForEdit } from './common.ts'
import { newId } from '../../domain/events/ids.ts'
import { EVENT_SCHEMA_VERSION } from '../../domain/events/types.ts'
import type { GoalSnapshot } from '../../domain/events/types.ts'
import type { GoalViewRow } from '../schema.ts'
import type { LocalDate } from '../../domain/time/civil.ts'

export type NewGoalInput = Omit<GoalSnapshot, 'goalId' | 'active'> & { goalId?: string }

export async function listGoals(habitId: string, activeOnly = true): Promise<GoalViewRow[]> {
  const rows = await db().goalViews.where('habitId').equals(habitId).toArray()
  return activeOnly ? rows.filter((g) => g.active) : rows
}

export async function listAllGoals(): Promise<GoalViewRow[]> {
  return db().goalViews.toArray()
}

export async function createGoal(input: NewGoalInput): Promise<GoalSnapshot> {
  const snapshot: GoalSnapshot = { ...input, goalId: input.goalId ?? newId(), active: true }
  await appendEvents([
    {
      schemaVersion: EVENT_SCHEMA_VERSION,
      eventId: newId(),
      entityId: snapshot.goalId,
      entityType: 'goal',
      habitId: snapshot.habitId,
      eventType: 'goal.created',
      parentEventIds: [],
      occurredLocalDate: snapshot.effectiveFromLocalDate,
      timezoneId: snapshot.timezoneId,
      payload: snapshot,
    },
  ])
  return snapshot
}

function bareSnapshot(row: GoalViewRow): GoalSnapshot {
  const { conflicted: _c, headEventIds: _h, lastRecordedAt: _l, activeFlag: _a, ...snapshot } = row
  void _c
  void _h
  void _l
  void _a
  return snapshot
}

export async function updateGoal(
  goalId: string,
  patch: Partial<Omit<GoalSnapshot, 'goalId' | 'habitId'>>,
): Promise<GoalSnapshot> {
  const current = await db().goalViews.get(goalId)
  if (!current) throw new Error('That goal no longer exists.')
  const parentEventIds = await parentsForEdit(goalId)
  const next: GoalSnapshot = { ...bareSnapshot(current), ...patch }

  await appendEvents([
    {
      schemaVersion: EVENT_SCHEMA_VERSION,
      eventId: newId(),
      entityId: goalId,
      entityType: 'goal',
      habitId: next.habitId,
      eventType: 'goal.updated',
      parentEventIds,
      occurredLocalDate: next.effectiveFromLocalDate,
      timezoneId: next.timezoneId,
      payload: next,
    },
  ])
  return next
}

/**
 * Retire a goal as of a local date. The row stays so past weeks still explain
 * what the target was at the time.
 */
export async function deleteGoal(goalId: string, effectiveToLocalDate: LocalDate): Promise<void> {
  const current = await db().goalViews.get(goalId)
  if (!current) return
  const parentEventIds = await parentsForEdit(goalId)
  const next: GoalSnapshot = {
    ...bareSnapshot(current),
    active: false,
    effectiveToLocalDate,
  }

  await appendEvents([
    {
      schemaVersion: EVENT_SCHEMA_VERSION,
      eventId: newId(),
      entityId: goalId,
      entityType: 'goal',
      habitId: next.habitId,
      eventType: 'goal.deleted',
      parentEventIds,
      occurredLocalDate: effectiveToLocalDate,
      timezoneId: next.timezoneId,
      payload: next,
    },
  ])
}
