import { beforeEach, describe, expect, it } from 'vitest'
import {
  DuplicateEventMismatchError,
  diffEntrySnapshots,
  findSequenceGaps,
  planImport,
} from './plan.ts'
import { buildResolution } from './resolve.ts'
import type { PendingEvent } from './resolve.ts'
import { buildBackup } from '../backup/build.ts'
import type { BackupFile } from '../backup/format.ts'
import { projectEvents } from '../events/project.ts'
import { computeHeads } from '../events/heads.ts'
import type { DomainEvent, EntrySnapshot } from '../events/types.ts'
import { EVENT_SCHEMA_VERSION } from '../events/types.ts'
import {
  DEVICE_A,
  DEVICE_B,
  entryEvent,
  entrySnapshot,
  resetTestIds,
} from '../../test/fixtures/events.ts'

beforeEach(resetTestIds)

const ENTRY_ID = 'a1111111-1111-4111-8111-111111111111'
const ROOT = 'e0000000-0000-4000-8000-000000000000'
const LOCAL_EDIT = 'e1111111-1111-4111-8111-111111111111'
const IMPORTED_EDIT = 'e2222222-2222-4222-8222-222222222222'

const base = entrySnapshot({ entryId: ENTRY_ID, value: 25 })

function backupOf(events: DomainEvent[]): Promise<BackupFile> {
  return buildBackup({
    events,
    sourceDevice: { deviceId: DEVICE_B, label: 'Another device' },
    appVersion: '1.0.0',
    exportedAt: '2026-09-16T21:12:00.000Z',
    backupId: 'b0000000-0000-4000-8000-000000000002',
  })
}

const rootEvent = entryEvent('entry.created', base, {
  eventId: ROOT,
  sequence: 1,
  recordedAt: '2026-09-14T18:32:00.000Z',
})

const localEdit = entryEvent(
  'entry.updated',
  { ...base, value: 30 },
  { eventId: LOCAL_EDIT, parents: [ROOT], sequence: 2, recordedAt: '2026-09-14T21:12:00.000Z' },
)

const importedEdit = entryEvent(
  'entry.updated',
  { ...base, value: 35 },
  {
    eventId: IMPORTED_EDIT,
    parents: [ROOT],
    deviceId: DEVICE_B,
    sequence: 5,
    recordedAt: '2026-09-14T20:47:00.000Z',
  },
)

describe('sequence gaps', () => {
  it('finds nothing when a device sequence is contiguous', () => {
    const events = [
      entryEvent('entry.created', entrySnapshot(), { sequence: 1 }),
      entryEvent('entry.created', entrySnapshot(), { sequence: 2 }),
    ]
    expect(findSequenceGaps(events)).toEqual([])
  })

  it('reports a missing sequence number', () => {
    const events = [
      entryEvent('entry.created', entrySnapshot(), { sequence: 1 }),
      entryEvent('entry.created', entrySnapshot(), { sequence: 3 }),
    ]
    const gaps = findSequenceGaps(events)
    expect(gaps).toHaveLength(1)
    expect(gaps[0]?.missing).toEqual([2])
    expect(gaps[0]?.highWaterMark).toBe(3)
  })

  it('uses a declared high-water mark above what it can see', () => {
    const events = [entryEvent('entry.created', entrySnapshot(), { sequence: 1 })]
    const gaps = findSequenceGaps(events, { [DEVICE_A]: 3 })
    expect(gaps[0]?.missing).toEqual([2, 3])
  })

  it('tracks devices independently', () => {
    const events = [
      entryEvent('entry.created', entrySnapshot(), { sequence: 1, deviceId: DEVICE_A }),
      entryEvent('entry.created', entrySnapshot(), { sequence: 2, deviceId: DEVICE_B }),
    ]
    const gaps = findSequenceGaps(events)
    expect(gaps).toHaveLength(1)
    expect(gaps[0]?.deviceId).toBe(DEVICE_B)
  })
})

describe('import planning', () => {
  it('counts an identical backup as entirely already present', async () => {
    const local = [rootEvent, localEdit]
    const plan = planImport(local, await backupOf(local))
    expect(plan.alreadyPresentCount).toBe(2)
    expect(plan.newEventCount).toBe(0)
    expect(plan.conflictCount).toBe(0)
    expect(plan.newEvents).toEqual([])
  })

  it('is idempotent: importing the same backup twice adds nothing the second time', async () => {
    const local = [rootEvent]
    const backup = await backupOf([rootEvent, importedEdit])

    const first = planImport(local, backup)
    expect(first.newEventCount).toBe(1)

    const afterFirst = [...local, ...first.newEvents]
    const second = planImport(afterFirst, backup)
    expect(second.newEventCount).toBe(0)
    expect(second.conflictCount).toBe(0)
  })

  it('treats a descendant head as a plain update, not a conflict', async () => {
    // The imported edit builds directly on the local head.
    const chained = entryEvent(
      'entry.updated',
      { ...base, value: 40 },
      { eventId: IMPORTED_EDIT, parents: [LOCAL_EDIT], deviceId: DEVICE_B, sequence: 5 },
    )
    const plan = planImport([rootEvent, localEdit], await backupOf([rootEvent, localEdit, chained]))
    expect(plan.newEventCount).toBe(1)
    expect(plan.conflictCount).toBe(0)
  })

  it('reports genuinely divergent heads as a conflict', async () => {
    const plan = planImport([rootEvent, localEdit], await backupOf([rootEvent, importedEdit]))
    expect(plan.newEventCount).toBe(1)
    expect(plan.conflictCount).toBe(1)

    const conflict = plan.conflicts[0]
    expect(conflict?.entityId).toBe(ENTRY_ID)
    expect(conflict?.heads.map((h) => h.origin).sort()).toEqual(['imported', 'local'])
    expect((conflict?.ancestorSnapshot as EntrySnapshot).value).toBe(25)
  })

  it('refuses a file that reuses an event id with different contents', async () => {
    const forged = { ...rootEvent, payload: { ...base, value: 999 } }
    await expect(async () =>
      planImport([rootEvent], await backupOf([forged as DomainEvent])),
    ).rejects.toBeInstanceOf(DuplicateEventMismatchError)
  })

  it('describes coverage before and after', async () => {
    const older = entryEvent('entry.created', entrySnapshot({ occurredLocalDate: '2026-01-01' }), {
      eventId: 'c1111111-1111-4111-8111-111111111111',
      deviceId: DEVICE_B,
      sequence: 1,
    })
    const plan = planImport([rootEvent], await backupOf([older]))
    expect(plan.coverageBefore.earliest).toBe('2026-09-16')
    expect(plan.coverageAfter.earliest).toBe('2026-01-01')
    expect(plan.projectedTotalEvents).toBe(2)
  })

  it('lists the union as commutative before any resolution', async () => {
    const left = [rootEvent, localEdit]
    const right = [rootEvent, importedEdit]
    const planA = planImport(left, await backupOf(right))
    const planB = planImport(right, await backupOf(left))
    const unionA = [...left, ...planA.newEvents].map((e) => e.eventId).sort()
    const unionB = [...right, ...planB.newEvents].map((e) => e.eventId).sort()
    expect(unionA).toEqual(unionB)
  })

  it('diffs the fields that actually differ', () => {
    const differences = diffEntrySnapshots({ ...base, value: 30 }, { ...base, value: 35, note: 'x' })
    expect(differences.map((d) => d.field).sort()).toEqual(['note', 'value'])
  })
})

describe('conflict resolution', () => {
  const union = [rootEvent, localEdit, importedEdit]

  function conflictFrom(): ReturnType<typeof planImport>['conflicts'][number] {
    return {
      entityId: ENTRY_ID,
      entityType: 'entry',
      habitId: base.habitId,
      heads: [
        {
          eventId: LOCAL_EDIT,
          origin: 'local',
          recordedAt: localEdit.recordedAt,
          deviceId: DEVICE_A,
          snapshot: { ...base, value: 30 },
        },
        {
          eventId: IMPORTED_EDIT,
          origin: 'imported',
          recordedAt: importedEdit.recordedAt,
          deviceId: DEVICE_B,
          snapshot: { ...base, value: 35 },
        },
      ],
      ancestorSnapshot: base,
      ancestorEventId: ROOT,
    }
  }

  function materialize(pending: PendingEvent, sequence: number): DomainEvent {
    return {
      ...pending,
      deviceId: DEVICE_A,
      deviceSequence: sequence,
      recordedAt: '2026-09-16T22:31:00.000Z',
    } as DomainEvent
  }

  it('keeps local by naming both heads as parents', () => {
    const { resolution, split } = buildResolution(conflictFrom(), { kind: 'keep-local' })
    expect(split).toBeUndefined()
    expect(resolution.parentEventIds.sort()).toEqual([LOCAL_EDIT, IMPORTED_EDIT].sort())
    expect((resolution.payload.resolvedSnapshot as EntrySnapshot).value).toBe(30)

    const events = [...union, materialize(resolution, 3)]
    expect(computeHeads(events)).toHaveLength(1)
    const { entries } = projectEvents(events)
    expect(entries[0]?.value).toBe(30)
    expect(entries[0]?.conflicted).toBe(false)
  })

  it('uses the imported value', () => {
    const { resolution } = buildResolution(conflictFrom(), { kind: 'use-imported' })
    const { entries } = projectEvents([...union, materialize(resolution, 3)])
    expect(entries[0]?.value).toBe(35)
  })

  it('records a manually merged value', () => {
    const { resolution } = buildResolution(conflictFrom(), {
      kind: 'manual',
      snapshot: { ...base, value: 45 },
    })
    const { entries } = projectEvents([...union, materialize(resolution, 3)])
    expect(entries[0]?.value).toBe(45)
    expect(resolution.payload.decision).toBe('manual')
  })

  it('keeps both by splitting the other branch into a new entity', () => {
    const { resolution, split } = buildResolution(conflictFrom(), { kind: 'keep-both' })
    expect(split).toBeDefined()
    const events = [...union, materialize(resolution, 3), materialize(split as PendingEvent, 4)]
    const { entries } = projectEvents(events)
    expect(entries).toHaveLength(2)
    expect(entries.map((e) => e.value).sort((a, b) => a - b)).toEqual([30, 35])
    const splitEntry = entries.find((e) => e.entryId !== ENTRY_ID)
    expect(splitEntry?.sourceEntryId).toBe(ENTRY_ID)
  })

  it('never loses an authoritative event', () => {
    const { resolution } = buildResolution(conflictFrom(), { kind: 'use-imported' })
    const events = [...union, materialize(resolution, 3)]
    // Both original branches are still in the log behind the resolution.
    expect(events.map((e) => e.eventId)).toContain(LOCAL_EDIT)
    expect(events.map((e) => e.eventId)).toContain(IMPORTED_EDIT)
  })

  it('leaves sequence allocation to the write transaction', () => {
    const { resolution } = buildResolution(conflictFrom(), { kind: 'keep-local' })
    expect(resolution).not.toHaveProperty('deviceSequence')
    expect(resolution).not.toHaveProperty('recordedAt')
    expect(resolution.schemaVersion).toBe(EVENT_SCHEMA_VERSION)
  })

  it('refuses "keep both" for anything that is not an entry', () => {
    const goalConflict = { ...conflictFrom(), entityType: 'goal' as const }
    expect(() => buildResolution(goalConflict, { kind: 'keep-both' })).toThrow(/Keep both/)
  })
})
