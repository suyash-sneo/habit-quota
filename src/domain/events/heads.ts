/**
 * Head and ancestry calculation over the event DAG.
 *
 * An entity's history is a directed acyclic graph: each event names the heads it
 * supersedes. One head means the entity is resolved; several mean two devices
 * edited it independently and a person has to choose.
 */

import type { DomainEvent } from './types.ts'

/**
 * Event IDs that nothing supersedes.
 *
 * Parent references to events we do not hold (a partial import, say) are
 * ignored: they cannot make a local event non-head.
 */
export function computeHeads(events: readonly DomainEvent[]): string[] {
  const present = new Set(events.map((e) => e.eventId))
  const superseded = new Set<string>()
  for (const event of events) {
    for (const parent of event.parentEventIds) {
      if (present.has(parent)) superseded.add(parent)
    }
  }
  return events.map((e) => e.eventId).filter((id) => !superseded.has(id))
}

export interface EntityHistory {
  entityId: string
  events: DomainEvent[]
  headIds: string[]
  heads: DomainEvent[]
  conflicted: boolean
}

export function groupByEntity(events: readonly DomainEvent[]): Map<string, DomainEvent[]> {
  const byEntity = new Map<string, DomainEvent[]>()
  for (const event of events) {
    const list = byEntity.get(event.entityId)
    if (list) list.push(event)
    else byEntity.set(event.entityId, [event])
  }
  return byEntity
}

export function entityHistory(entityId: string, events: readonly DomainEvent[]): EntityHistory {
  const headIds = computeHeads(events)
  const byId = new Map(events.map((e) => [e.eventId, e]))
  const heads = headIds.map((id) => byId.get(id)).filter((e): e is DomainEvent => e !== undefined)
  return { entityId, events: [...events], headIds, heads, conflicted: headIds.length > 1 }
}

/** True when `candidate` is reachable from `from` by walking parent links. */
export function isAncestorOf(
  candidateId: string,
  fromId: string,
  events: readonly DomainEvent[],
): boolean {
  if (candidateId === fromId) return false
  const byId = new Map(events.map((e) => [e.eventId, e]))
  const seen = new Set<string>()
  const stack = [fromId]
  while (stack.length) {
    const id = stack.pop() as string
    if (seen.has(id)) continue
    seen.add(id)
    const event = byId.get(id)
    if (!event) continue
    for (const parent of event.parentEventIds) {
      if (parent === candidateId) return true
      if (!seen.has(parent)) stack.push(parent)
    }
  }
  return false
}

/** Every ancestor of `fromId`, nearest first is not guaranteed — the set is unordered. */
export function ancestorsOf(fromId: string, events: readonly DomainEvent[]): Set<string> {
  const byId = new Map(events.map((e) => [e.eventId, e]))
  const out = new Set<string>()
  const stack = [fromId]
  while (stack.length) {
    const id = stack.pop() as string
    const event = byId.get(id)
    if (!event) continue
    for (const parent of event.parentEventIds) {
      if (out.has(parent)) continue
      out.add(parent)
      stack.push(parent)
    }
  }
  return out
}

/**
 * The nearest event that is an ancestor of every head — the "before both edits"
 * value shown in the conflict comparison. Null when the heads share no ancestor.
 */
export function commonAncestor(
  headIds: readonly string[],
  events: readonly DomainEvent[],
): DomainEvent | null {
  if (headIds.length < 2) return null
  const byId = new Map(events.map((e) => [e.eventId, e]))
  const sets = headIds.map((id) => ancestorsOf(id, events))
  const [first, ...rest] = sets
  if (!first) return null
  const shared = [...first].filter((id) => rest.every((s) => s.has(id)))
  if (!shared.length) return null
  // Deepest shared ancestor: the one no other shared ancestor descends from.
  const sharedSet = new Set(shared)
  for (const id of shared) {
    const dominated = shared.some((other) => other !== id && ancestorsOf(other, events).has(id))
    if (dominated) sharedSet.delete(id)
  }
  const best = [...sharedSet]
    .map((id) => byId.get(id))
    .filter((e): e is DomainEvent => e !== undefined)
    .sort(compareForReplay)
    .pop()
  return best ?? null
}

/**
 * Deterministic replay order for independent events. Never used to pick a
 * conflict winner — only to make rebuilds and displays reproducible.
 */
export function compareForReplay(a: DomainEvent, b: DomainEvent): number {
  if (a.recordedAt !== b.recordedAt) return a.recordedAt < b.recordedAt ? -1 : 1
  if (a.deviceId !== b.deviceId) return a.deviceId < b.deviceId ? -1 : 1
  if (a.deviceSequence !== b.deviceSequence) return a.deviceSequence - b.deviceSequence
  return a.eventId < b.eventId ? -1 : a.eventId > b.eventId ? 1 : 0
}

/**
 * Topological order that satisfies parent dependencies first and breaks ties
 * with {@link compareForReplay}. Events whose parents are missing are treated as
 * roots so a partial log still replays.
 */
export function replayOrder(events: readonly DomainEvent[]): DomainEvent[] {
  const present = new Set(events.map((e) => e.eventId))
  const remainingParents = new Map<string, Set<string>>()
  const children = new Map<string, string[]>()
  const byId = new Map<string, DomainEvent>()

  for (const event of events) {
    byId.set(event.eventId, event)
    const parents = new Set(event.parentEventIds.filter((p) => present.has(p)))
    remainingParents.set(event.eventId, parents)
    for (const parent of parents) {
      const list = children.get(parent)
      if (list) list.push(event.eventId)
      else children.set(parent, [event.eventId])
    }
  }

  const ready = events
    .filter((e) => (remainingParents.get(e.eventId) as Set<string>).size === 0)
    .sort(compareForReplay)

  const out: DomainEvent[] = []
  while (ready.length) {
    const next = ready.shift() as DomainEvent
    out.push(next)
    for (const childId of children.get(next.eventId) ?? []) {
      const parents = remainingParents.get(childId)
      if (!parents) continue
      parents.delete(next.eventId)
      if (parents.size === 0) {
        const child = byId.get(childId)
        if (child) insertSorted(ready, child)
      }
    }
  }

  if (out.length !== events.length) {
    // A cycle should be impossible — parents always predate their child — but a
    // corrupted import must not silently drop events from a rebuild.
    const emitted = new Set(out.map((e) => e.eventId))
    out.push(...events.filter((e) => !emitted.has(e.eventId)).sort(compareForReplay))
  }
  return out
}

function insertSorted(list: DomainEvent[], event: DomainEvent): void {
  let low = 0
  let high = list.length
  while (low < high) {
    const mid = (low + high) >> 1
    if (compareForReplay(list[mid] as DomainEvent, event) <= 0) low = mid + 1
    else high = mid
  }
  list.splice(low, 0, event)
}
