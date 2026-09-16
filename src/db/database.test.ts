import { describe, expect, it } from 'vitest'
import {
  appendEvents,
  commitImport,
  createSnapshot,
  db,
  DuplicateEventIdError,
  ensureProjectionsCurrent,
  ensureThisDevice,
  EventValidationError,
  rebuildAllProjections,
  restoreSnapshot,
  SNAPSHOT_RETENTION,
  writeMeta,
} from './database.ts'
import { META_KEYS } from './schema.ts'
import { createHabit, archiveHabit, moveHabit, restoreHabit, updateHabit } from './repositories/habits.ts'
import { createGoal, deleteGoal, updateGoal } from './repositories/goals.ts'
import {
  createEntry,
  deleteEntry,
  listEntriesForHabit,
  restoreEntry,
  updateEntry,
} from './repositories/entries.ts'
import { ConflictedEntityError } from './repositories/common.ts'
import { allEvents, integrityReport } from './repositories/dataTransfer.ts'
import { EVENT_SCHEMA_VERSION } from '../domain/events/types.ts'
import { newId } from '../domain/events/ids.ts'
import type { DomainEvent, EntrySnapshot } from '../domain/events/types.ts'

const TZ = 'America/Los_Angeles'
const TODAY = '2026-09-16'

async function makeHabit(overrides: Partial<Parameters<typeof createHabit>[0]> = {}) {
  return createHabit({
    displayName: 'Violin practice',
    trackingModel: 'duration',
    isPrivate: false,
    streakThreshold: 10,
    createdLocalDate: TODAY,
    timezoneId: TZ,
    ...overrides,
  })
}

describe('device identity and sequences', () => {
  it('creates one device row and reuses it', async () => {
    const first = await ensureThisDevice()
    const second = await ensureThisDevice()
    expect(second.deviceId).toBe(first.deviceId)
    expect(await db().devices.count()).toBe(1)
  })

  it('allocates sequences without gaps across writes', async () => {
    const habit = await makeHabit()
    await createEntry({
      habitId: habit.habitId,
      occurredLocalDate: TODAY,
      timezoneId: TZ,
      value: 25,
      unit: 'minutes',
    })
    const events = (await allEvents()).sort((a, b) => a.deviceSequence - b.deviceSequence)
    expect(events.map((e) => e.deviceSequence)).toEqual([1, 2])
    const device = await ensureThisDevice()
    const row = await db().devices.get(device.deviceId)
    expect(row?.nextSequence).toBe(3)
  })

  it('consumes no sequence when a write fails validation', async () => {
    const device = await ensureThisDevice()
    const before = (await db().devices.get(device.deviceId))?.nextSequence

    await expect(
      appendEvents([
        {
          schemaVersion: EVENT_SCHEMA_VERSION,
          eventId: newId(),
          entityId: newId(),
          entityType: 'entry',
          eventType: 'entry.created',
          parentEventIds: [],
          // A bad local date must be refused before anything is written.
          occurredLocalDate: 'not-a-date',
          timezoneId: TZ,
          payload: {},
        },
      ]),
    ).rejects.toBeInstanceOf(EventValidationError)

    expect((await db().devices.get(device.deviceId))?.nextSequence).toBe(before)
    expect(await db().events.count()).toBe(0)
  })

  it('rejects a duplicate event id', async () => {
    const eventId = newId()
    const draft = {
      schemaVersion: EVENT_SCHEMA_VERSION,
      eventId,
      entityId: newId(),
      entityType: 'entry' as const,
      eventType: 'entry.created' as const,
      parentEventIds: [],
      occurredLocalDate: TODAY,
      timezoneId: TZ,
      payload: {
        entryId: newId(),
        habitId: newId(),
        occurredLocalDate: TODAY,
        timezoneId: TZ,
        value: 25,
        unit: 'minutes' as const,
        deleted: false,
      },
    }
    await appendEvents([draft])
    await expect(appendEvents([draft])).rejects.toBeInstanceOf(DuplicateEventIdError)
    expect(await db().events.count()).toBe(1)
  })
})

describe('habit repository', () => {
  it('projects a created habit into habitViews', async () => {
    const habit = await makeHabit()
    const row = await db().habitViews.get(habit.habitId)
    expect(row?.displayName).toBe('Violin practice')
    expect(row?.unit).toBe('minutes')
    expect(row?.archivedFlag).toBe(0)
    expect(row?.logLabel).toBe('Log violin')
  })

  it('stores a private habit only as "Private"', async () => {
    const habit = await makeHabit({ displayName: 'Something personal', isPrivate: true })
    expect(habit.displayName).toBe('Private')

    const serialized = JSON.stringify(await allEvents())
    expect(serialized).not.toContain('Something personal')
    expect(habit.logLabel).toBe('Log event')
  })

  it('keeps a private habit masked through a rename', async () => {
    const habit = await makeHabit({ displayName: 'x', isPrivate: true })
    const updated = await updateHabit(habit.habitId, { displayName: 'A real name' }, TZ)
    expect(updated.displayName).toBe('Private')
    expect(JSON.stringify(await allEvents())).not.toContain('A real name')
  })

  it('archives and restores without losing events', async () => {
    const habit = await makeHabit()
    await archiveHabit(habit.habitId, TZ)
    expect((await db().habitViews.get(habit.habitId))?.archived).toBe(true)

    await restoreHabit(habit.habitId, TZ)
    expect((await db().habitViews.get(habit.habitId))?.archived).toBe(false)
    expect(await db().events.count()).toBe(3)
  })

  it('reorders two habits with auditable events', async () => {
    const first = await makeHabit({ displayName: 'Alpha' })
    const second = await makeHabit({ displayName: 'Beta' })
    expect(first.sortOrder).toBe(0)
    expect(second.sortOrder).toBe(1)

    await moveHabit(second.habitId, -1, TZ)
    expect((await db().habitViews.get(second.habitId))?.sortOrder).toBe(0)
    expect((await db().habitViews.get(first.habitId))?.sortOrder).toBe(1)
    expect((await allEvents()).filter((e) => e.eventType === 'habit.reordered')).toHaveLength(2)
  })
})

describe('entry repository', () => {
  it('creates, edits, deletes and restores through events only', async () => {
    const habit = await makeHabit()
    const entry = await createEntry({
      habitId: habit.habitId,
      occurredLocalDate: TODAY,
      timezoneId: TZ,
      value: 25,
      unit: 'minutes',
      startTime: 18 * 60 + 15,
      note: 'Scales',
    })

    await updateEntry(entry.entryId, { value: 30 })
    expect((await db().entryViews.get(entry.entryId))?.value).toBe(30)

    await deleteEntry(entry.entryId)
    const deletedRow = await db().entryViews.get(entry.entryId)
    expect(deletedRow?.deleted).toBe(true)
    expect(deletedRow?.deletedFlag).toBe(1)

    await restoreEntry(entry.entryId)
    expect((await db().entryViews.get(entry.entryId))?.deleted).toBe(false)

    // Nothing was ever removed: create, update, delete, restore.
    const entryEvents = (await allEvents()).filter((e) => e.entityId === entry.entryId)
    expect(entryEvents).toHaveLength(4)
  })

  it('freezes the occurrence instant in the zone chosen at entry time', async () => {
    const habit = await makeHabit()
    const entry = await createEntry({
      habitId: habit.habitId,
      occurredLocalDate: '2026-09-16',
      timezoneId: TZ,
      value: 25,
      unit: 'minutes',
      startTime: 18 * 60 + 15,
    })
    // 6:15 PM PDT on Sep 16 is 01:15Z on Sep 17.
    expect(entry.occurredAt).toBe('2026-09-17T01:15:00.000Z')
    expect(entry.occurredLocalDate).toBe('2026-09-16')
  })

  it('queries by habit and date range', async () => {
    const habit = await makeHabit()
    for (const date of ['2026-09-14', '2026-09-15', '2026-09-16']) {
      await createEntry({
        habitId: habit.habitId,
        occurredLocalDate: date,
        timezoneId: TZ,
        value: 25,
        unit: 'minutes',
      })
    }
    const inRange = await listEntriesForHabit(habit.habitId, {
      from: '2026-09-15',
      to: '2026-09-16',
    })
    expect(inRange).toHaveLength(2)
  })

  it('refuses to edit a conflicted entry', async () => {
    const habit = await makeHabit()
    const entry = await createEntry({
      habitId: habit.habitId,
      occurredLocalDate: TODAY,
      timezoneId: TZ,
      value: 25,
      unit: 'minutes',
    })
    const root = (await allEvents()).find((e) => e.entityId === entry.entryId) as DomainEvent

    // This device edits it…
    await updateEntry(entry.entryId, { value: 30 })

    // …and a second, independent branch off the same root arrives from elsewhere.
    await commitImport({
      importedEvents: [
        {
          ...root,
          eventId: newId(),
          eventType: 'entry.updated',
          parentEventIds: [root.eventId],
          deviceId: '22222222-2222-4222-8222-222222222222',
          deviceSequence: 7,
          payload: { ...(root.payload as EntrySnapshot), value: 35 },
        },
      ],
      localDrafts: [],
      importRow: {
        importId: newId(),
        backupId: newId(),
        importedAt: new Date().toISOString(),
        sourceDeviceId: '22222222-2222-4222-8222-222222222222',
        sourceDeviceLabel: 'Another device',
        fileName: 'habit-backup-2026-09-16.json',
        newEventCount: 1,
        alreadyPresentCount: 0,
        conflictCount: 1,
        snapshotId: null,
        rolledBackAt: null,
      },
    })

    const row = await db().entryViews.get(entry.entryId)
    expect(row?.conflicted).toBe(true)
    await expect(updateEntry(entry.entryId, { value: 40 })).rejects.toBeInstanceOf(
      ConflictedEntityError,
    )
  })
})

describe('goal repository', () => {
  it('creates, updates and retires a goal', async () => {
    const habit = await makeHabit()
    const goal = await createGoal({
      habitId: habit.habitId,
      goalType: 'periodic-minimum',
      metric: 'duration-minutes',
      targetValue: 300,
      period: 'week',
      effectiveFromLocalDate: TODAY,
      timezoneId: TZ,
      weekStartsOn: 1,
    })
    expect((await db().goalViews.get(goal.goalId))?.activeFlag).toBe(1)

    await updateGoal(goal.goalId, { targetValue: 420 })
    expect((await db().goalViews.get(goal.goalId))?.targetValue).toBe(420)

    await deleteGoal(goal.goalId, TODAY)
    const retired = await db().goalViews.get(goal.goalId)
    expect(retired?.active).toBe(false)
    expect(retired?.effectiveToLocalDate).toBe(TODAY)
    // The original target is still in the log.
    expect(JSON.stringify(await allEvents())).toContain('300')
  })
})

describe('projection rebuild', () => {
  it('produces identical views after a full rebuild', async () => {
    const habit = await makeHabit()
    const entry = await createEntry({
      habitId: habit.habitId,
      occurredLocalDate: TODAY,
      timezoneId: TZ,
      value: 25,
      unit: 'minutes',
    })
    await updateEntry(entry.entryId, { value: 30 })

    const before = {
      habits: await db().habitViews.toArray(),
      entries: await db().entryViews.toArray(),
      heads: await db().entityHeads.toArray(),
    }

    await rebuildAllProjections()

    expect(await db().habitViews.toArray()).toEqual(before.habits)
    expect(await db().entryViews.toArray()).toEqual(before.entries)
    expect(await db().entityHeads.toArray()).toEqual(before.heads)
    // Events are untouched by a rebuild.
    expect(await db().events.count()).toBe(3)
  })

  it('rebuilds when the stored projection version is stale', async () => {
    await makeHabit()
    await db().habitViews.clear()
    await writeMeta(META_KEYS.projectionVersion, -1)

    expect(await ensureProjectionsCurrent()).toBe(true)
    expect(await db().habitViews.count()).toBe(1)
    // A second call finds nothing to do.
    expect(await ensureProjectionsCurrent()).toBe(false)
  })
})

describe('snapshots', () => {
  it('captures and restores the authoritative event set', async () => {
    const habit = await makeHabit()
    await createEntry({
      habitId: habit.habitId,
      occurredLocalDate: TODAY,
      timezoneId: TZ,
      value: 25,
      unit: 'minutes',
    })
    const snapshot = await createSnapshot('pre-merge')
    expect(snapshot.eventCount).toBe(2)

    await createEntry({
      habitId: habit.habitId,
      occurredLocalDate: TODAY,
      timezoneId: TZ,
      value: 45,
      unit: 'minutes',
    })
    expect(await db().events.count()).toBe(3)

    await restoreSnapshot(snapshot.snapshotId)
    expect(await db().events.count()).toBe(2)
    expect(await db().entryViews.count()).toBe(1)
  })

  it('keeps only the most recent automatic snapshots', async () => {
    await makeHabit()
    for (let i = 0; i < SNAPSHOT_RETENTION + 2; i += 1) {
      await createSnapshot('pre-merge')
      // createdAt has millisecond resolution; nudge each one apart.
      await new Promise((resolve) => setTimeout(resolve, 2))
    }
    expect(await db().snapshots.count()).toBe(SNAPSHOT_RETENTION)
  })

  it('marks a rolled-back import in history', async () => {
    const habit = await makeHabit()
    const snapshot = await createSnapshot('pre-merge')
    const importId = newId()

    await commitImport({
      importedEvents: [],
      localDrafts: [],
      importRow: {
        importId,
        backupId: newId(),
        importedAt: new Date().toISOString(),
        sourceDeviceId: newId(),
        sourceDeviceLabel: 'Another device',
        fileName: 'habit-backup-2026-09-16.json',
        newEventCount: 0,
        alreadyPresentCount: 0,
        conflictCount: 0,
        snapshotId: snapshot.snapshotId,
        rolledBackAt: null,
      },
    })

    await restoreSnapshot(snapshot.snapshotId)
    expect((await db().imports.get(importId))?.rolledBackAt).not.toBeNull()
    expect(habit.habitId).toBeTruthy()
  })
})

describe('import commit', () => {
  it('leaves the database untouched when an imported event is invalid', async () => {
    const habit = await makeHabit()
    const before = await db().events.count()

    await expect(
      commitImport({
        importedEvents: [
          {
            schemaVersion: EVENT_SCHEMA_VERSION,
            eventId: newId(),
            entityId: newId(),
            entityType: 'entry',
            habitId: habit.habitId,
            eventType: 'entry.created',
            parentEventIds: [],
            deviceId: newId(),
            deviceSequence: 1,
            recordedAt: new Date().toISOString(),
            occurredLocalDate: 'nonsense',
            timezoneId: TZ,
            payload: {},
          } as DomainEvent,
        ],
        localDrafts: [],
        importRow: {
          importId: newId(),
          backupId: newId(),
          importedAt: new Date().toISOString(),
          sourceDeviceId: newId(),
          sourceDeviceLabel: 'Another device',
          fileName: 'bad.json',
          newEventCount: 1,
          alreadyPresentCount: 0,
          conflictCount: 0,
          snapshotId: null,
          rolledBackAt: null,
        },
      }),
    ).rejects.toBeInstanceOf(EventValidationError)

    expect(await db().events.count()).toBe(before)
    expect(await db().imports.count()).toBe(0)
  })

  it('registers the source device and its high-water mark', async () => {
    const habit = await makeHabit()
    const foreignDevice = '33333333-3333-4333-8333-333333333333'
    await commitImport({
      importedEvents: [
        {
          schemaVersion: EVENT_SCHEMA_VERSION,
          eventId: newId(),
          entityId: newId(),
          entityType: 'entry',
          habitId: habit.habitId,
          eventType: 'entry.created',
          parentEventIds: [],
          deviceId: foreignDevice,
          deviceSequence: 12,
          recordedAt: '2026-09-16T18:42:00.000Z',
          occurredLocalDate: TODAY,
          timezoneId: TZ,
          payload: {
            entryId: newId(),
            habitId: habit.habitId,
            occurredLocalDate: TODAY,
            timezoneId: TZ,
            value: 45,
            unit: 'minutes',
            deleted: false,
          },
        } as DomainEvent,
      ],
      localDrafts: [],
      importRow: {
        importId: newId(),
        backupId: newId(),
        importedAt: new Date().toISOString(),
        sourceDeviceId: foreignDevice,
        sourceDeviceLabel: 'Another device',
        fileName: 'habit-backup-2026-09-16.json',
        newEventCount: 1,
        alreadyPresentCount: 0,
        conflictCount: 0,
        snapshotId: null,
        rolledBackAt: null,
      },
    })

    const device = await db().devices.get(foreignDevice)
    expect(device?.label).toBe('Another device')
    expect(device?.isThisDevice).toBe(false)

    const report = await integrityReport()
    // One local habit.created plus the single imported entry.
    expect(report.eventCount).toBe(2)
    // Sequences 1-11 from that device are genuinely absent.
    expect(report.missingSequenceCount).toBe(11)
  })
})
