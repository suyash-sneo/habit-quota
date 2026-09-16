import { beforeEach, describe, expect, it } from 'vitest'
import { commonAncestor, computeHeads, isAncestorOf, replayOrder } from './heads.ts'
import { countableEntries, projectEvents } from './project.ts'
import { validateDomainEvent } from './schema.ts'
import type { ConflictResolutionPayload, DomainEvent } from './types.ts'
import { EVENT_SCHEMA_VERSION } from './types.ts'
import {
  DEVICE_A,
  DEVICE_B,
  entryEvent,
  entrySnapshot,
  habitEvent,
  habitSnapshot,
  resetTestIds,
  testId,
} from '../../test/fixtures/events.ts'

beforeEach(resetTestIds)

describe('head calculation', () => {
  it('returns the single head of a linear history', () => {
    const snapshot = entrySnapshot()
    const created = entryEvent('entry.created', snapshot, { eventId: 'e1' })
    const edited = entryEvent('entry.updated', { ...snapshot, value: 30 }, {
      eventId: 'e2',
      parents: ['e1'],
    })
    expect(computeHeads([created, edited])).toEqual(['e2'])
  })

  it('returns two heads when devices diverge', () => {
    const snapshot = entrySnapshot()
    const created = entryEvent('entry.created', snapshot, { eventId: 'e1' })
    const local = entryEvent('entry.updated', { ...snapshot, value: 30 }, {
      eventId: 'e2',
      parents: ['e1'],
    })
    const imported = entryEvent('entry.updated', { ...snapshot, value: 35 }, {
      eventId: 'e3',
      parents: ['e1'],
      deviceId: DEVICE_B,
    })
    expect(computeHeads([created, local, imported]).sort()).toEqual(['e2', 'e3'])
  })

  it('ignores parents it does not hold, so a partial log still has heads', () => {
    const orphan = entryEvent('entry.updated', entrySnapshot(), {
      eventId: 'e9',
      parents: ['missing'],
    })
    expect(computeHeads([orphan])).toEqual(['e9'])
  })

  it('walks ancestry', () => {
    const snapshot = entrySnapshot()
    const a = entryEvent('entry.created', snapshot, { eventId: 'a' })
    const b = entryEvent('entry.updated', snapshot, { eventId: 'b', parents: ['a'] })
    const c = entryEvent('entry.updated', snapshot, { eventId: 'c', parents: ['b'] })
    const events = [a, b, c]
    expect(isAncestorOf('a', 'c', events)).toBe(true)
    expect(isAncestorOf('c', 'a', events)).toBe(false)
    expect(isAncestorOf('a', 'a', events)).toBe(false)
  })

  it('finds the deepest shared ancestor of two branches', () => {
    const snapshot = entrySnapshot()
    const root = entryEvent('entry.created', snapshot, { eventId: 'root' })
    const shared = entryEvent('entry.updated', snapshot, { eventId: 'shared', parents: ['root'] })
    const left = entryEvent('entry.updated', snapshot, { eventId: 'left', parents: ['shared'] })
    const right = entryEvent('entry.updated', snapshot, { eventId: 'right', parents: ['shared'] })
    const found = commonAncestor(['left', 'right'], [root, shared, left, right])
    expect(found?.eventId).toBe('shared')
  })

  it('orders a replay so parents always come first', () => {
    const snapshot = entrySnapshot()
    const a = entryEvent('entry.created', snapshot, {
      eventId: 'a',
      recordedAt: '2026-09-16T10:00:00.000Z',
    })
    const b = entryEvent('entry.updated', snapshot, {
      eventId: 'b',
      parents: ['a'],
      // Deliberately older than its parent: a clock that disagrees must not
      // reorder the causal chain.
      recordedAt: '2026-09-16T09:00:00.000Z',
    })
    expect(replayOrder([b, a]).map((e) => e.eventId)).toEqual(['a', 'b'])
  })

  it('orders independent events deterministically regardless of input order', () => {
    const snapshot = entrySnapshot()
    const x = entryEvent('entry.created', snapshot, {
      eventId: 'x',
      recordedAt: '2026-09-16T10:00:00.000Z',
      deviceId: DEVICE_A,
    })
    const y = entryEvent('entry.created', entrySnapshot(), {
      eventId: 'y',
      recordedAt: '2026-09-16T10:00:00.000Z',
      deviceId: DEVICE_B,
    })
    expect(replayOrder([x, y]).map((e) => e.eventId)).toEqual(
      replayOrder([y, x]).map((e) => e.eventId),
    )
  })
})

describe('projection', () => {
  it('shows the current snapshot of a linear history', () => {
    const snapshot = entrySnapshot()
    const events = [
      entryEvent('entry.created', snapshot, { eventId: 'e1' }),
      entryEvent('entry.updated', { ...snapshot, value: 30 }, { eventId: 'e2', parents: ['e1'] }),
    ]
    const { entries } = projectEvents(events)
    expect(entries).toHaveLength(1)
    expect(entries[0]?.value).toBe(30)
    expect(entries[0]?.conflicted).toBe(false)
    expect(entries[0]?.version).toBe(2)
  })

  it('keeps a deleted entry in history but out of totals', () => {
    const snapshot = entrySnapshot()
    const events = [
      entryEvent('entry.created', snapshot, { eventId: 'e1' }),
      entryEvent('entry.deleted', { ...snapshot, deleted: true }, {
        eventId: 'e2',
        parents: ['e1'],
      }),
    ]
    const { entries } = projectEvents(events)
    expect(entries[0]?.deleted).toBe(true)
    expect(countableEntries(entries)).toHaveLength(0)
  })

  it('restores a deleted entry with a further event', () => {
    const snapshot = entrySnapshot()
    const events = [
      entryEvent('entry.created', snapshot, { eventId: 'e1' }),
      entryEvent('entry.deleted', { ...snapshot, deleted: true }, { eventId: 'e2', parents: ['e1'] }),
      entryEvent('entry.restored', snapshot, { eventId: 'e3', parents: ['e2'] }),
    ]
    const { entries } = projectEvents(events)
    expect(entries[0]?.deleted).toBe(false)
    expect(countableEntries(entries)).toHaveLength(1)
  })

  it('marks divergent heads as conflicted and excludes them from totals', () => {
    const snapshot = entrySnapshot()
    const events = [
      entryEvent('entry.created', snapshot, { eventId: 'e1' }),
      entryEvent('entry.updated', { ...snapshot, value: 30 }, { eventId: 'e2', parents: ['e1'] }),
      entryEvent('entry.updated', { ...snapshot, value: 35 }, {
        eventId: 'e3',
        parents: ['e1'],
        deviceId: DEVICE_B,
      }),
    ]
    const { entries } = projectEvents(events)
    expect(entries[0]?.conflicted).toBe(true)
    expect(countableEntries(entries)).toHaveLength(0)
  })

  it('uses the chosen snapshot of a conflict resolution', () => {
    const snapshot = entrySnapshot()
    const resolution: DomainEvent<ConflictResolutionPayload> = {
      schemaVersion: EVENT_SCHEMA_VERSION,
      eventId: 'e4',
      entityId: snapshot.entryId,
      entityType: 'entry',
      habitId: snapshot.habitId,
      eventType: 'conflict.resolved',
      parentEventIds: ['e2', 'e3'],
      deviceId: DEVICE_A,
      deviceSequence: 9,
      recordedAt: '2026-09-16T22:31:00.000Z',
      occurredLocalDate: snapshot.occurredLocalDate,
      timezoneId: snapshot.timezoneId,
      payload: { decision: 'keep-local', resolvedSnapshot: { ...snapshot, value: 30 } },
    }
    const events = [
      entryEvent('entry.created', snapshot, { eventId: 'e1' }),
      entryEvent('entry.updated', { ...snapshot, value: 30 }, { eventId: 'e2', parents: ['e1'] }),
      entryEvent('entry.updated', { ...snapshot, value: 35 }, {
        eventId: 'e3',
        parents: ['e1'],
        deviceId: DEVICE_B,
      }),
      resolution,
    ]
    const { entries } = projectEvents(events)
    expect(entries[0]?.conflicted).toBe(false)
    expect(entries[0]?.value).toBe(30)
  })

  it('merges a reorder patch onto the parent habit snapshot', () => {
    const habit = habitSnapshot()
    const events: DomainEvent[] = [
      habitEvent('habit.created', habit, { eventId: 'h1' }),
      {
        ...habitEvent('habit.reordered', habit, { eventId: 'h2', parents: ['h1'] }),
        payload: { sortOrder: 5 },
      } as DomainEvent,
    ]
    const { habits } = projectEvents(events)
    expect(habits[0]?.sortOrder).toBe(5)
    expect(habits[0]?.displayName).toBe('Violin practice')
  })

  it('produces identical views regardless of input order', () => {
    const snapshot = entrySnapshot()
    const events = [
      entryEvent('entry.created', snapshot, { eventId: 'e1' }),
      entryEvent('entry.updated', { ...snapshot, value: 30 }, { eventId: 'e2', parents: ['e1'] }),
      habitEvent('habit.created', habitSnapshot(), { eventId: 'h1' }),
    ]
    const forward = projectEvents(events)
    const backward = projectEvents([...events].reverse())
    expect(backward).toEqual(forward)
  })
})

describe('event validation', () => {
  it('accepts a well-formed event', () => {
    const result = validateDomainEvent(entryEvent('entry.created', entrySnapshot()))
    expect(result.ok).toBe(true)
  })

  it('rejects an unknown timezone', () => {
    const bad = entryEvent('entry.created', entrySnapshot({ timezoneId: 'Mars/Olympus' }))
    const result = validateDomainEvent(bad)
    expect(result.ok).toBe(false)
  })

  it('rejects a malformed local date', () => {
    const bad = entryEvent('entry.created', entrySnapshot())
    ;(bad as { occurredLocalDate: string }).occurredLocalDate = '16/09/2026'
    expect(validateDomainEvent(bad).ok).toBe(false)
  })

  it('rejects a fractional duration', () => {
    const bad = entryEvent('entry.created', entrySnapshot({ value: 25.5 }))
    const result = validateDomainEvent(bad)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.issues.join(' ')).toContain('whole number of minutes')
    }
  })

  it('rejects a future schema version', () => {
    const bad = { ...entryEvent('entry.created', entrySnapshot()), schemaVersion: 2 }
    expect(validateDomainEvent(bad).ok).toBe(false)
  })

  it('reports the offending path', () => {
    const result = validateDomainEvent({ ...entryEvent('entry.created', entrySnapshot()), eventId: '' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.issues[0]).toContain('eventId')
  })

  it('accepts a conflict resolution naming several parents', () => {
    const event = {
      ...entryEvent('entry.created', entrySnapshot(), { eventId: testId('event') }),
      eventType: 'conflict.resolved' as const,
      parentEventIds: [testId('parent'), testId('parent')],
      payload: { decision: 'keep-both', resolvedSnapshot: entrySnapshot() },
    }
    expect(validateDomainEvent(event).ok).toBe(true)
  })
})
