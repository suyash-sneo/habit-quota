/**
 * The Dexie database and the single place events are appended.
 *
 * Every local write goes through {@link appendEvents}, which allocates device
 * sequences, validates, stores, and refreshes projections inside one read-write
 * transaction. If any step throws, no sequence is consumed and no projection is
 * half-updated.
 *
 * Inside a transaction callback the table accessors below are automatically
 * bound to that transaction by Dexie, so there is no separate `tx` handle to
 * thread through.
 */

import Dexie from 'dexie'
import type { EntityTable } from 'dexie'
import type { DomainEvent } from '../domain/events/types.ts'
import { validateDomainEvent } from '../domain/events/schema.ts'
import { newId } from '../domain/events/ids.ts'
import { PROJECTION_VERSION, projectEvents } from '../domain/events/project.ts'
import type {
  AppSettings,
  DeviceRow,
  EntityHeadRow,
  EntryViewRow,
  EventRow,
  ExportRow,
  Flag,
  GoalViewRow,
  HabitViewRow,
  ImportRow,
  MetaRow,
  SnapshotRow,
} from './schema.ts'
import { DATABASE_NAME, DEFAULT_SETTINGS, META_KEYS } from './schema.ts'
import { deviceTimezone } from '../domain/time/zone.ts'
import { defaultDeviceLabel } from './device-label.ts'

export class HabitDatabase extends Dexie {
  events!: EntityTable<EventRow, 'eventId'>
  habitViews!: EntityTable<HabitViewRow, 'habitId'>
  goalViews!: EntityTable<GoalViewRow, 'goalId'>
  entryViews!: EntityTable<EntryViewRow, 'entryId'>
  entityHeads!: EntityTable<EntityHeadRow, 'entityId'>
  devices!: EntityTable<DeviceRow, 'deviceId'>
  imports!: EntityTable<ImportRow, 'importId'>
  exports!: EntityTable<ExportRow, 'exportId'>
  snapshots!: EntityTable<SnapshotRow, 'snapshotId'>
  meta!: EntityTable<MetaRow, 'key'>

  constructor(name: string = DATABASE_NAME) {
    super(name)
    this.version(1).stores({
      events:
        '&eventId, entityId, habitId, eventType, recordedAt, occurredLocalDate, [deviceId+deviceSequence], *parentEventIds',
      habitViews: '&habitId, sortOrder, archivedFlag',
      goalViews: '&goalId, habitId, activeFlag, [habitId+activeFlag]',
      entryViews: '&entryId, habitId, occurredLocalDate, deletedFlag, [habitId+occurredLocalDate]',
      entityHeads: '&entityId, entityType, habitId',
      devices: '&deviceId',
      imports: '&importId, importedAt, backupId',
      exports: '&exportId, exportedAt',
      snapshots: '&snapshotId, createdAt',
      meta: '&key',
    })
  }
}

let instance: HabitDatabase | null = null

export function db(): HabitDatabase {
  if (!instance) instance = new HabitDatabase()
  return instance
}

/** Test seam: point the app at a throwaway database. */
export function setDatabaseForTesting(next: HabitDatabase | null): void {
  instance = next
}

const flag = (value: boolean): Flag => (value ? 1 : 0)

/** Every table, for transactions that rebuild or replace the whole database. */
function allTables(database: HabitDatabase): Dexie.Table[] {
  return database.tables
}

/* ----------------------------------------------------------------- meta io */

export async function readMeta<T>(key: string): Promise<T | undefined> {
  const row = (await db().meta.get(key)) as MetaRow<T> | undefined
  return row?.value
}

export async function writeMeta<T>(key: string, value: T): Promise<void> {
  await db().meta.put({ key, value } as MetaRow)
}

export async function getSettings(): Promise<AppSettings> {
  const stored = await readMeta<AppSettings>(META_KEYS.settings)
  return { ...DEFAULT_SETTINGS, timezoneId: deviceTimezone(), ...(stored ?? {}) }
}

export async function saveSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
  const next = { ...(await getSettings()), ...patch }
  await writeMeta(META_KEYS.settings, next)
  return next
}

/* ----------------------------------------------------------------- device */

/**
 * This browser profile's device identity. Created on first use. The label is a
 * generic platform name such as "This Mac" — never anything about the person,
 * because it travels inside every backup.
 */
export async function ensureThisDevice(label = defaultDeviceLabel()): Promise<DeviceRow> {
  const database = db()
  return database.transaction('rw', database.devices, database.meta, async () => {
    const existingId = await readMeta<string>(META_KEYS.thisDeviceId)
    if (existingId) {
      const row = await database.devices.get(existingId)
      if (row) return row
    }
    const device: DeviceRow = {
      deviceId: existingId ?? newId(),
      label,
      nextSequence: 1,
      createdAt: new Date().toISOString(),
      isThisDevice: true,
    }
    await database.devices.put(device)
    await writeMeta(META_KEYS.thisDeviceId, device.deviceId)
    return device
  })
}

/* ------------------------------------------------------------ projections */

/** Re-project the entities touched by `entityIds`, inside an open transaction. */
async function refreshProjections(entityIds: readonly string[]): Promise<void> {
  const database = db()
  for (const entityId of [...new Set(entityIds)]) {
    const events = await database.events.where('entityId').equals(entityId).toArray()
    if (!events.length) continue
    const { habits, goals, entries, heads } = projectEvents(events)

    for (const habit of habits) {
      await database.habitViews.put({ ...habit, archivedFlag: flag(habit.archived) })
    }
    for (const goal of goals) {
      await database.goalViews.put({ ...goal, activeFlag: flag(goal.active) })
    }
    for (const entry of entries) {
      await database.entryViews.put({ ...entry, deletedFlag: flag(entry.deleted) })
    }
    for (const head of heads) {
      await database.entityHeads.put(head)
    }
  }
}

/** Replace every projection row from the given events, inside an open transaction. */
async function writeAllProjections(events: readonly DomainEvent[]): Promise<void> {
  const database = db()
  await database.habitViews.clear()
  await database.goalViews.clear()
  await database.entryViews.clear()
  await database.entityHeads.clear()

  const { habits, goals, entries, heads } = projectEvents(events)
  await database.habitViews.bulkPut(habits.map((h) => ({ ...h, archivedFlag: flag(h.archived) })))
  await database.goalViews.bulkPut(goals.map((g) => ({ ...g, activeFlag: flag(g.active) })))
  await database.entryViews.bulkPut(entries.map((e) => ({ ...e, deletedFlag: flag(e.deleted) })))
  await database.entityHeads.bulkPut(heads)
  await writeMeta(META_KEYS.projectionVersion, PROJECTION_VERSION)
}

/** Drop every projection table and replay the whole log. */
export async function rebuildAllProjections(): Promise<void> {
  const database = db()
  await database.transaction('rw', allTables(database), async () => {
    const events = await database.events.toArray()
    await writeAllProjections(events)
  })
}

/** Rebuild when the stored projection version is stale or absent. */
export async function ensureProjectionsCurrent(): Promise<boolean> {
  const stored = await readMeta<number>(META_KEYS.projectionVersion)
  if (stored === PROJECTION_VERSION) return false
  await rebuildAllProjections()
  return true
}

/* ------------------------------------------------------------ event write */

/**
 * An event with its per-device bookkeeping unfilled. The write transaction
 * assigns `deviceId`, `deviceSequence` and `recordedAt`.
 */
export type DraftEvent = Omit<DomainEvent, 'deviceId' | 'deviceSequence' | 'recordedAt'> & {
  recordedAt?: string
}

export class DuplicateEventIdError extends Error {
  constructor(readonly eventId: string) {
    super(`An event with id ${eventId} already exists.`)
    this.name = 'DuplicateEventIdError'
  }
}

export class EventValidationError extends Error {
  constructor(readonly issues: string[]) {
    super(`Refusing to store an invalid event: ${issues.join('; ')}`)
    this.name = 'EventValidationError'
  }
}

/**
 * Append locally authored events atomically.
 *
 * Sequence allocation, insertion and projection all happen in one transaction,
 * so an interrupted write leaves the database exactly as it was.
 */
export async function appendEvents(drafts: readonly DraftEvent[]): Promise<DomainEvent[]> {
  if (!drafts.length) return []
  const database = db()
  const device = await ensureThisDevice()

  return database.transaction('rw', allTables(database), async () => {
    const deviceRow = await database.devices.get(device.deviceId)
    if (!deviceRow) throw new Error('This device record is missing.')

    let sequence = deviceRow.nextSequence
    const recordedAt = new Date().toISOString()
    const stored: DomainEvent[] = []

    for (const draft of drafts) {
      const event: DomainEvent = {
        ...draft,
        deviceId: device.deviceId,
        deviceSequence: sequence,
        recordedAt: draft.recordedAt ?? recordedAt,
      }
      sequence += 1

      const validation = validateDomainEvent(event)
      if (!validation.ok) throw new EventValidationError(validation.issues)

      const existing = await database.events.get(event.eventId)
      if (existing) throw new DuplicateEventIdError(event.eventId)

      await database.events.add(event)
      stored.push(event)
    }

    await database.devices.put({ ...deviceRow, nextSequence: sequence })
    await refreshProjections(stored.map((e) => e.entityId))
    return stored
  })
}

/**
 * Append events that came from a backup, keeping their original device and
 * sequence, together with any locally authored resolution events.
 *
 * `localDrafts` still get fresh sequences from this device.
 */
export async function commitImport(options: {
  importedEvents: readonly DomainEvent[]
  localDrafts: readonly DraftEvent[]
  importRow: ImportRow
}): Promise<{ written: number }> {
  const database = db()
  const device = await ensureThisDevice()

  return database.transaction('rw', allTables(database), async () => {
    const deviceRow = await database.devices.get(device.deviceId)
    if (!deviceRow) throw new Error('This device record is missing.')

    const touched: string[] = []

    for (const event of options.importedEvents) {
      const validation = validateDomainEvent(event)
      if (!validation.ok) throw new EventValidationError(validation.issues)
      if (await database.events.get(event.eventId)) continue

      await database.events.add(event)
      touched.push(event.entityId)

      // Remember foreign devices so the Data screen can name them.
      const known = await database.devices.get(event.deviceId)
      if (!known) {
        await database.devices.put({
          deviceId: event.deviceId,
          label:
            event.deviceId === options.importRow.sourceDeviceId
              ? options.importRow.sourceDeviceLabel
              : 'Another device',
          nextSequence: event.deviceSequence + 1,
          createdAt: event.recordedAt,
          isThisDevice: false,
        })
      } else if (!known.isThisDevice && event.deviceSequence >= known.nextSequence) {
        await database.devices.put({ ...known, nextSequence: event.deviceSequence + 1 })
      }
    }

    let sequence = deviceRow.nextSequence
    const recordedAt = new Date().toISOString()
    for (const draft of options.localDrafts) {
      const event: DomainEvent = {
        ...draft,
        deviceId: device.deviceId,
        deviceSequence: sequence,
        recordedAt: draft.recordedAt ?? recordedAt,
      }
      sequence += 1
      const validation = validateDomainEvent(event)
      if (!validation.ok) throw new EventValidationError(validation.issues)
      await database.events.add(event)
      touched.push(event.entityId)
    }

    await database.devices.put({ ...deviceRow, nextSequence: sequence })
    await database.imports.put(options.importRow)
    await refreshProjections(touched)
    return { written: options.importedEvents.length + options.localDrafts.length }
  })
}

/* -------------------------------------------------------------- snapshots */

/** Automatic snapshots kept before merges. Older ones are pruned. */
export const SNAPSHOT_RETENTION = 3

export async function createSnapshot(reason: SnapshotRow['reason']): Promise<SnapshotRow> {
  const database = db()
  return database.transaction(
    'rw',
    database.events,
    database.devices,
    database.snapshots,
    async () => {
      const events = await database.events.toArray()
      const deviceRows = await database.devices.toArray()
      const snapshot: SnapshotRow = {
        snapshotId: newId(),
        createdAt: new Date().toISOString(),
        reason,
        eventCount: events.length,
        events,
        deviceRows,
      }
      await database.snapshots.put(snapshot)

      const all = await database.snapshots.orderBy('createdAt').toArray()
      for (const old of all.slice(0, Math.max(0, all.length - SNAPSHOT_RETENTION))) {
        await database.snapshots.delete(old.snapshotId)
      }
      return snapshot
    },
  )
}

/**
 * Restore a pre-merge snapshot by replacing the authoritative event set.
 *
 * This is a replacement, not a domain event — the UI says so plainly, and the
 * import row records that a rollback happened.
 */
export async function restoreSnapshot(snapshotId: string): Promise<void> {
  const database = db()
  await database.transaction('rw', allTables(database), async () => {
    const snapshot = await database.snapshots.get(snapshotId)
    if (!snapshot) throw new Error('That snapshot is no longer available.')

    await database.events.clear()
    await database.events.bulkAdd(snapshot.events)
    await database.devices.clear()
    await database.devices.bulkPut(snapshot.deviceRows)
    await writeAllProjections(snapshot.events)

    const now = new Date().toISOString()
    const rows = await database.imports.toArray()
    for (const row of rows) {
      if (row.snapshotId === snapshotId && !row.rolledBackAt) {
        await database.imports.put({ ...row, rolledBackAt: now })
      }
    }
  })
}

/* ------------------------------------------------------------------- reset */

/**
 * Delete every local trace of this app: events, projections, device identity,
 * settings, snapshots and history.
 *
 * Irreversible, and it does not touch backup files already saved elsewhere.
 * The caller is expected to reload afterwards so the app starts from onboarding
 * with a fresh device identity.
 */
export async function deleteAllLocalData(): Promise<void> {
  const database = db()
  await database.delete()
  // Drop the closed handle so the next caller opens a brand-new database.
  instance = null
}
