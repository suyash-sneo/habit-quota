/**
 * Entries: create, edit, delete and restore.
 *
 * Editing appends a new event naming the current head as its parent. Deleting
 * appends a tombstone. Nothing is ever removed, so Undo is just another event.
 */

import { appendEvents, db } from '../database.ts'
import { parentsForEdit } from './common.ts'
import { newId } from '../../domain/events/ids.ts'
import { EVENT_SCHEMA_VERSION } from '../../domain/events/types.ts'
import type { EntrySnapshot, Unit } from '../../domain/events/types.ts'
import type { EntryViewRow } from '../schema.ts'
import type { LocalDate } from '../../domain/time/civil.ts'
import type { MinuteOfDay, TimezoneId } from '../../domain/time/zone.ts'
import { isoFromWallClock } from '../../domain/time/zone.ts'

export interface EntryInput {
  habitId: string
  occurredLocalDate: LocalDate
  timezoneId: TimezoneId
  value: number
  unit: Unit
  startTime?: MinuteOfDay
  endTime?: MinuteOfDay
  note?: string
}

function toSnapshot(entryId: string, input: EntryInput, deleted: boolean): EntrySnapshot {
  const snapshot: EntrySnapshot = {
    entryId,
    habitId: input.habitId,
    occurredLocalDate: input.occurredLocalDate,
    timezoneId: input.timezoneId,
    value: input.unit === 'minutes' ? Math.round(input.value) : input.value,
    unit: input.unit,
    deleted,
  }
  if (input.startTime !== undefined) {
    snapshot.startTime = input.startTime
    // The exact instant is derived once, in the zone in force at entry time, and
    // then frozen. It is never recomputed from a later device timezone.
    snapshot.occurredAt = isoFromWallClock(
      input.occurredLocalDate,
      input.startTime,
      input.timezoneId,
    )
  }
  if (input.endTime !== undefined) snapshot.endTime = input.endTime
  const note = input.note?.trim()
  if (note) snapshot.note = note
  return snapshot
}

export async function listEntriesForHabit(
  habitId: string,
  options: { from?: LocalDate; to?: LocalDate; includeDeleted?: boolean } = {},
): Promise<EntryViewRow[]> {
  const from = options.from ?? '0000-01-01'
  const to = options.to ?? '9999-12-31'
  const rows = await db()
    .entryViews.where('[habitId+occurredLocalDate]')
    .between([habitId, from], [habitId, to], true, true)
    .toArray()
  return options.includeDeleted ? rows : rows.filter((r) => !r.deleted)
}

export async function getEntry(entryId: string): Promise<EntryViewRow | undefined> {
  return db().entryViews.get(entryId)
}

export async function createEntry(input: EntryInput): Promise<EntrySnapshot> {
  const snapshot = toSnapshot(newId(), input, false)
  await appendEvents([
    {
      schemaVersion: EVENT_SCHEMA_VERSION,
      eventId: newId(),
      entityId: snapshot.entryId,
      entityType: 'entry',
      habitId: snapshot.habitId,
      eventType: 'entry.created',
      parentEventIds: [],
      occurredAt: snapshot.occurredAt,
      occurredLocalDate: snapshot.occurredLocalDate,
      timezoneId: snapshot.timezoneId,
      payload: snapshot,
    },
  ])
  return snapshot
}

/**
 * A patch distinguishes "leave this alone" from "remove this".
 *
 * `undefined` keeps whatever the entry already has, so a caller that does not
 * mention a field cannot disturb it. `null` clears the field — without that
 * there is no way to take back a time once one has been recorded, because the
 * absent value and the unmentioned value would look identical.
 */
export interface EntryPatch extends Partial<Omit<EntryInput, 'startTime' | 'endTime'>> {
  startTime?: MinuteOfDay | null
  endTime?: MinuteOfDay | null
}

function patched<T>(next: T | null | undefined, current: T | undefined): T | undefined {
  if (next === undefined) return current
  return next ?? undefined
}

export async function updateEntry(
  entryId: string,
  patch: EntryPatch,
): Promise<EntrySnapshot> {
  const current = await db().entryViews.get(entryId)
  if (!current) throw new Error('That entry no longer exists.')
  const parentEventIds = await parentsForEdit(entryId)

  const merged: EntryInput = {
    habitId: current.habitId,
    occurredLocalDate: patch.occurredLocalDate ?? current.occurredLocalDate,
    timezoneId: patch.timezoneId ?? current.timezoneId,
    value: patch.value ?? current.value,
    unit: patch.unit ?? current.unit,
    startTime: patched(patch.startTime, current.startTime),
    endTime: patched(patch.endTime, current.endTime),
    note: patch.note !== undefined ? patch.note : current.note,
  }
  const next = toSnapshot(entryId, merged, false)
  if (current.sourceEntryId) next.sourceEntryId = current.sourceEntryId

  await appendEvents([
    {
      schemaVersion: EVENT_SCHEMA_VERSION,
      eventId: newId(),
      entityId: entryId,
      entityType: 'entry',
      habitId: next.habitId,
      eventType: 'entry.updated',
      parentEventIds,
      occurredAt: next.occurredAt,
      occurredLocalDate: next.occurredLocalDate,
      timezoneId: next.timezoneId,
      payload: next,
    },
  ])
  return next
}

async function tombstoneEvent(
  entryId: string,
  eventType: 'entry.deleted' | 'entry.restored',
  deleted: boolean,
): Promise<void> {
  const current = await db().entryViews.get(entryId)
  if (!current) throw new Error('That entry no longer exists.')
  const parentEventIds = await parentsForEdit(entryId)

  const {
    conflicted: _c,
    headEventIds: _h,
    lastRecordedAt: _l,
    createdAt: _ca,
    version: _v,
    deviceId: _d,
    deletedFlag: _df,
    ...snapshot
  } = current
  void _c
  void _h
  void _l
  void _ca
  void _v
  void _d
  void _df

  const next: EntrySnapshot = { ...snapshot, deleted }

  await appendEvents([
    {
      schemaVersion: EVENT_SCHEMA_VERSION,
      eventId: newId(),
      entityId: entryId,
      entityType: 'entry',
      habitId: next.habitId,
      eventType,
      parentEventIds,
      occurredAt: next.occurredAt,
      occurredLocalDate: next.occurredLocalDate,
      timezoneId: next.timezoneId,
      payload: next,
    },
  ])
}

export async function deleteEntry(entryId: string): Promise<void> {
  await tombstoneEvent(entryId, 'entry.deleted', true)
}

export async function restoreEntry(entryId: string): Promise<void> {
  await tombstoneEvent(entryId, 'entry.restored', false)
}
