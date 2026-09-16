/**
 * The projection engine: fold an event log into the row shapes the screens read.
 *
 * Pure and total — given the same events it returns the same views, in any
 * insertion order. This is what makes "clear the projection tables and replay"
 * a safe repair at any time.
 */

import type {
  ConflictResolutionPayload,
  DomainEvent,
  EntrySnapshot,
  GoalSnapshot,
  HabitReorderPayload,
  HabitSnapshot,
} from './types.ts'
import { compareForReplay, computeHeads, groupByEntity, replayOrder } from './heads.ts'

/** Bump when projection logic changes; the stored projections are then rebuilt. */
export const PROJECTION_VERSION = 1

export interface ProjectedEntity<TSnapshot> {
  entityId: string
  snapshot: TSnapshot
  headEventIds: string[]
  conflicted: boolean
  /** Event that produced the displayed snapshot. */
  headEventId: string
  lastRecordedAt: string
}

export type HabitView = HabitSnapshot & {
  conflicted: boolean
  headEventIds: string[]
  lastRecordedAt: string
}

export type GoalView = GoalSnapshot & {
  conflicted: boolean
  headEventIds: string[]
  lastRecordedAt: string
}

export type EntryView = EntrySnapshot & {
  conflicted: boolean
  headEventIds: string[]
  lastRecordedAt: string
  createdAt: string
  /** Number of events in this entry's history; 1 means never edited. */
  version: number
  deviceId: string
}

export interface EntityHead {
  entityId: string
  entityType: DomainEvent['entityType']
  habitId?: string
  headEventIds: string[]
  conflicted: boolean
}

export interface ProjectionResult {
  habits: HabitView[]
  goals: GoalView[]
  entries: EntryView[]
  heads: EntityHead[]
}

function snapshotAfter(
  event: DomainEvent,
  parentSnapshots: unknown[],
): unknown {
  switch (event.eventType) {
    case 'habit.reordered': {
      const base = (parentSnapshots[0] ?? {}) as HabitSnapshot
      const patch = event.payload as HabitReorderPayload
      return { ...base, sortOrder: patch.sortOrder }
    }
    case 'conflict.resolved': {
      const payload = event.payload as ConflictResolutionPayload
      return payload.resolvedSnapshot
    }
    default:
      // Every other event carries a complete replacement snapshot.
      return event.payload
  }
}

/**
 * Resolve one entity's DAG into a displayed snapshot plus a conflict flag.
 * Returns null when the entity has no events that produce a snapshot.
 */
function projectEntity<TSnapshot>(
  entityId: string,
  events: readonly DomainEvent[],
): ProjectedEntity<TSnapshot> | null {
  const ordered = replayOrder(events)
  const resultById = new Map<string, unknown>()

  for (const event of ordered) {
    const parents = event.parentEventIds
      .map((id) => resultById.get(id))
      .filter((s): s is unknown => s !== undefined)
    resultById.set(event.eventId, snapshotAfter(event, parents))
  }

  const headEventIds = computeHeads(events)
  if (!headEventIds.length) return null

  const byId = new Map(events.map((e) => [e.eventId, e]))
  const headEvents = headEventIds
    .map((id) => byId.get(id))
    .filter((e): e is DomainEvent => e !== undefined)
    .sort(compareForReplay)

  // With several heads nothing is auto-merged. The newest head is shown only so
  // the row has something to render; `conflicted` keeps it out of every total.
  const displayed = headEvents[headEvents.length - 1]
  if (!displayed) return null
  const snapshot = resultById.get(displayed.eventId)
  if (snapshot === undefined || snapshot === null) return null

  const lastRecordedAt = ordered.reduce(
    (max, e) => (e.recordedAt > max ? e.recordedAt : max),
    ordered[0]?.recordedAt ?? displayed.recordedAt,
  )

  return {
    entityId,
    snapshot: snapshot as TSnapshot,
    headEventIds,
    conflicted: headEventIds.length > 1,
    headEventId: displayed.eventId,
    lastRecordedAt,
  }
}

export function projectEvents(events: readonly DomainEvent[]): ProjectionResult {
  const byEntity = groupByEntity(events)
  const habits: HabitView[] = []
  const goals: GoalView[] = []
  const entries: EntryView[] = []
  const heads: EntityHead[] = []

  for (const [entityId, entityEvents] of byEntity) {
    const entityType = entityEvents[0]?.entityType
    if (!entityType || entityType === 'system') continue

    const projected = projectEntity<unknown>(entityId, entityEvents)
    if (!projected) continue

    heads.push({
      entityId,
      entityType,
      habitId: entityEvents.find((e) => e.habitId)?.habitId,
      headEventIds: projected.headEventIds,
      conflicted: projected.conflicted,
    })

    const common = {
      conflicted: projected.conflicted,
      headEventIds: projected.headEventIds,
      lastRecordedAt: projected.lastRecordedAt,
    }

    if (entityType === 'habit') {
      habits.push({ ...(projected.snapshot as HabitSnapshot), ...common })
    } else if (entityType === 'goal') {
      goals.push({ ...(projected.snapshot as GoalSnapshot), ...common })
    } else {
      const ordered = replayOrder(entityEvents)
      const root = ordered[0]
      entries.push({
        ...(projected.snapshot as EntrySnapshot),
        ...common,
        createdAt: root?.recordedAt ?? projected.lastRecordedAt,
        version: entityEvents.length,
        deviceId: root?.deviceId ?? '',
      })
    }
  }

  habits.sort((a, b) => a.sortOrder - b.sortOrder || a.habitId.localeCompare(b.habitId))
  goals.sort((a, b) => a.goalId.localeCompare(b.goalId))
  heads.sort((a, b) => a.entityId.localeCompare(b.entityId))
  entries.sort(
    (a, b) =>
      (a.occurredLocalDate < b.occurredLocalDate ? 1 : a.occurredLocalDate > b.occurredLocalDate ? -1 : 0) ||
      (a.startTime ?? 0) - (b.startTime ?? 0) ||
      a.entryId.localeCompare(b.entryId),
  )

  return { habits, goals, entries, heads }
}

/** Entries that count toward totals: current, not deleted, not conflicted. */
export function countableEntries(entries: readonly EntryView[]): EntryView[] {
  return entries.filter((e) => !e.deleted && !e.conflicted)
}
