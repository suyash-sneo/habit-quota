/**
 * Everything the Data screen reads and writes: integrity figures, export
 * history, import history, and browser storage status.
 */

import { db, readMeta, writeMeta } from '../database.ts'
import { newId } from '../../domain/events/ids.ts'
import type { DomainEvent } from '../../domain/events/types.ts'
import { coverageOf } from '../../domain/backup/build.ts'
import { findSequenceGaps } from '../../domain/merge/plan.ts'
import type { SequenceGap } from '../../domain/merge/plan.ts'
import type { DeviceRow, ExportRow, ImportRow, StorageStatus } from '../schema.ts'
import { META_KEYS } from '../schema.ts'

export async function allEvents(): Promise<DomainEvent[]> {
  return db().events.toArray()
}

/** Events for one habit, newest first. Used by the Timeline "Changes" view. */
export async function eventsForHabit(habitId: string, limit = 200): Promise<DomainEvent[]> {
  const rows = await db().events.where('habitId').equals(habitId).toArray()
  return rows
    .sort((a, b) => (a.recordedAt < b.recordedAt ? 1 : a.recordedAt > b.recordedAt ? -1 : 0))
    .slice(0, limit)
}

export async function eventsForEntity(entityId: string): Promise<DomainEvent[]> {
  const rows = await db().events.where('entityId').equals(entityId).toArray()
  return rows.sort((a, b) => (a.recordedAt < b.recordedAt ? -1 : a.recordedAt > b.recordedAt ? 1 : 0))
}

export interface IntegrityReport {
  eventCount: number
  coverage: { earliestLocalDate: string | null; latestLocalDate: string | null }
  latestRecordedAt: string | null
  devices: Array<DeviceRow & { observedHighWaterMark: number; eventCount: number }>
  sequenceGaps: SequenceGap[]
  missingSequenceCount: number
}

export async function integrityReport(): Promise<IntegrityReport> {
  const [events, devices] = await Promise.all([allEvents(), db().devices.toArray()])
  const coverage = coverageOf(events)
  const gaps = findSequenceGaps(events)

  const perDevice = new Map<string, { max: number; count: number }>()
  for (const event of events) {
    const current = perDevice.get(event.deviceId) ?? { max: 0, count: 0 }
    current.count += 1
    if (event.deviceSequence > current.max) current.max = event.deviceSequence
    perDevice.set(event.deviceId, current)
  }

  return {
    eventCount: events.length,
    coverage: {
      earliestLocalDate: coverage.earliestLocalDate,
      latestLocalDate: coverage.latestLocalDate,
    },
    latestRecordedAt: coverage.latestRecordedAt,
    devices: devices.map((d) => ({
      ...d,
      observedHighWaterMark: perDevice.get(d.deviceId)?.max ?? 0,
      eventCount: perDevice.get(d.deviceId)?.count ?? 0,
    })),
    sequenceGaps: gaps,
    missingSequenceCount: gaps.reduce((n, g) => n + g.missing.length, 0),
  }
}

/* --------------------------------------------------------------- history */

export async function recordExport(row: Omit<ExportRow, 'exportId'>): Promise<ExportRow> {
  const full: ExportRow = { ...row, exportId: newId() }
  await db().exports.put(full)
  return full
}

export async function listExports(limit = 20): Promise<ExportRow[]> {
  const rows = await db().exports.orderBy('exportedAt').reverse().limit(limit).toArray()
  return rows
}

export async function listImports(limit = 20): Promise<ImportRow[]> {
  return db().imports.orderBy('importedAt').reverse().limit(limit).toArray()
}

export async function latestSnapshotId(): Promise<string | null> {
  const row = await db().snapshots.orderBy('createdAt').reverse().first()
  return row?.snapshotId ?? null
}

/* ---------------------------------------------------------------- storage */

export interface StorageEstimate {
  usageBytes: number | null
  quotaBytes: number | null
  persisted: boolean
  supported: boolean
}

/**
 * Ask the browser to keep this origin's data. A refusal is completely normal
 * and is surfaced as information, not as a warning.
 */
export async function requestPersistentStorage(): Promise<StorageStatus> {
  const existing = (await readMeta<StorageStatus>(META_KEYS.storageStatus)) ?? {
    persistedGranted: false,
    askedAt: null,
  }
  const storage = navigator.storage
  if (!storage || typeof storage.persist !== 'function') return existing

  const alreadyPersisted =
    typeof storage.persisted === 'function' ? await storage.persisted() : false
  const granted = alreadyPersisted || (await storage.persist())
  const next: StorageStatus = { persistedGranted: granted, askedAt: new Date().toISOString() }
  await writeMeta(META_KEYS.storageStatus, next)
  return next
}

export async function readStorageEstimate(): Promise<StorageEstimate> {
  const storage = navigator.storage
  if (!storage || typeof storage.estimate !== 'function') {
    return { usageBytes: null, quotaBytes: null, persisted: false, supported: false }
  }
  const [estimate, persisted] = await Promise.all([
    storage.estimate(),
    typeof storage.persisted === 'function' ? storage.persisted() : Promise.resolve(false),
  ])
  return {
    usageBytes: estimate.usage ?? null,
    quotaBytes: estimate.quota ?? null,
    persisted,
    supported: true,
  }
}

export function formatBytes(bytes: number | null): string {
  if (bytes === null) return 'Unknown'
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB']
  let value = bytes / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`
}
