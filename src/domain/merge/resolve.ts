/**
 * Turning a person's conflict decision into events.
 *
 * Every decision is additive. The branch that "lost" keeps every one of its
 * events; the resolution simply becomes the new single head by naming all the
 * old heads as its parents, exactly like a merge commit.
 */

import type {
  ConflictResolutionPayload,
  DomainEvent,
  EntrySnapshot,
} from '../events/types.ts'
import { EVENT_SCHEMA_VERSION } from '../events/types.ts'
import { newId } from '../events/ids.ts'
import type { PlannedConflict } from './plan.ts'

export type ConflictDecision =
  | { kind: 'keep-local' }
  | { kind: 'use-imported' }
  | { kind: 'manual'; snapshot: unknown }
  /** Only meaningful for entries: both branches describe real, separate sessions. */
  | { kind: 'keep-both' }

/**
 * An event with its per-device bookkeeping still unfilled.
 *
 * `deviceId`, `deviceSequence` and `recordedAt` are assigned by the write
 * transaction, so a resolution built here cannot consume a sequence number that
 * a failed commit would then leak.
 */
export type PendingEvent<TPayload = unknown> = Omit<
  DomainEvent<TPayload>,
  'deviceId' | 'deviceSequence' | 'recordedAt'
>

export interface ResolutionEvents {
  /** The merge event that collapses the heads back to one. */
  resolution: PendingEvent<ConflictResolutionPayload>
  /** For "keep both": a brand-new entity carrying the other branch's snapshot. */
  split?: PendingEvent<EntrySnapshot>
}

function headByOrigin(conflict: PlannedConflict, origin: 'local' | 'imported'): unknown {
  const exact = conflict.heads.find((h) => h.origin === origin)
  if (exact) return exact.snapshot
  // A head present in both logs satisfies either side of the question.
  const shared = conflict.heads.find((h) => h.origin === 'both')
  return shared?.snapshot ?? conflict.heads[0]?.snapshot ?? null
}

export function buildResolution(
  conflict: PlannedConflict,
  decision: ConflictDecision,
): ResolutionEvents {
  const parentEventIds = conflict.heads.map((h) => h.eventId)
  const localSnapshot = headByOrigin(conflict, 'local')
  const importedSnapshot = headByOrigin(conflict, 'imported')

  let resolvedSnapshot: unknown
  let splitEvent: PendingEvent<EntrySnapshot> | undefined

  switch (decision.kind) {
    case 'keep-local':
      resolvedSnapshot = localSnapshot
      break
    case 'use-imported':
      resolvedSnapshot = importedSnapshot
      break
    case 'manual':
      resolvedSnapshot = decision.snapshot
      break
    case 'keep-both': {
      if (conflict.entityType !== 'entry') {
        throw new Error('“Keep both” only applies to entries.')
      }
      resolvedSnapshot = localSnapshot
      const other = importedSnapshot as EntrySnapshot
      const splitEntityId = newId()
      const splitSnapshot: EntrySnapshot = {
        ...other,
        entryId: splitEntityId,
        // Points at the entity this session was separated out of, for the audit trail.
        sourceEntryId: conflict.entityId,
      }
      splitEvent = {
        schemaVersion: EVENT_SCHEMA_VERSION,
        eventId: newId(),
        entityId: splitEntityId,
        entityType: 'entry',
        habitId: other.habitId,
        eventType: 'entry.created',
        parentEventIds: [],
        occurredAt: other.occurredAt,
        occurredLocalDate: other.occurredLocalDate,
        timezoneId: other.timezoneId,
        payload: splitSnapshot,
      }
      break
    }
  }

  const payload: ConflictResolutionPayload = {
    decision: decision.kind,
    resolvedSnapshot,
    splitEntityId: splitEvent?.entityId,
  }

  const snapshotDates = resolvedSnapshot as Partial<EntrySnapshot> | null

  const resolution: PendingEvent<ConflictResolutionPayload> = {
    schemaVersion: EVENT_SCHEMA_VERSION,
    eventId: newId(),
    entityId: conflict.entityId,
    entityType: conflict.entityType,
    habitId: conflict.habitId,
    eventType: 'conflict.resolved',
    parentEventIds,
    occurredAt: snapshotDates?.occurredAt,
    occurredLocalDate: snapshotDates?.occurredLocalDate,
    timezoneId: snapshotDates?.timezoneId,
    payload,
  }

  return splitEvent ? { resolution, split: splitEvent } : { resolution }
}

/** Human summary of what a decision will produce, shown before it is applied. */
export function describeDecision(
  conflict: PlannedConflict,
  decision: ConflictDecision,
  format: (snapshot: unknown) => string,
): string {
  switch (decision.kind) {
    case 'keep-local':
      return `Keeps ${format(headByOrigin(conflict, 'local'))}.`
    case 'use-imported':
      return `Replaces the local value with ${format(headByOrigin(conflict, 'imported'))}.`
    case 'manual':
      return `Records ${format(decision.snapshot)} as a new merged value.`
    case 'keep-both':
      return `Keeps ${format(headByOrigin(conflict, 'local'))} and adds ${format(
        headByOrigin(conflict, 'imported'),
      )} as a separate entry.`
  }
}
