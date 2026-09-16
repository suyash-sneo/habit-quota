/**
 * Import planning.
 *
 * Nothing here mutates anything. Given the local log and an imported one it
 * produces a *description* of what a merge would do, which the Data screen shows
 * before a single row is written.
 */

import type { DomainEvent, EntrySnapshot } from '../events/types.ts'
import { canonicalize } from '../backup/format.ts'
import { normalizeEvent } from '../backup/format.ts'
import {
  commonAncestor,
  computeHeads,
  groupByEntity,
  isAncestorOf,
} from '../events/heads.ts'
import type { BackupFile } from '../backup/format.ts'

export interface SequenceGap {
  deviceId: string
  /** Sequence numbers that no event in the union carries. */
  missing: number[]
  highWaterMark: number
}

export interface ConflictHead {
  eventId: string
  origin: 'local' | 'imported' | 'both'
  recordedAt: string
  deviceId: string
  snapshot: unknown
}

export interface PlannedConflict {
  entityId: string
  entityType: DomainEvent['entityType']
  habitId?: string
  heads: ConflictHead[]
  /** The value both branches started from, when they share one. */
  ancestorSnapshot: unknown | null
  ancestorEventId: string | null
}

export interface ImportPlan {
  backupId: string
  sourceDevice: { deviceId: string; label: string }
  exportedAt: string
  formatVersion: number
  alreadyPresentCount: number
  newEventCount: number
  conflictCount: number
  missingSequenceCount: number
  sequenceGaps: SequenceGap[]
  sourceDeviceIds: string[]
  coverageBefore: { earliest: string | null; latest: string | null }
  coverageAfter: { earliest: string | null; latest: string | null }
  projectedTotalEvents: number
  /** The events that would actually be written. */
  newEvents: DomainEvent[]
  conflicts: PlannedConflict[]
}

function fingerprint(event: DomainEvent): string {
  return canonicalize(normalizeEvent(event))
}

function coverage(events: readonly DomainEvent[]): { earliest: string | null; latest: string | null } {
  let earliest: string | null = null
  let latest: string | null = null
  for (const e of events) {
    const d = e.occurredLocalDate
    if (!d) continue
    if (earliest === null || d < earliest) earliest = d
    if (latest === null || d > latest) latest = d
  }
  return { earliest, latest }
}

/**
 * Sequence numbers absent from the union, per device.
 *
 * A gap is not an error — it usually means a backup predates some events on
 * another device — but it tells the user their picture is incomplete.
 */
export function findSequenceGaps(
  events: readonly DomainEvent[],
  declaredHighWaterMarks: Readonly<Record<string, number>> = {},
): SequenceGap[] {
  const byDevice = new Map<string, Set<number>>()
  for (const event of events) {
    let seen = byDevice.get(event.deviceId)
    if (!seen) {
      seen = new Set()
      byDevice.set(event.deviceId, seen)
    }
    seen.add(event.deviceSequence)
  }
  for (const deviceId of Object.keys(declaredHighWaterMarks)) {
    if (!byDevice.has(deviceId)) byDevice.set(deviceId, new Set())
  }

  const gaps: SequenceGap[] = []
  for (const [deviceId, seen] of byDevice) {
    const observedMax = seen.size ? Math.max(...seen) : 0
    const highWaterMark = Math.max(observedMax, declaredHighWaterMarks[deviceId] ?? 0)
    if (highWaterMark <= 0) continue
    const missing: number[] = []
    for (let n = 1; n <= highWaterMark; n += 1) {
      if (!seen.has(n)) missing.push(n)
      // A pathological file should not produce a million-entry array.
      if (missing.length >= 500) break
    }
    if (missing.length) gaps.push({ deviceId, missing, highWaterMark })
  }
  return gaps
}

export class DuplicateEventMismatchError extends Error {
  constructor(readonly eventId: string) {
    super(
      'The file contains an event that already exists here with different contents. ' +
        'It will not be merged.',
    )
    this.name = 'DuplicateEventMismatchError'
  }
}

/**
 * Compare local and imported logs.
 *
 * @throws {DuplicateEventMismatchError} when an imported event reuses a local
 * event id with different content — the one case where we refuse outright,
 * because either file may be corrupt and guessing would destroy history.
 */
export function planImport(
  localEvents: readonly DomainEvent[],
  backup: BackupFile,
): ImportPlan {
  const localById = new Map<string, DomainEvent>()
  for (const event of localEvents) localById.set(event.eventId, event)

  const newEvents: DomainEvent[] = []
  let alreadyPresentCount = 0

  for (const imported of backup.events) {
    const local = localById.get(imported.eventId)
    if (!local) {
      newEvents.push(imported)
      continue
    }
    if (fingerprint(local) !== fingerprint(imported)) {
      throw new DuplicateEventMismatchError(imported.eventId)
    }
    alreadyPresentCount += 1
  }

  const union = [...localEvents, ...newEvents]
  const conflicts = findConflicts(localEvents, newEvents, union)
  const sequenceGaps = findSequenceGaps(union, backup.highWaterMarks)

  return {
    backupId: backup.backupId,
    sourceDevice: backup.sourceDevice,
    exportedAt: backup.exportedAt,
    formatVersion: backup.formatVersion,
    alreadyPresentCount,
    newEventCount: newEvents.length,
    conflictCount: conflicts.length,
    missingSequenceCount: sequenceGaps.reduce((n, g) => n + g.missing.length, 0),
    sequenceGaps,
    sourceDeviceIds: [...new Set(backup.events.map((e) => e.deviceId))],
    coverageBefore: coverage(localEvents),
    coverageAfter: coverage(union),
    projectedTotalEvents: union.length,
    newEvents,
    conflicts,
  }
}

/**
 * Entities whose heads diverge after the union.
 *
 * An entity is *not* conflicted when one head descends from all the others —
 * that is just a newer edit arriving — only when two branches genuinely split.
 */
function findConflicts(
  localEvents: readonly DomainEvent[],
  newEvents: readonly DomainEvent[],
  union: readonly DomainEvent[],
): PlannedConflict[] {
  const localIds = new Set(localEvents.map((e) => e.eventId))
  const importedIds = new Set(newEvents.map((e) => e.eventId))
  const touchedEntities = new Set(newEvents.map((e) => e.entityId))
  const byEntity = groupByEntity(union)
  const out: PlannedConflict[] = []

  for (const entityId of touchedEntities) {
    const events = byEntity.get(entityId)
    if (!events || !events.length) continue
    const headIds = computeHeads(events)
    if (headIds.length < 2) continue

    // One head descending from all others resolves itself.
    const dominant = headIds.find((candidate) =>
      headIds.every((other) => other === candidate || isAncestorOf(other, candidate, events)),
    )
    if (dominant) continue

    const byId = new Map(events.map((e) => [e.eventId, e]))
    const ancestor = commonAncestor(headIds, events)
    const projectedSnapshots = snapshotsByEventId(events)

    out.push({
      entityId,
      entityType: events[0]?.entityType ?? 'entry',
      habitId: events.find((e) => e.habitId)?.habitId,
      heads: headIds.map((id) => {
        const event = byId.get(id) as DomainEvent
        return {
          eventId: id,
          origin: localIds.has(id) && importedIds.has(id) ? 'both' : localIds.has(id) ? 'local' : 'imported',
          recordedAt: event.recordedAt,
          deviceId: event.deviceId,
          snapshot: projectedSnapshots.get(id) ?? event.payload,
        } satisfies ConflictHead
      }),
      ancestorSnapshot: ancestor ? (projectedSnapshots.get(ancestor.eventId) ?? null) : null,
      ancestorEventId: ancestor?.eventId ?? null,
    })
  }

  return out.sort((a, b) => a.entityId.localeCompare(b.entityId))
}

/**
 * Snapshot each event in an entity's history resolves to. Mirrors the
 * projection rules so the conflict screen shows the same values the app does.
 */
function snapshotsByEventId(events: readonly DomainEvent[]): Map<string, unknown> {
  const out = new Map<string, unknown>()
  for (const event of events) {
    if (event.eventType === 'conflict.resolved') {
      out.set(event.eventId, (event.payload as { resolvedSnapshot: unknown }).resolvedSnapshot)
    } else if (event.eventType === 'habit.reordered') {
      const parentSnapshot = event.parentEventIds
        .map((id) => out.get(id))
        .find((s) => s !== undefined)
      out.set(event.eventId, {
        ...(parentSnapshot as object | undefined),
        ...(event.payload as object),
      })
    } else {
      out.set(event.eventId, event.payload)
    }
  }
  return out
}

/** Fields that differ between two entry branches, for the comparison view. */
export function diffEntrySnapshots(
  a: EntrySnapshot | null,
  b: EntrySnapshot | null,
): Array<{ field: keyof EntrySnapshot; from: unknown; to: unknown }> {
  if (!a || !b) return []
  const fields: (keyof EntrySnapshot)[] = [
    'value',
    'unit',
    'occurredLocalDate',
    'startTime',
    'endTime',
    'note',
    'deleted',
  ]
  return fields
    .filter((f) => canonicalize(a[f] ?? null) !== canonicalize(b[f] ?? null))
    .map((f) => ({ field: f, from: a[f], to: b[f] }))
}
